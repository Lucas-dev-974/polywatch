# Package `@polywatch/backend`

API Express + Socket.IO. Sert le frontend, expose les routes internes du worker, et porte toute la logique on-chain côté serveur (dépôts, retraits, approbations, rédemption).

## Bootstrap (`index.ts`)

1. TypeORM PostgreSQL + `seedDefaults` (admin/changeme, RiskConfig, balance sim 10 000).
2. `bootstrapWalletAccounts` (migration des comptes existants).
3. Middlewares : `cors()` avec whitelist d'origines (`CORS_ORIGIN`, défaut localhost), `express.json()`, `pinoHttp()` avec redaction (`authorization`, `x-service-token`, `cookie`), rate-limiter (1 000 req/min en prod, exempté si `x-service-token`).
4. Montage des routes, `/metrics` Prometheus (protégé par `requireServiceToken`), serveur HTTP + Socket.IO (même whitelist CORS).

## Authentification

- `auth/jwt.ts` : access token 15 min (`JWT_SECRET`), refresh token 7 j (`JWT_REFRESH_SECRET`) — secrets distincts. Chaque refresh token porte un `jti` unique.
- Rotation **single-use** des refresh tokens : le `jti` est stocké dans Redis (TTL 7 j) et invalidé à chaque `POST /api/auth/refresh` ; un token rejoué (volé ou réutilisé) est rejeté.
- `middleware/auth.ts` : `requireJwt` (Bearer) et `requireServiceToken` (`x-service-token`, pour le worker).
- Socket.IO : token vérifié au handshake ; les connexions rejoignent les rooms `positions`, `executions`, `alerts`.

## Crypto

- `crypto/encryption.ts` : AES-256-GCM, IV 12 octets, format `iv:tag:ciphertext` (hex). Clé = `MASTER_ENCRYPTION_KEY` : soit 64 caractères hex (décodés en 32 bytes — sortie de `generate-secrets.mjs`), soit une chaîne UTF-8 de 32 bytes.
- `crypto/private-key.ts` : normalisation (`0x` + 64 hex), validation via `ethers.Wallet`, dérivation d'adresse.

## Routes REST

### Publiques (JWT)

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/api/auth/login` | bcrypt → access + refresh tokens |
| POST | `/api/auth/refresh` | Renouvellement des tokens (rotation single-use via `jti` Redis) |
| GET/PUT | `/api/config/{global,copy,crypto,weather}` | Lecture / mise à jour par table isolée (`simAllowedMarketTags` / `realAllowedMarketTags` sur `copy`) |
| GET | `/api/market-tags` | Tags marché pour l'UI (`nav` + `tags` avec `?search=`, proxy Gamma) |
| GET | `/api/simulation-balance` | Snapshot simulation (cash + equity) — query **`algoKind`** (défaut `crypto`) |
| POST | `/api/simulation-balance/reset` | Reset **d'un** périmètre (`algoKind` requis dans le body). Archive / wipe / purge Redis **scopés** au kind. **Lock Redis `sim:reset:lock:${algoKind}`** (SET NX PX 10 s) → 409 si déjà en cours, 503 si Redis injoignable. Side-effects post-commit isolés ; réponse : `archiveSummary`, `redisPurge`, `warnings`. |
| GET/POST/GET/:id/DELETE | `/api/simulation-snapshots` | Archives d'état simulation — voir [`snapshots-simulation.md`](../snapshots-simulation.md) |
| GET/POST/DELETE | `/api/clob-credentials(/status)` | Statut / enregistrement chiffré / suppression des credentials CLOB |
| GET | `/api/executions` | Liste des exécutions (filtre mode) |
| GET | `/api/leaderboard` | Proxy du leaderboard Polymarket |
| GET/DELETE | `/api/move-events` | Liste / purge des événements détectés |
| GET | `/api/algo/events` | Événements de surveillance algo (paginés, enrichis avec exécutions sim/real) |
| GET | `/api/copied-positions` | Positions copiées (filtres status/mode) |
| POST | `/api/copied-positions/:id/close` | Fermeture manuelle → push Redis `close-signals` |
| GET | `/api/wallet` | Vue d'ensemble (comptes, soldes, adresses) |
| POST | `/api/wallet/pusd/withdraw` | Retrait pUSD/USDC.e (EOA ou relayer) |
| POST | `/api/wallet/pusd/withdraw/prepare` + `/submit` | Retrait MetaMask en deux temps (EIP-712) |
| GET/POST | `/api/wallet/bridge/*` | supported-assets, deposit-addresses, deposit-quote, status/:address |
| CRUD | `/api/wallet/accounts(/:id)` (+ `/history`) | Gestion des wallet accounts + historique on-chain |
| CRUD | `/api/watchlist(/:id)` | Gestion de la watchlist (POST validé Zod) |

### Internes (`/api/internal`, service token uniquement)

Consommées par le worker / copy-trading / crypto-algo / weather-algo : watchlist, copied-positions, trader-snapshots, move-events (lecture + `processed`), reconcile/poll-cycle par trader, pnl-ticks et move-detected (relais Socket.IO), **clob-credentials (déchiffrés — worker uniquement)**, balances (copy-trading + crypto/weather-algo sizing real), position-reservations (create/delete), executions claim, pending-resolution, retry-close, replay des dead-letter queues, clob-approvals/ensure, redeem (rédemption on-chain).

Routes JWT weather-algo : `/api/weather-algo-auto-track` (villes), `/api/weather-algo-discover`, `/api/weather-algo-forecasts`, `/api/weather-algo-markets` (legacy + status ; POST → 410), `/api/config/weather` — voir [`../api.md`](../api.md) § Weather Algo et [`../weather-algo.md`](../weather-algo.md).

Également : POST `/api/executions` (service token) — notification d'exécution du worker, relayée en WebSocket.

## Socket.IO (`websocket.ts`)

| Événement émis | Room | Déclencheur |
|---|---|---|
| `position_update` | positions | Changement de position |
| `pnl_tick` | positions | Ticks PnL du worker |
| `move_detected` | positions | Nouveau MoveEvent |
| `execution` | executions | Exécution finalisée |
| `simulation_balance` / `simulation_reset` | positions(+executions) | Comptabilité sim |
| `alert` | alerts | Alertes (kill switch, erreurs) |

## Module `polymarket/` — flux on-chain

### Dépôt
- **Bridge** : `bridge-client.ts` → POST `bridge.polymarket.com/deposit` → adresses de dépôt multi-chain ; quote via `bridge-quote.ts` ; suivi par polling `GET /status/:address`.
- **Direct** : le frontend envoie du pUSD (ERC-20 Polygon) à la deposit address via MetaMask.

### Retrait
- **EOA (signatureType 0)** : `pusd-transfer.ts` — le signer (clé déchiffrée) doit correspondre à la deposit address ; `transfer` pUSD ou `approve` + `offramp.unwrap` pour USDC.e.
- **Relayer (types 1/2/3)** : `relayer-client.ts` — idempotence en mémoire, `client.execute(...)` / `executeDepositWalletBatch(...)`, attente du tx hash Polygon.
- **MetaMask (type 3)** : `relayer-metamask-withdraw.ts` — `prepare` (nonce relayer + typed data EIP-712, TTL 35 min) puis `submit` (vérification de signature `verifyDepositWalletSignature` avant soumission au relayer).

### Autres
- `proxy.ts` : détection du proxy wallet (RPC `getPolyProxyWalletAddress`, fallback Gamma public-profile).
- `clob-approvals.ts` : vérifie et soumet en un batch relayer les 5 approbations requises (pUSD→CTF/Exchange/NegRisk, CTF→Exchange/NegRisk).
- `collateral-detection.ts` : détection du collatéral d'un marché via `assetId` (RPC payout vector CTF + `positionId`) ; parsing `PayoutRedemption` depuis les logs receipt ; lecture solde parts CTF (`fetchCtfShareBalance`).
- `clob-redeem.ts` : encode `redeemPositions` (CTF ou NegRiskAdapter) avec **collatéral dynamique** (plus de pUSD hardcodé) ; `assetId` requis pour CTF standard ; garde `no_ctf_balance` si solde CTF = 0 ; `success: false` si payout receipt = 0 ; **auto-wrap USDC.e → pUSD** après redeem réussi (`buildWrapDepositWalletCalls`).
- `collateral-ramp.ts` : conversions collatéral (wrap USDC.e → pUSD, etc.) ; `buildWrapTransactions`, `buildWrapDepositWalletCalls`.
- `polygon.ts` / `token-balance.ts` / `pusd-balance.ts` / `pusd-erc20.ts` : provider RPC et lectures de soldes.
- `wallet-history.ts` : historique d'activité on-chain par compte ; pour REDEEM Data API avec `usdcSize = 0`, pas de prix unitaire dérivé (évite faux « Rachat 1,00 $ »).
- `wallet-account-context.ts` / `wallet-context.ts` / `wallet-route-context.ts` / `wallet-validation.ts` : résolution du compte actif et validations partagées des routes wallet.
- `ramp-errors.ts` / `relayer-errors.ts` / `withdraw-errors.ts` / `wallet-bridge-errors.ts` : normalisation des erreurs en codes métier (consommés par le frontend pour les messages FR).

## Scripts racine

| Script | Rôle |
|---|---|
| `generate-secrets.mjs` | Génère les 4 secrets `.env` (la clé hex 64 car. est désormais acceptée par `encryption.ts` — audit C-1 corrigé) |
| `spike-clob-salt-dedup.ts` | Gate ADR-031 : vérifie l'absence de collision des salts CLOB déterministes |
| `backup-db.sh` | Sauvegarde PostgreSQL (`pg_dump`), rétention 7 jours |
| `inspect-deposit-wallet.mjs` | Outil dev : solde pUSD d'un wallet |

## Configuration (`config.ts`)

`jwtSecret`, `jwtRefreshSecret`, `serviceToken`, `masterEncryptionKey` — défauts de dev insécurisés ; `validateProductionSecrets` fait crasher le serveur en production si inchangés.
