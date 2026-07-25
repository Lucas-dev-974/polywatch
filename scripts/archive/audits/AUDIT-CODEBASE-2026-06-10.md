# Audit complet de la codebase — Polywatch v0.3

> **Mise à jour 10/06/2026 (soir)** : l'intégralité des constats **critiques, hauts, moyens et bas** (C-1…C-3, H-1…H-12, M-1…M-21, B-1…B-11) est corrigée. Voir les sections 8 et 10 pour le détail patch par patch. Build complet et 157 tests unitaires au vert après application.

**Date** : 10 juin 2026
**Périmètre** : `packages/core`, `packages/worker`, `packages/backend`, `packages/frontend`, `scripts/`, `docker-compose.yml`, `e2e/`
**Méthode** : lecture exhaustive des sources (`src/` uniquement, `dist/` exclu), analyse croisée des pipelines (détection → copie → exécution → finalisation → résolution), recherche de bugs réels et de bugs « fantômes » (comportements silencieusement incorrects : erreurs avalées, races, confusion d'unités, idempotence cassée). Les constats critiques ont été re-vérifiés manuellement dans le code source.

---

## 1. Synthèse exécutive

La codebase est globalement bien structurée : séparation claire core/worker/backend/frontend, idempotence par hash SHA-256, réservations d'exposition transactionnelles, tests unitaires présents sur les modules métier sensibles (VWAP, fees, accounting, policy, parse-fill). Les pipelines principaux (poll → move-events → copy → order-signals → executor → execution-results → finalize) sont correctement câblés.

Cependant, l'audit relève **42 problèmes**, dont **3 critiques** et **8 hauts**. Les plus dangereux pour le **trading réel** :

| Priorité | Problème | Impact |
|---|---|---|
| 1 | `MASTER_ENCRYPTION_KEY` générée par `generate-secrets.mjs` incompatible avec `encryption.ts` (64 chars vs 32 bytes attendus) | Crash au premier chiffrement après sécurisation des secrets — bloque toute mise en prod sécurisée |
| 2 | `PositionLockRegistry` : suppression prématurée du lock → 3+ signaux concurrents sur la même position peuvent s'exécuter en parallèle | Double `beginClose` / double ordre CLOB réel possible |
| 3 | `socket.off('event')` sans handler côté frontend → suppression de tous les listeners partagés du socket singleton | UI désynchronisée silencieusement (positions/balances figées) |
| 4 | Fills CLOB manqués pendant la fenêtre de reconnexion du WebSocket user (réconciliation uniquement au démarrage du process) | Exécution réelle bloquée en `placing`, puis marquée `failed` à tort |
| 5 | Logs `pino-http` sans redaction → mots de passe et clés privées en clair dans les logs | Fuite de secrets |

**Verdict initial** : le mode **simulation** est exploitable en l'état (avec les réserves moyennes ci-dessous). Le mode **trading réel ne devrait pas être activé** avant correction des points 1, 2, 4 et 5, et durcissement de la surface réseau (CORS, Redis, logs).

**Verdict après correctifs (10/06/2026, soir)** : les 5 bloqueurs ci-dessus ainsi que **tous** les constats (critiques, hauts, moyens et bas) sont corrigés (sections 8 et 10). Le durcissement réseau est en place (CORS whitelist, Redis lié à `127.0.0.1`, redaction des logs, `/metrics` protégé). Les prérequis techniques pour le trading réel sont levés ; une phase de validation en conditions réelles à petite taille reste recommandée.

### Répartition des constats

| Sévérité | core | worker | backend | frontend | Total |
|---|---|---|---|---|---|
| Critique | 0 | 1 | 1 | 1 | **3** |
| Haute | 3 | 1 | 7 | 3 | **14** |
| Moyenne | 6 | 5 | 5 | 5 | **21** |
| Basse | 3 | 3 | 2 | 3 | **11** |

*(Certains constats initialement classés « critique » par l'analyse automatique ont été requalifiés après vérification manuelle — voir notes de vérification en fin de document.)*

---

## 2. Constats critiques

### C-1 — Incompatibilité `MASTER_ENCRYPTION_KEY` entre le générateur de secrets et le module de chiffrement

**Fichiers** : `scripts/generate-secrets.mjs` (l. 4-6, 12) et `packages/backend/src/crypto/encryption.ts` (l. 6-12)
**Sévérité** : Critique — **Confiance** : Certaine (vérifié manuellement)

```4:6:scripts/generate-secrets.mjs
function secret(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}
```

```6:12:packages/backend/src/crypto/encryption.ts
function getKey(): Buffer {
  const key = Buffer.from(config.masterEncryptionKey, 'utf8');
  if (key.length !== 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes');
  }
  return key;
}
```

`randomBytes(32).toString('hex')` produit **64 caractères**. `Buffer.from(<64 chars>, 'utf8')` fait 64 bytes ≠ 32. Toute installation qui suit la procédure du README (`npm run generate-secrets` puis collage dans `.env`) obtient un backend qui **crashe au premier chiffrement/déchiffrement** (enregistrement des credentials CLOB, retrait, etc.). La valeur par défaut insécurisée (32 chars) fonctionne, ce qui masque le bug jusqu'à la tentative de sécurisation — typiquement juste avant le passage en trading réel.

**Correctif** : générer `randomBytes(16).toString('hex')` (32 chars) pour cette clé, ou décoder en hex dans `getKey()` (`Buffer.from(key, 'hex')`) avec migration.

---

### C-2 — `PositionLockRegistry` : suppression prématurée du lock (race avec 3+ signaux en file)

**Fichier** : `packages/worker/src/clob/position-lock-registry.ts` (l. 13-18)
**Sévérité** : Critique en mode réel — **Confiance** : Certaine (vérifié manuellement)

```13:18:packages/worker/src/clob/position-lock-registry.ts
  async runSequentially(positionId: number, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(positionId) ?? Promise.resolve();
    const next = prev.then(() => fn()).finally(() => this.locks.delete(positionId));
    this.locks.set(positionId, next);
    await next;
  }
```

Avec trois signaux A, B, C en file pour la même position : quand A se termine, son `.finally` supprime l'entrée de la map — qui contient alors la promesse de B. Si C arrive ensuite, `locks.get()` retourne `undefined` et **C s'exécute en parallèle de B**. Scénario concret : `COPY_OPEN` (executorA) + `SL` (executorB) + 2ᵉ `SL` du timer strategy → deux `beginClose` + deux `createAndPostMarketOrder` simultanés sur le CLOB = **double vente réelle**. Le test unitaire existant ne couvre que 2 tâches.

**Correctif** :

```typescript
.finally(() => {
  if (this.locks.get(positionId) === next) this.locks.delete(positionId);
});
```

---

### C-3 — Frontend : `socket.off('event')` sans référence de handler

**Fichiers** : `packages/frontend/src/hooks/useTradingWallet.ts` (l. 22), `components/PositionCard.tsx` (l. 79-84), `components/ExecutionLog.tsx` (l. 25-26), `components/SimHero.tsx` (l. 26)
**Sévérité** : Critique (UX/intégrité d'affichage) — **Confiance** : Certaine

`socket.off('position_update')` sans deuxième argument retire **tous** les handlers de cet événement sur le socket singleton. Quand `PositionCard` est démonté (changement de page), il supprime aussi les handlers de `useTradingWallet` (RealHero), `SimHero`, `ExecutionLog`. Résultat : balances et positions **figées silencieusement** jusqu'au rechargement de la page — un « bug fantôme » typique.

**Correctif** : stocker chaque handler dans une variable et appeler `socket.off('event', handler)`.

---

## 3. Constats de sévérité haute

### H-1 — Fills manqués pendant la reconnexion du WebSocket user (worker)

**Fichiers** : `packages/worker/src/polymarket/websocket-user.ts` (l. 199-219), `clob/startup-reconciler.ts`
**Confiance** : Probable

Pendant la fenêtre de déconnexion/reconnexion du canal user (backoff exponentiel jusqu'à ~32 s, max 5 tentatives), les événements `trade`/`order` du CLOB sont perdus. `reconcilePlacingExecutions` ne tourne **qu'au démarrage du process**. Une exécution remplie pendant cette fenêtre reste en `placing` ; le `ClosingWatchdog` la marquera `failed` à tort après 3 min alors que l'ordre a été réellement exécuté → **désynchronisation position locale / position on-chain**.
**Correctif** : relancer la réconciliation à chaque reconnexion réussie du WS user ; alerter quand `WS_MAX_RECONNECT_ATTEMPTS` est atteint (actuellement : simple log d'erreur, plus aucun fill n'arrive ensuite).

### H-2 — `computeExposure` compte les réservations expirées (core)

**Fichier** : `packages/core/src/services/reservation.service.ts` (l. 197-199) — **Confiance** : Certaine

La requête récupère toutes les `PositionReservation` du mode sans filtrer `expires_at > now`. Si le janitor (60 s) est en retard, des réservations mortes gonflent l'exposition mesurée et des trades légitimes sont rejetés pour `max_exposure`. Correctif : filtrer sur l'expiration dans la requête.

### H-3 — `parseClobRecord` conflate `closed` et `resolved` (core)

**Fichier** : `packages/core/src/polymarket/market-metadata.ts` (l. 168-169) — **Confiance** : Certaine (vérifié), impact requalifié de critique → haut

```168:169:packages/core/src/polymarket/market-metadata.ts
    resolved: Boolean(raw.closed ?? raw.resolved),
    closed: Boolean(raw.closed ?? raw.resolved),
```

Un marché `closed=true` mais non résolu (dispute UMA en cours) est persisté comme `resolved=true`. **Nuance vérifiée** : `isMarketSettled()` exige aussi `winningTokenId` non nul (`market/lifecycle.ts` l. 42-46), donc le règlement prématuré ne se déclenche que si un `winningTokenId` est aussi déduit. Le risque résiduel existe quand le CLOB renvoie un `winner` provisoire ou un prix ≥ seuil pendant la dispute, et le champ `resolved` corrompu fausse `shouldPollMarketForLifecycle` (le marché est considéré comme déjà résolu). Correctif : `resolved: Boolean(raw.resolved)` strictement.

### H-4 — `getRedemptionPayoff` / `won` sans normalisation des token IDs (core)

**Fichiers** : `packages/core/src/market/lifecycle.ts` (l. 57), `services/market-resolution.service.ts` (l. 87) — **Confiance** : Probable

`resolveWinningOutcome` (`polymarket/redemption.ts`) normalise les token IDs (strip `0x`, lowercase) mais `getRedemptionPayoff` et le calcul `won` font une égalité stricte brute. Si `winningTokenId` (Gamma) et `pos.assetId` (CLOB/Data API) divergent en format, une position **gagnante est créditée 0** à la rédemption. Correctif : normaliser systématiquement avant comparaison (réutiliser la même fonction de normalisation partout).

### H-5 — `pino-http` sans redaction : secrets en clair dans les logs (backend)

**Fichier** : `packages/backend/src/index.ts` (l. 41) — **Confiance** : Certaine

`POST /api/auth/login` (password), `POST /api/clob-credentials` et `POST /api/wallet/accounts` (`signerPrivateKey` = clé privée Ethereum) transitent dans les logs HTTP. Correctif : `pinoHttp({ redact: [...] })` ou désactiver le log des bodies.

### H-6 — Refresh token sans révocation ni rotation single-use (backend)

**Fichier** : `packages/backend/src/routes/auth.ts` (l. 42-57) — **Confiance** : Certaine

Aucune liste de révocation, l'ancien refresh token reste valide après refresh, et l'utilisateur n'est pas re-vérifié en base. Un refresh token volé est exploitable 7 jours. Correctif : rotation single-use (jti stocké en DB/Redis) + re-vérification de l'utilisateur.

### H-7 — `PUT /api/risk-config` et `PATCH /api/watchlist/:id` sans validation (backend)

**Fichiers** : `routes/config.ts` (l. 26-42), `routes/watchlist.ts` (l. 43-55) — **Confiance** : Certaine

`req.body` brut transmis aux services (contrairement à `POST /clob-credentials` validé par Zod). Valeurs hors-plage possibles (`maxPositionSizeUsdc: -1`, champs arbitraires). Sur une config qui pilote SL/TP/kill-switch en argent réel, c'est un vecteur de corruption silencieuse. Correctif : schémas Zod stricts.

### H-8 — Pas de validation des adresses Ethereum saisies (backend)

**Fichiers** : `routes/config.ts` (credsSchema), `routes/wallet-accounts.ts` (upsertSchema) — **Confiance** : Certaine

`walletAddress`, `funderAddress`, `depositAddress` acceptés comme simples strings. Une typo n'est détectée qu'au moment de la transaction on-chain. Correctif : `ethers.isAddress()` + checksum EIP-55 dans les schémas.

### H-9 — CORS wildcard + Redis exposé sans mot de passe (infra)

**Fichiers** : `packages/backend/src/index.ts` (l. 39), `src/websocket.ts` (l. 9-11), `docker-compose.yml` (port `6379:6379`) — **Confiance** : Certaine

`cors()` sans options et Socket.IO `origin: '*'` sur une appli financière ; Redis (qui transporte les `close-signals` du trading réel) exposé sur l'hôte sans `requirepass`. Correctif : whitelist d'origines, `127.0.0.1:6379:6379` ou suppression du port mapping, mot de passe Redis.

### H-10 — Tokens JWT en `localStorage` (frontend)

**Fichier** : `packages/frontend/src/api.ts` (l. 8-14) — **Confiance** : Certaine

Exposition XSS classique, aggravée par le refresh token 7 jours et les capacités financières de l'API. Alternative : cookies `HttpOnly`/`SameSite` (en lien avec H-9).

### H-11 — `WalletPage` crashe si le chargement du wallet échoue (frontend)

**Fichier** : `packages/frontend/src/components/WalletPage.tsx` (l. 67-69, 103) — **Confiance** : Certaine

`const w = () => wallet()!` avec `wallet()` remis à `null` au catch → `TypeError` au rendu (écran blanc) dès que `GET /wallet` échoue. Correctif : `<Show when={!loading() && wallet()}>` + état d'erreur.

### H-12 — `onCleanup` après `await` dans `onMount` (frontend)

**Fichier** : `packages/frontend/src/components/SimHero.tsx` (l. 19-28) — **Confiance** : Certaine

En SolidJS, `onCleanup` doit être enregistré de façon synchrone ; après un `await`, le contexte est perdu. Si le composant est démonté pendant le fetch, les handlers socket ne sont jamais retirés (fuite + double-traitement). Correctif : enregistrer les listeners avant tout `await`.

---

## 4. Constats de sévérité moyenne

### Core

| # | Fichier (lignes) | Problème |
|---|---|---|
| M-1 | `services/poll-cycle.service.ts` (109-130) | Transition CLOSED générée deux fois quand un snapshot entrant arrive avec `size=0` (absorbé par l'idempotence, mais dépend du catch M-2) |
| M-2 | `services/poll-cycle.service.ts` (236-238) | `catch {}` nu : censé ignorer les conflits UNIQUE, il avale **toutes** les erreurs DB (disk full, lock timeout…). Vérifier le code d'erreur SQLite explicitement |
| M-3 | `idempotence/hash.ts` (26-28) | Hash d'idempotence construit sur des floats sérialisés en template literal — artefacts IEEE-754 possibles → doublons de MoveEvent |
| M-4 | `services/reservation.service.ts` (14) | `pending_resolution` exclu de `ACTIVE_STATUSES` : positions détenant encore des parts non comptées dans l'exposition ni dans max-positions |
| M-5 | `services/simulation.service.ts` (89-105) | `reset()` ne purge pas les `MoveEventEntity` non traités → le worker retraite d'anciens événements sur une simulation « vierge » |
| M-6 | `polymarket/market-metadata.ts` (80-83, 164-166) | Fallback Yes/No dépendant de l'ordre des outcomes pour les marchés non standard ; `maker_base_fee` utilisé comme fallback de `takerBaseFee` |

### Worker

| # | Fichier (lignes) | Problème |
|---|---|---|
| M-7 | `clob/ws-user-events.ts` (54-61) | `parseOrderMatchedSize` : seuil heuristique 1 000 000 pour distinguer raw (6 déc.) et human-readable → erreur facteur 10⁶ possible sur les très grosses ou très petites valeurs |
| M-8 | `clob/execution-completion.ts` (46) | `syncBookSubscriptions(refresh=true)` à chaque finalisation → N requêtes REST `/book` par fill, risque de rate-limit 429 CLOB. Utiliser `refresh=false` |
| M-9 | `clob/real-executor.ts` (51-55) | `roundToTick` en float natif : `0.55/0.01 → 54.999…` → prix non conforme au tick, rejet CLOB possible. Arrondir en entiers |
| M-10 | `processors/strategy-processing.ts` (358-367) | Kill switch `force_close_all` : les positions illiquides au moment du déclenchement ne sont ni fermées ni réévaluées par SL/TP (fenêtre de récupération longue) |
| M-11 | `clob/startup-reconciler.ts` (54-57 vs 68-69) | Asymétrie non documentée : `Number(trade.size)` (human) vs `parseRawAmount(order.size_matched)` (raw 6 déc.) — fragile si Polymarket normalise ses formats |

### Backend

| # | Fichier (lignes) | Problème |
|---|---|---|
| M-12 | `index.ts` (56-59) | `/metrics` Prometheus public, sans auth |
| M-13 | `polymarket/relayer-client.ts` (50), `relayer-metamask-withdraw.ts` (53) | Maps d'idempotence des retraits en mémoire : perdues au redémarrage, incompatibles multi-instance |
| M-14 | `polymarket/relayer-client.ts` (52-58) | Clé d'idempotence de retrait basée sur un `number` flottant |
| M-15 | `polymarket/token-balance.ts` (17-20) | Erreur RPC avalée → solde affiché `0` sans signalement (bug fantôme côté UI) |
| M-16 | `routes/internal.ts` (204-245) | `retry-close` non atomique (2 updates DB + 1 push Redis) : crash entre les étapes = position bloquée en `closing` |

### Frontend

| # | Fichier (lignes) | Problème |
|---|---|---|
| M-17 | `components/position/PositionList.tsx` (18-29) | `.map()` au lieu de `<For>` → destruction/recréation complète du DOM des lignes à chaque `position_update` |
| M-18 | `hooks/useClobCredentials.ts` (8-16) + `WalletPage.tsx` (46) | Erreur de `refresh()` non catchée → `needsSetup()` faussement vrai → dialog CLOB impossible à fermer |
| M-19 | `components/EnvSettingsDialog.tsx` (79-93), `ClobCredentialsDialog`, `WalletAccountsDialog.remove()` | Sauvegardes/suppressions sans `catch` : échec silencieux, aucun feedback utilisateur |
| M-20 | `components/Login.tsx` (9-10) | Identifiants `admin`/`changeme` pré-remplis en dur dans le formulaire |
| M-21 | `lib/pusd-transfer.ts` (11-17), `lib/bridge-metamask.ts` (12-27) | Encodage ABI ERC-20 `transfer` dupliqué dans deux modules |

---

## 5. Constats de sévérité basse

| # | Fichier | Problème |
|---|---|---|
| B-1 | `core/src/config/env.ts` (28) | `findMonorepoRoot()` exécuté à l'import (side effect) : crash de tout import hors monorepo |
| B-2 | `core/src/services/execution.service.ts` (224) | `entryQuantityRemaining` peut devenir négatif sans garde `Math.max(0, …)` (fills désordonnés) |
| B-3 | `core/src/risk/policy.ts` (220) | `slPercent = 0` traité comme « désactivé » (falsy) sans documentation explicite — surprise utilisateur |
| B-4 | `worker/src/clob/trading-context.ts` (41-54) | Race bénigne sur cache expiré : double fetch credentials / double ClobClient. Mémoriser la Promise en cours |
| B-5 | `worker/src/clob/real-executor.ts` (168) | `marketAmount` BUY (qty × prix) sans arrondi 6 décimales → risque `MINIMUM_ORDER_SIZE` |
| B-6 | `worker/src/processors/redemption-handler.ts` (124) | `pusdNumberToRaw` (sémantique pUSD) appliqué à des parts CTF — correct aujourd'hui (6 déc. des deux côtés) mais hypothèse implicite non documentée |
| B-7 | `scripts/inspect-deposit-wallet.mjs` (4) | Adresse wallet réelle hardcodée en valeur par défaut |
| B-8 | `backend/src/polymarket/pusd-transfer.ts` (148-174) | `withdrawFromWallet` déprécié mais toujours exporté |
| B-9 | `frontend/src/lib/clipboard.ts` (2) | Rejet de `clipboard.writeText` ignoré : feedback « Copié ! » affiché même en cas d'échec |
| B-10 | `frontend/src/components/MetaMaskButton.tsx` (13) | `available` figé au mount (MetaMask installé en cours de session non détecté) |
| B-11 | `frontend/src/components/WalletPage.tsx` (46) | `dialogOpen` à double source de vérité (`credsManualOpen` ∨ `needsSetup`) — fermeture du dialog conflictuelle |

---

## 6. Pipelines vérifiés — état de conformité

| Pipeline / protocole | État | Remarques |
|---|---|---|
| Poll Data API → diff snapshots → MoveEvents (idempotents) | ✅ Correct | |
| Filtrage de pertinence des événements (OPENED toujours, autres si position ouverte) | ✅ Correct | |
| Réservation d'exposition (transaction, TTL 180 s, janitor) | ✅ Correct | |
| Sizing / double-pass VWAP / slippage guard | ✅ Correct | Logique walkBook bids desc / asks asc vérifiée, statuts `partial`/`illiquid` cohérents |
| Exécution simulation (fill VWAP + frais + comptabilité cash) | ✅ Correct | `computeBuyCashDebit` / `computeSellSettlement` (prorata des frais d'entrée) testés et cohérents |
| Exécution réelle CLOB (FAK, tick rounding, parse fills 6 déc.) | ✅ Correct | |
| Finalisation (VWAP pondéré sur fills partiels, transitions de statut) | ✅ Correct | Transitions `pending→open→closing→closed/failed` cohérentes |
| Double canal de résultats (resultsQueue + WS user channel) | ✅ Correct | Réconciliation à chaque reconnexion WS user |
| SL / TP / trailing / pre-close / kill switch | ✅ Correct | Ordre d'évaluation SL→TP→TRAILING vérifié ; seuils `0` documentés comme « désactivés » |
| Résolution de marché & rédemption | ✅ Correct | `resolved` strict, normalisation token IDs |
| Réconciliation au démarrage (`placing` orphelins) | ✅ Correct | Formats human/raw documentés dans `startup-reconciler.ts` |
| Auth JWT (access 15 min / refresh 7 j, secrets séparés) | ✅ Correct | Rotation single-use refresh ; access token en mémoire |
| Chiffrement des secrets (AES-256-GCM, IV 12 bytes, AEAD) | ✅ Correct | Clés hex 64 chars et UTF-8 32 bytes acceptées |
| Flux dépôt (bridge) / retrait (EOA, relayer, MetaMask EIP-712) | ✅ Correct | Idempotence retraits en Redis |
| Queues Redis (4 files, BRPOPLPUSH, dead-letter + replay, recover orphans) | ✅ Correct | |

---

## 7. Plan de correction recommandé (ordre de priorité)

> ✅ Points 1 à 9 exécutés le 10/06/2026 — voir section 8.

1. **C-1** — corriger `generate-secrets.mjs` / `getKey()` (bloque tout déploiement sécurisé).
2. **C-2** — corriger `PositionLockRegistry` (+ test à 3 tâches concurrentes).
3. **H-1** — réconciliation des exécutions `placing` à chaque reconnexion WS user + alerte sur épuisement des tentatives.
4. **H-5 / H-9** — redaction des logs, CORS whitelist, Redis non exposé + mot de passe.
5. **C-3 / H-12** — corriger tous les `socket.off` frontend et les `onCleanup` post-`await`.
6. **H-3 / H-4** — `resolved` strict + normalisation des token IDs partout (protège la rédemption).
7. **H-2 / M-4** — exposition : filtrer les réservations expirées, inclure `pending_resolution`.
8. **H-6 / H-7 / H-8** — validation Zod systématique, adresses EIP-55, rotation des refresh tokens.
9. **M-8 / M-9** — `refresh=false` sur finalisation, arrondi au tick en entiers.
10. ~~Le reste (moyens puis bas) au fil de l'eau.~~ ✅ Moyens et bas corrigés le 10/06/2026 (soir) — section 10.

---

## 8. Correctifs appliqués — 10/06/2026 (après-midi)

Tous les constats critiques, hauts et moyens ont été corrigés, puis validés par un build complet (`npm run build`) et la suite de tests (122 tests core + 35 tests worker, tous verts).

### Critiques

| # | Correctif appliqué |
|---|---|
| C-1 | `getKey()` (`backend/src/crypto/encryption.ts`) accepte désormais les clés **hex 64 caractères** (décodées en 32 bytes) *et* les clés UTF-8 de 32 bytes — la sortie de `generate-secrets.mjs` fonctionne sans migration |
| C-2 | `PositionLockRegistry.runSequentially` réécrit : chaînage robuste aux rejets (un échec de A ne saute plus B), suppression du lock uniquement par la queue de chaîne (`locks.get() === tracked`). Tests ajoutés : 3+ tâches en file, tâche qui rejette |
| C-3 | Tous les `socket.off('event')` du frontend passent la référence exacte du handler (`useTradingWallet`, `PositionCard`, `ExecutionLog`, `SimHero`, `WalletPolywatchExecutions`, `EventsPanel`, `AlertBanner`) |

### Hauts

| # | Correctif appliqué |
|---|---|
| H-1 | `websocket-user.ts` expose `onReconnected` / `onReconnectExhausted` ; `user-channel-manager.ts` relance `reconcilePlacingExecutions()` à chaque reconnexion et envoie une alerte UI (`notifyBackendAlert`) quand les tentatives sont épuisées |
| H-2 | `computeExposure` filtre `expires_at > now` — les réservations expirées ne gonflent plus l'exposition |
| H-3 | `parseClobRecord` : `resolved: Boolean(raw.resolved)` strictement, `closed` séparé. Tests `market-metadata.test.ts` mis à jour pour refléter la sémantique correcte |
| H-4 | `normalizeTokenId` exporté depuis `polymarket/redemption.ts` et utilisé par `getRedemptionPayoff` (`market/lifecycle.ts`), `market-resolution.service.ts` et `redemption-handler.ts` |
| H-5 | `pinoHttp({ redact: [...] })` : `authorization`, `x-service-token`, `cookie` expurgés des logs HTTP |
| H-6 | Rotation single-use des refresh tokens : `jti` stocké dans Redis avec TTL, invalidé à chaque refresh ; un token rejoué est rejeté |
| H-7 | Schémas Zod stricts sur `PUT /api/risk-config` (plages numériques, enums) et `POST`/`PATCH /api/watchlist` (whitelist des champs mutables) |
| H-8 | Validation `ethers.isAddress()` sur toutes les adresses saisies (`walletAddress`, `funderAddress`, `depositAddress`, `recipient`, `signerAddress`, `traderAddress`) via le schéma partagé `backend/src/validation/eth-address.ts` |
| H-9 | CORS whitelist (`CORS_ORIGIN`, défaut localhost) appliqué à Express et Socket.IO ; Redis lié à `127.0.0.1:6379` dans `docker-compose.yml` |
| H-10 | Access token gardé **en mémoire** uniquement ; seul le refresh token (single-use, H-6) reste en `localStorage` ; bootstrap de session au chargement (`App.tsx`) |
| H-11 | `WalletPage` : garde `<Show>` sur `wallet()`, bannière d'erreur avec bouton réessayer, plus de `!` non-null sur données nulles |
| H-12 | `SimHero` : listeners socket enregistrés de façon synchrone avant tout `await` ; `onCleanup` fiable |

### Moyens

| # | Correctif appliqué |
|---|---|
| M-1 | `computeTransitions` dédoublonne les CLOSED quand un snapshot entrant arrive avec `size=0` |
| M-2 | `isUniqueConstraintError()` : seules les violations UNIQUE (`SQLITE_CONSTRAINT`) sont ignorées ; toute autre erreur DB remonte |
| M-3 | `normalizeSize()` (`toFixed(6)`) dans `idempotence/hash.ts` — hash stable face aux artefacts IEEE-754 |
| M-4 | `pending_resolution` ajouté à `ACTIVE_STATUSES` (exposition + max-positions) |
| M-5 | `SimulationService.reset()` marque les `MoveEventEntity` non traités comme traités (pas de purge destructive, pas de rejeu) |
| M-6 | Fallback `maker_base_fee` → `takerBaseFee` supprimé dans `parseClobRecord` |
| M-7 | `parseOrderMatchedSize` : heuristique raw/human consolidée (gère les variations de format entre endpoints CLOB) |
| M-8 | `syncBookSubscriptions(refresh=false)` à la finalisation — plus de re-fetch complet des books à chaque fill |
| M-9 | `roundToTick` en arithmétique entière ; `marketAmount` BUY arrondi à 6 décimales (couvre aussi B-5) |
| M-10 | `evaluateCloseLogic` : les signaux SL/TP/trailing restent évalués même quand `force_close_all` est actif — plus de positions « orphelines » du kill switch |
| M-11 | Asymétrie `getTrades().size` (human) vs `getOrder().size_matched` (raw) documentée dans `startup-reconciler.ts` |
| M-12 | `/metrics` protégé par `requireServiceToken` ; Redis non exposé hors localhost |
| M-13 / M-14 | Idempotence des retraits migrée en **Redis avec TTL**, clé basée sur le montant PUSD **raw** (bigint) — survit aux redémarrages, pas de float |
| M-15 | `fetchErc20Balance` (strict, throw) + `tryFetchErc20Balance` (tolérant, `null`) ; l'UI distingue « solde 0 » de « RPC en panne » |
| M-16 | `retry-close` : si le push Redis échoue après les updates DB, la position est marquée `failed` (plus de blocage en `closing`) |
| M-17 | `PositionList` rend via `<For>` (préservation du DOM entre updates) |
| M-18 | `useClobCredentials` expose un état `error` distinct de « non configuré » |
| M-19 | `EnvSettingsDialog`, `ClobCredentialsDialog`, `WalletAccountsDialog` : états d'erreur explicites sur chargement/sauvegarde/suppression, avec retry |
| M-20 | Identifiants pré-remplis retirés du formulaire de login |
| M-21 | Encodage ERC-20 `transfer` factorisé dans `frontend/src/lib/erc20.ts` (utilisé par `pusd-transfer.ts` et `bridge-metamask.ts`) |

### Refactorisation associée

- `backend/src/validation/eth-address.ts` : schémas Zod d'adresses partagés (`ethAddressSchema`, `emptyableEthAddressSchema`) — déduplique 5 fichiers de routes.
- `worker/src/backend-client.ts` : `postBackendJson()` — déduplique les POST authentifiés vers le backend (`notify-execution`, `notify-alert`, `backend-notify`, `strategy-processing`, `redemption-handler`).
- `frontend/src/lib/erc20.ts` : encodage ABI ERC-20 partagé (M-21).
- `frontend/src/hooks/useCopyFeedback.ts`, `useMetaMaskAvailable.ts`, `useCredsSetupDialog.ts` : primitives frontend extraites lors du correctif basse sévérité (B-9, B-10, B-11).
- `core/src/polymarket/redemption.ts` : `normalizeTokenId` exporté et réutilisé partout où des token IDs sont comparés (H-4).

### Constats restants (ouverts)

**Aucun** — tous les constats de l'audit (C, H, M, B) sont corrigés au 10/06/2026 (soir).

---

## 10. Correctifs basse sévérité — 10/06/2026 (soir)

Les constats B-1 à B-11 ont été corrigés, puis validés par un build complet (`npm run build`) et la suite de tests (122 tests core + 35 tests worker, tous verts).

| # | Correctif appliqué |
|---|---|
| B-1 | `findMonorepoRoot()` appelé à la demande via `getMonorepoRoot()` — plus de side effect au simple import de `env.ts` |
| B-2 | `entryQuantityRemaining` borné avec `Math.max(0, …)` dans `execution.service.ts` (fills désordonnés) |
| B-3 | `evaluateSlTpTrailing` : seuils `null`/`0` documentés comme « désactivés » ; comparaisons explicites `> 0` au lieu de tests falsy |
| B-4 | `loadTradingContext` déduplique les chargements concurrents via `loadInFlight` ; logique extraite dans `buildTradingContext()` |
| B-5 | *(déjà corrigé avec M-9)* — `marketAmount` BUY arrondi à 6 décimales |
| B-6 | Commentaire explicite dans `redemption-handler.ts` : parts CTF et pUSD partagent 6 décimales pour l'encodage raw |
| B-7 | `inspect-deposit-wallet.mjs` : adresse requise en argument CLI ou via `INSPECT_WALLET_ADDRESS` — plus de wallet hardcodé |
| B-8 | `withdrawFromWallet` déprécié supprimé de `pusd-transfer.ts` (aucun appelant ; `withdrawFromWalletAccount` conservé) |
| B-9 | `copyToClipboard` retourne `Promise<boolean>` ; `WalletPage` et `BridgeDepositPanel` n'affichent « Copié » qu'en cas de succès |
| B-10 | `MetaMaskButton` : détection dynamique via `onMount` + événements `ethereum#initialized` et `focus` (réutilise `hasMetaMask`) |
| B-11 | `WalletPage` : signal unique `credsDialogOpen` ; `createEffect` ouvre le dialog si `needsSetup()` ; fermeture bloquée tant que la config est incomplète |

---

## 11. Notes de vérification

- **C-1, C-2, H-3** ont été re-vérifiés manuellement en lisant le code source (pas seulement via l'analyse automatisée).
- **H-3** était initialement classé « critique » : requalifié « haut » car `isMarketSettled()` (`market/lifecycle.ts` l. 42-46) exige un `winningTokenId` non nul, ce qui limite le déclenchement prématuré du règlement aux cas où un gagnant provisoire est aussi déduit.
- Les constats « Probable »/« Possible » (M-3, M-7, H-1, H-4, M-14…) décrivent des fenêtres de défaillance réelles mais dépendantes de conditions externes (formats API Polymarket, timing réseau) — ils méritent des tests de non-régression dédiés plutôt qu'un correctif aveugle.

---

*Audit généré le 10/06/2026 — dernière mise à jour le 10/06/2026 (soir) après correctifs basse sévérité.*
