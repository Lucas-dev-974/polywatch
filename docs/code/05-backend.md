# Package `@polywatch/backend`

API Express + Socket.IO. Sert le frontend, expose les routes internes du worker, et porte toute la logique on-chain côté serveur (dépôts, retraits, approbations, rédemption).

## Bootstrap (`index.ts`)

1. TypeORM PostgreSQL + `seedDefaults` (admin, 4 configs isolées, balance sim 10 000).
2. `bootstrapWalletAccounts` (migration des comptes existants).
3. Middlewares : `cors()` avec whitelist d'origines (`CORS_ORIGIN`, défaut localhost), `express.json()`, `pinoHttp()` avec redaction (`authorization`, `x-service-token`, `cookie`), rate-limiter (1 000 req/min en prod, exempté si `x-service-token`).
4. Montage des routes, `/metrics` Prometheus (protégé par `requireServiceToken`), serveur HTTP + Socket.IO (même whitelist CORS).
5. Publication du signal Redis `backend-ready` (clé TTL 60 s + pub/sub) une fois le serveur en écoute — le worker l'attend via `waitForBackendReady()` avant de démarrer.

## Authentification

- `auth/jwt.ts` : access token 15 min (`JWT_SECRET`), refresh token 7 j (`JWT_REFRESH_SECRET`) — secrets distincts. Chaque refresh token porte un `jti` unique.
- Rotation **single-use** des refresh tokens : le `jti` est stocké dans Redis (TTL 7 j) et invalidé à chaque `POST /api/auth/refresh` ; un token rejoué (volé ou réutilisé) est rejeté.
- `middleware/auth.ts` : `requireJwt` (Bearer) et `requireServiceToken` (`x-service-token`, pour le worker).
- Socket.IO : token vérifié au handshake ; les connexions rejoignent les rooms `positions`, `executions`, `alerts`.

## Crypto

- `crypto/encryption.ts` : AES-256-GCM, IV 12 octets, format `iv:tag:ciphertext` (hex). Clé = `MASTER_ENCRYPTION_KEY` : soit 64 caractères hex (décodés en 32 bytes — sortie de `generate-secrets.mjs`), soit une chaîne UTF-8 de 32 bytes (**legacy** : acceptée sans KDF mais `warnIfLegacyMasterEncryptionKey()` logue un `warn` au boot — une seule fois grâce au flag `legacyKeyWarned`).
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
| GET/POST/GET/:id/DELETE | `/api/simulation-snapshots` | Archives d'état simulation — voir [`../reference/snapshots-simulation.md`](../reference/snapshots-simulation.md) |
| GET/POST | `/api/reports/*` | Hub Rapports (optimize crypto, liste, apply) — [`../reference/rapports-analyse.md`](../reference/rapports-analyse.md) |
| GET/POST/DELETE | `/api/backtest/*` | Runs backtest weather, equity, markets-series, excluded-ticks — [`../reference/api.md`](../reference/api.md) |
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

Consommées par le worker / copy-trading / crypto-algo / weather-algo. Liste complète :
[`../reference/api.md`](../reference/api.md) § Internes — inclut aussi `POST /metrics/exit-event|strategy-cycle|weather-question-parse` et `GET /metrics/dashboard`.

Routes JWT weather-algo / crypto-algo-monitor / e2e-runs : voir [`../reference/api.md`](../reference/api.md).

Également : POST `/api/executions` (service token) — notification d'exécution du worker, relayée en WebSocket.

## Module `src/e2e/` (orchestration tests E2E)

Suites spawnées via JWT `/api/e2e-runs` (`e2e-runner.service.ts`) :
`playwright`, `crypto-algo`, `crypto-algo-real`, `compliance` (`e2e/suites.ts`).
Fichiers : `suites.ts`, `process.ts`, `summary-parser.ts`, `run-dto.ts`,
`position-marker.ts`, `errors.ts`. WS : `e2e_*` (voir `api.md`).

## Socket.IO (`websocket.ts`)

| Événement émis | Room | Déclencheur |
|---|---|---|
| `position_update` | positions | Changement de position |
| `pnl_tick` | positions | Ticks PnL du worker |
| `move_detected` | positions | Nouveau MoveEvent |
| `execution` | executions | Exécution finalisée |
| `simulation_balance` / `simulation_reset` | positions(+executions) | Comptabilité sim |
| `alert` | alerts | Alertes (kill switch, erreurs) |
| `algo_chart_tick` | markets | Ticks chart crypto-algo live |
| `real_snapshot_created` / `real_period_rotated` | positions(+executions) | Snapshots / rotation période réelle |
| `system:audit:*` | broadcast | Audit système Overview |
| `e2e_*` | e2e-runs | Progression / fin des runs E2E API |

## Module `polymarket/` — flux on-chain

### Dépôt
- **Bridge** : `bridge-client.ts` → POST `bridge.polymarket.com/deposit` → adresses de dépôt multi-chain ; quote via `bridge-quote.ts` ; suivi par polling `GET /status/:address`.
- **Direct** : le frontend envoie du pUSD (ERC-20 Polygon) à la deposit address via MetaMask.

### Retrait
- **EOA (signatureType 0)** : `pusd-transfer.ts` — le signer (clé déchiffrée) doit correspondre à la deposit address ; `transfer` pUSD ou `approve` + `offramp.unwrap` pour USDC.e.
- **Relayer (types 1/2/3)** : `relayer-client.ts` — idempotence **Redis atomique** (`SET key RESERVED NX EX`, TTL `PENDING_TTL_SECONDS`) : requête identique déjà complétée → hash existant renvoyé ; requête identique en vol → `withdraw_in_progress` (409) ; échec préflight ou tx → réservation libérée (`clearReservation`) ; succès on-chain avec échec Redis post-mark → retourne le `txHash` sans clear (retry best-effort `markCompleted`). Race rare NX+GET documentée dans le code (TTL auto-heal).
- **MetaMask (type 3)** : `relayer-metamask-withdraw.ts` — `prepare` (nonce relayer + typed data EIP-712, TTL 35 min) puis `submit` (vérification de signature `verifyDepositWalletSignature` avant soumission au relayer).

### Autres
- `proxy.ts` : détection du proxy wallet (RPC `getPolyProxyWalletAddress`, fallback Gamma public-profile).
- `clob-approvals.ts` : vérifie et soumet en un batch relayer **seulement les allowances requises pour l'ordre** (marché standard vs neg-risk/weather, BUY vs SELL). Weather BUY = pUSD→NegRiskAdapter ; weather SELL = CTF→NegRiskAdapter ; standard BUY = pUSD→Exchange V2 ; standard SELL = CTF→Exchange V2. Pas de gate 7-en-1.
- `collateral-detection.ts` : détection du collatéral d'un marché via `assetId` (RPC payout vector CTF + `positionId`) ; parsing `PayoutRedemption` depuis les logs receipt ; lecture solde parts CTF (`fetchCtfShareBalance`).
- `clob-redeem.ts` : encode `redeemPositions` (CTF ou NegRiskAdapter) avec **collatéral dynamique** (plus de pUSD hardcodé) ; `assetId` requis pour CTF standard ; garde `no_ctf_balance` si solde CTF = 0 ; `success: false` si payout receipt = 0 ; **auto-wrap USDC.e → pUSD** après redeem réussi (`buildWrapDepositWalletCalls`).
- `collateral-ramp.ts` : conversions collatéral (wrap USDC.e → pUSD, etc.) ; `buildWrapTransactions`, `buildWrapDepositWalletCalls`.
- `polygon.ts` / `token-balance.ts` / `pusd-balance.ts` / `pusd-erc20.ts` : provider RPC et lectures de soldes.
- `wallet-history.ts` : historique d'activité on-chain par compte ; pour REDEEM Data API avec `usdcSize = 0`, pas de prix unitaire dérivé (évite faux « Rachat 1,00 $ »).
- `wallet-account-context.ts` / `wallet-context.ts` / `wallet-route-context.ts` / `wallet-validation.ts` : résolution du compte actif et validations partagées des routes wallet.
- `ramp-errors.ts` / `relayer-errors.ts` / `withdraw-errors.ts` / `wallet-bridge-errors.ts` : normalisation des erreurs en codes métier (consommés par le frontend pour les messages FR). `withdraw-errors.ts` mappe notamment `withdraw_in_progress` → **409** (double soumission d'un retrait identique encore en vol).

## Scripts racine

| Script | Rôle |
|---|---|
| `generate-secrets.mjs` | Génère les 4 secrets `.env` (la clé hex 64 car. est désormais acceptée par `encryption.ts` — audit C-1 corrigé) |
| `spike-clob-salt-dedup.ts` | Gate ADR-031 : vérifie l'absence de collision des salts CLOB déterministes |
| `backup-db.sh` | Sauvegarde PostgreSQL (`pg_dump`), rétention 7 jours |
| `inspect-deposit-wallet.mjs` | Outil dev : solde pUSD d'un wallet |

## Configuration (`config.ts`)

`jwtSecret`, `jwtRefreshSecret`, `serviceToken`, `masterEncryptionKey` — défauts de dev insécurisés ; `validateProductionSecrets` fait crasher le serveur en production si inchangés.
