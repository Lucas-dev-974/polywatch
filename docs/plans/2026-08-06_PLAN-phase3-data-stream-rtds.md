# Plan d'implémentation — Phase 3 Data stream RTDS (suite)

**Date** : 2026-08-06 (rev. 2 — décisions d'implémentation tranchées)  
**Parent** : [`2026-08-05_PLAN-strategies-crypto-algo-5min.md`](./2026-08-05_PLAN-strategies-crypto-algo-5min.md) (rev. 5)  
**Portée** : Phase **3.A + 3.B + 3.C** uniquement — **pas** Phase 4 (S9/S3/S1/S2) ni Phase 5.  
**Statut** : spec conservée — **désimplémenté / reporté 2026-08-07** (aucune implémentation Phase 3 dans le code ; ne pas reprendre sans décision produit explicite).  

> **Rev. 2** — 8 décisions tranchées en session 2026-08-06 (§13). Les §2/§3/§5 ci-dessous sont mis à jour ; en cas de divergence, **§13 fait foi**.

---

## 0. Prérequis (déjà faits)

| Item | Statut | Preuve |
|---|---|---|
| Phases 0–2 code (stop-bleed, hygiène, multi-stratégie) | Fait | Parent plan rev. 5, checkboxes 0–2 |
| Correctifs pré-Phase 3 (build `StrategyContext`, `resolveStrategyMinTimeToClose`, clear timers mid, rotation `cryptoAlgoStrategyParams`) | Fait | session 2026-08-06 |
| Migrations `0093` + `0094` appliquées | Fait | `npm run migration:run -w @polywatch/core` → `Database migrated` |
| Stop-bleed DB | Fait | `sl=false`, `tp=true`, `entryPriceMin=0.55`, purge ticks `false`, `strategy_params={}` |
| Export `algo_price_ticks` CSV | Fait | `exports/algo_price_ticks_2026-08-06.csv` (~795 108 lignes + header) |

---

## 1. Objectif & non-objectifs

### Objectif

Brancher une **couche data stream oracle** dans crypto-algo, configurable depuis **Système → Configs**, avec :

1. **Défaut** : Polymarket RTDS Chainlink TWAP (gratuit, aligné settlement).
2. Modes RTDS spot / Binance / book_only.
3. Mode **Chainlink Direct** opt-in (payant) + secrets BDD write-only.
4. Health Postgres lisible par le backend/UI (worker mort détecté &lt; 15 s).
5. Exposition dans `StrategyContext` pour S1/S2 (Phase 4) **sans** activer ces stratégies ici.

### Non-objectifs (hors scope)

- Implémenter S9 / S3 / S1 / S2 (Phase 4).
- Backtest / purge `algo_oracle_ticks` (Phase 5 / D16).
- Bascule auto de mode ou substitut spot si TWAP down (interdit D7/D8/D11).
- Mélanger les knobs data stream dans l’UI crypto-algo (tunables stratégie).

---

## 2. Décisions héritées (verrouillées — parent D1–D16)

Ne pas rouvrir sauf bug bloquant :

| # | Règle |
|---|---|
| D1 | Health worker → Postgres `crypto_algo_data_stream_status`, heartbeat **5 s** |
| D2 | `config-changed` kind **`crypto_algo.data_stream`** uniquement pour clés data stream |
| D3/D9 | Boot : recharger **K** depuis `algo_oracle_strikes` ; S1/S2 abstiennent si K absent |
| D4/D15 | Fraîcheur à **2 compteurs indépendants** (rev. 2) : `lastWsActivityAt` (PING inclus, `connected`) **et** `lastPriceAt` (messages prix uniquement, staleness valeur). `connected` = `now − lastWsActivityAt ≤ 5 s` ; valeur fresh = `now − lastPriceAt ≤ 30 s` pour TWAP. Les deux doivent être vrais pour trader. |
| D5 | σ̂ « par √seconde », EWMA log-returns 1 s, demi-vie 30 s, λ≈0,977, **σ_min appliqué sur σ̂ à la lecture** = `σ̂ = max(sqrt(σ̂²), 1e−6)` (rev. 2), warm-up ≥ 30 ticks |
| D6 | Table dédiée **`algo_oracle_ticks`** (sans `strike_k`) + table dédiée **`algo_oracle_strikes`** (rev. 2) |
| D7/D8 | Badge rouge + abstention ; **pas** de `fallback_mode` |
| D10 | K = premier spot Chainlink à/après `eventStartTime`, stocké dans `algo_oracle_strikes` (rev. 2) |
| D11 | Interdit substituer spot si TWAP down — `getTwap()` retourne **`null` strict** en mode twap si aucun tick TWAP ≤ 30 s, même si spot disponible (rev. 2) |
| D12 | `updated_at` health &gt; 15 s ⇒ disconnected |
| D13 | Secrets Chainlink Direct en BDD + UI write-only |
| D16 | Pas de purge `algo_oracle_ticks` en MVP |

---

## 3. Décisions d'implémentation (tranchées rev. 2 — cf. §13)

| ID | Décision | Pourquoi |
|---|---|---|
| **I1** | Étendre `publishConfigChanged` : `'global' \| 'copy' \| 'crypto' \| 'weather' \| 'crypto_algo.data_stream'` | Kind D2 absent aujourd’hui (`packages/backend/src/redis.ts:13`) |
| **I2** | `PUT /api/system-config/:key` publie Redis **seulement** si `key.startsWith('crypto_algo.data_stream.')` | Aujourd’hui le PUT system-config ne publie pas (`system-config.ts:41-50`) |
| **I3** | Secrets Chainlink : **table dédiée** `chainlink_data_stream_credentials` (colonnes chiffrées `client_id_enc`, `client_secret_enc`) — pattern `ClobCredentials` (`config.ts:385-444`), **pas** dans `system_config.value` | Évite fuite via `GET /api/system-config` |
| **I4** | Health : **1 ligne singleton** `id=1` upsertée toutes les 5 s. **Au boot, upsert immédiat** `connected=false, fresh=false` avant `start()` (déc. 5) | Simple pour D12 ; évite flash rouge trompeur au redémarrage |
| **I5** | Enrichir `SpotDataSlot` : timestamps **par champ** (`spotAt`, `twapAt`, `strikeKAt`, `sigmaAt`) + garder `fresh` dérivé. **`fresh` global = `connected` (WS, PING inclus) ET valeur non stale (`twapAt ≤ 30 s` en mode TWAP)** | D4/D15 avec 2 compteurs (déc. 4) ; stub actuel n'a qu'un seul `timestamp` (`strategy.ts:35-43`) |
| **I6** | Valeurs TWAP/spot : préférer string décimale / `full_accuracy_value` (E18) convertie en `number` haute précision côté provider ; logger raw si parse fail → stale | Doc RTDS Polymarket |
| **I7** | Mapping symbole : table code `BTC→btc/usd`, `ETH→eth/usd`, `SOL→sol/usd`, `XRP→xrp/usd` ; inconnu → pas de subscribe + abstention oracle | Explicite, pas de guess |
| **I8** | Ordre d’implémentation livrable : **3.A → 3.C (sans Chainlink Direct UI) → 3.B → finaliser 3.C secrets** | UI mode RTDS utile avant secrets payants |
| **I9** | Mode défaut seed : `rtds_chainlink_twap` ; URL `wss://ws-live-data.polymarket.com` | Parent |
| **I10** | Tests : unit provider (parse msgs, freshness, reconnect) + migration + API status/secrets ; smoke WS optionnel derrière flag | CI sans dépendance RTDS live |
| **I11** *(rev.2)* | **`setDesiredSymbols()` est différé** : stocke la liste désirée, applique au prochain cycle subscribe/resubscribe (idempotent). Jamais en plein milieu d'un resubscribe (déc. 6) | Évite race → symboles partiels |
| **I12** *(rev.2)* | **Hot-reload = replace-then-stop** : `createNew → start(new) → stop(old)`. Ancien provider marqué `stopped=true` → ses callbacks recorder/heartbeat sont ignorés (déc. 7). `stop()` avec timeout 3 s + force close si échoue | Évite double connexion RTDS + écrasement health par ancien provider |
| **I13** *(rev.2)* | **`getTwap()` null strict en mode twap** si aucun tick TWAP ≤ 30 s, **même si spot disponible** (déc. 8). Spot sert uniquement à capturer K (D10) | D11 — pas de substitut silencieux |

---

## 4. Architecture cible

```
                    ┌─────────────────────────────┐
                    │  Système → Configs (UI)     │
                    │  DataStreamModeTab          │
                    └─────────────┬───────────────┘
                                  │ PUT system-config / secrets
                                  ▼
                    ┌─────────────────────────────┐
                    │  Backend                    │
                    │  system-config + publish D2 │
                    │  GET data-stream-status     │
                    │  Chainlink secrets write-only│
                    └─────────────┬───────────────┘
                                  │ Redis config-changed
                                  │ kind=crypto_algo.data_stream
                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  crypto-algo worker                                          │
│  createSpotPriceProvider(mode)                               │
│    ├─ RtdsSpotPriceProvider  (WS RTDS)                       │
│    ├─ BookOnlySpotProvider                                   │
│    └─ ChainlinkDirectSpotProvider (opt-in)                   │
│  SigmaEwma + strike K capture/reload                         │
│  persist algo_oracle_ticks (1 Hz)                            │
│  heartbeat crypto_algo_data_stream_status (5 s)              │
│  StrategyRunner → StrategyContext.spotData                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Phase 3.A — Backend RTDS (~2–3 j)

### 5.1 Fichiers nouveaux (crypto-algo)

| Fichier | Rôle |
|---|---|
| `packages/crypto-algo/src/data-stream/types.ts` | Modes, `SpotQuote`, `TwapQuote`, `DataStreamHealth`, `SpotPriceProvider` |
| `packages/crypto-algo/src/data-stream/symbol-map.ts` | Mapping asset → filtre RTDS |
| `packages/crypto-algo/src/data-stream/rtds-client.ts` | WS brut : connect, PING 5 s, subscribe/resubscribe, backoff |
| `packages/crypto-algo/src/data-stream/rtds-spot-provider.ts` | `RtdsSpotPriceProvider` |
| `packages/crypto-algo/src/data-stream/book-only-provider.ts` | No-op |
| `packages/crypto-algo/src/data-stream/factory.ts` | `createSpotPriceProvider(mode, opts)` |
| `packages/crypto-algo/src/data-stream/sigma-ewma.ts` | EWMA D5 |
| `packages/crypto-algo/src/data-stream/strike-k.ts` | Capture K + reload DB |
| `packages/crypto-algo/src/data-stream/oracle-tick-recorder.ts` | Persist 1 Hz → `algo_oracle_ticks` |
| `packages/crypto-algo/src/data-stream/health-heartbeat.ts` | Upsert status 5 s |
| `packages/crypto-algo/src/data-stream/*.test.ts` | Unit tests |

### 5.2 Fichiers nouveaux / migrés (core)

| Fichier | Rôle |
|---|---|
| `packages/core/src/entities/AlgoOracleTick.ts` | Entité D6 (sans `strike_k`) |
| `packages/core/src/entities/AlgoOracleStrike.ts` | Entité table dédiée strikes (rev. 2) |
| `packages/core/src/entities/CryptoAlgoDataStreamStatus.ts` | Entité health D1 |
| Migration `AddAlgoOracleTicksAndStrikesAndDataStreamStatus…` | 3 tables + indexes (rev. 2) |
| Seed `system-config-defaults.ts` | `crypto_algo.data_stream.mode`, `crypto_algo.data_stream.rtds_url` |
| Export entities dans `entities/index.ts` + `data-source.ts` | |

**Schéma MVP `algo_oracle_ticks`** (rev. 2 — `strike_k` retiré, table dédiée)

```
id BIGSERIAL PK
condition_id TEXT NOT NULL
symbol TEXT NOT NULL
spot_usd DOUBLE PRECISION NULL
twap_usd DOUBLE PRECISION NULL
twap_window_s INT NULL                  -- 30 | 60
source TEXT NOT NULL                    -- rtds_twap | rtds_chainlink_spot | …
recorded_at TIMESTAMPTZ NOT NULL
INDEX (condition_id, recorded_at)
INDEX (symbol, recorded_at)
```

**Schéma MVP `algo_oracle_strikes`** (rev. 2 — table dédiée, D9 reload O(1))

```
condition_id TEXT PK
strike_k DOUBLE PRECISION NOT NULL
symbol TEXT NOT NULL
source TEXT NOT NULL                    -- rtds_chainlink_spot
captured_at TIMESTAMPTZ NOT NULL
```

Rationale déc. 1 : la colonne `strike_k` nullable sur `algo_oracle_ticks` aurait été clairsemée (écrite une seule fois) + sujette à race sur la contrainte UNIQUE partielle en cas de capture concurrente. La table dédiée `algo_oracle_strikes(condition_id PK)` garantit l'unicité par construction (upsert PK) et un reload boot O(1) par marché.

**Schéma MVP `crypto_algo_data_stream_status`**

```
id INT PK DEFAULT 1 CHECK (id = 1)
mode TEXT NOT NULL
connected BOOLEAN NOT NULL
subscribed BOOLEAN NOT NULL
fresh BOOLEAN NOT NULL
last_update_at TIMESTAMPTZ NULL
error TEXT NULL
updated_at TIMESTAMPTZ NOT NULL
```

### 5.3 Interface provider

```ts
interface SpotPriceProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSpot(symbol: string): SpotQuote | null;
  getTwap(symbol: string, windowSeconds: 30 | 60): TwapQuote | null;
  getHealth(): DataStreamHealth;
  /** Idempotent et différé : stocke la liste, applique au prochain cycle (rev. 2 déc. 6). */
  setDesiredSymbols(symbols: string[]): void;
}

type SpotQuote = { value: number; timestampMs: number; source: string };
type TwapQuote = SpotQuote & { windowSeconds: 30 | 60 };
type DataStreamHealth = {
  mode: DataStreamMode;
  connected: boolean;        // now − lastWsActivityAt ≤ 5 s (PING inclus — rev. 2 déc. 4)
  subscribed: boolean;
  fresh: boolean;            // connected ET now − lastPriceAt ≤ 30 s en mode TWAP
  lastWsActivityAt: number | null;   // dernier PING/PONG ou message prix
  lastPriceAt: number | null;        // dernier message PRIX uniquement (TWAP/spot/Binance)
  error?: string;
};
```

**Règle D11 stricte (rev. 2 déc. 8)** : en mode `rtds_chainlink_twap`, `getTwap()` retourne **`null`** si aucun tick TWAP ≤ 30 s est disponible — **même si** un spot Chainlink récent est en cache. Le spot n'est jamais un substitut de TWAP ; il sert uniquement à capturer K (D10) et à alimenter `getSpot()` en mode `rtds_chainlink_spot`.

### 5.4 RTDS — protocole (rappel)

- URL : `wss://ws-live-data.polymarket.com` (overridable).
- Heartbeat texte `PING` / 5 s.
- Topics :
  - TWAP 30 : `crypto_prices_twap_thirty` filtre `{"symbol":"btc/usd"}`
  - TWAP 60 : `crypto_prices_twap_sixty`
  - Spot K : `crypto_prices_chainlink` (**capture K seulement**, jamais substitut TWAP)
  - Binance mode : `crypto_prices` filtre CSV `btcusdt,…`
- Après reconnect : **resubscribe toutes** les subscriptions.
- Mode `rtds_chainlink_twap` + topic TWAP stale/rejeté → `lastPriceAt` figé ⇒ valeur stale ⇒ `fresh=false` (valeur) + stratégies oracle abstiennent (D11). Note : `connected` peut rester `true` (PING actif) mais `fresh` global = `connected` **ET** valeur non stale (déc. 4).

### 5.5 Wiring crypto-algo

1. Boot : lire mode + url depuis `SystemConfig` (ou API backend service-token si déjà le pattern).
2. **Upsert immédiat** health `connected=false, fresh=false` **avant** `start()` (rev. 2 déc. 5) — évite flash rouge trompeur sur row héritée d'un crash précédent.
3. `createSpotPriceProvider` → `start()`.
4. Reload K depuis `algo_oracle_strikes` (table dédiée) pour markets actifs.
5. `StrategyRunner` remplit `spotData` (aujourd'hui hardcodé `null`) :
   - spot / twap / strikeK / sigma + timestamps I5
   - `fresh` = `health.connected` (WS alive, PING inclus) **ET** `now − twapAt ≤ 30 s` en mode TWAP
   - Les deux conditions indépendantes (rev. 2 déc. 4) : `connected` seul ne suffit pas (socket alive sans prix = stale valeur).
6. Sur `config-changed` avec `kind === 'crypto_algo.data_stream'` : **replace-then-stop** (rev. 2 déc. 7) :
   - `const next = createSpotPriceProvider(newMode, opts); await next.start();`
   - `await stop(old)` — l'ancien provider porte un flag interne `stopped=true` ; recorder/heartbeat vérifient ce flag avant d'écrire → évite qu'une fermeture lente écrase la row health du nouveau (bug fantôme clignotement disconnected).
   - Accepte un overlap court (~1 s) ; pas de `stop()` bloquant avant `start()` (risque de double connexion si WS figée).
7. `setDesiredSymbols` est **idempotent et différé** (rev. 2 déc. 6) : stocke la liste désirée, applique au prochain cycle subscribe/resubscribe — jamais en plein milieu d'une resubscribe en cours.
8. Shutdown : `stop(provider)` + clear heartbeat.

### 5.6 Backend API health (support 3.A / 3.C)

- `GET /api/system/data-stream-status` (JWT) :
  - Lit singleton status
  - Si `now - updated_at > 15s` ⇒ forcer `connected=false`, `status='disconnected'` (D12)
  - Réponse JSON stable pour badge UI

### 5.7 Critères d’acceptation 3.A

- [ ] Mode défaut seedé `rtds_chainlink_twap`
- [ ] WS connect + subscribe BTC/ETH (smoke manuel ou test mock)
- [ ] Health row rafraîchie ≤ 5 s ; API ⇒ disconnected si worker stoppé &gt; 15 s
- [ ] Upsert initial `connected=false, fresh=false` au boot avant `start()` (rev. 2 déc. 5)
- [ ] `z = ln(S/K)/(σ̂√T)` calculable en unit test avec fixtures (K + TWAP + σ warm)
- [ ] `σ̂ = max(sqrt(σ̂²), 1e−6)` à la lecture ; σ̂² non planché (rev. 2 déc. 2)
- [ ] TWAP down ⇒ `getTwap()` retourne `null` même si spot récent disponible (D11 strict, déc. 8)
- [ ] 2 compteurs distincts : `lastWsActivityAt` (PING inclus) vs `lastPriceAt` (prix uniquement) (déc. 4)
- [ ] Hot-reload mode via Redis kind D2 : **replace-then-stop**, ancien flag `stopped=true` (déc. 7)
- [ ] `setDesiredSymbols` différé (appliqué au prochain cycle, pas en plein resubscribe) (déc. 6)
- [ ] Table `algo_oracle_strikes` créée + reload boot O(1) par marché (déc. 1)
- [ ] Builds + tests unitaires verts

---

## 6. Phase 3.B — Chainlink Direct (~1–2 j)

### 6.1 Secrets BDD

| Fichier | Rôle |
|---|---|
| Entity `ChainlinkDataStreamCredentials` | `clientIdEnc`, `clientSecretEnc`, timestamps |
| Migration | Table |
| Routes backend | `GET …/status` → `{ credentialsConfigured: boolean }` **uniquement** ; `PUT/POST` écrit chiffré via `encrypt()` (même `MASTER_ENCRYPTION_KEY` que CLOB) ; **jamais** renvoyer secrets |
| Worker lecture | Service-token internal route **ou** lecture DB directe chiffrée côté crypto-algo (préférer **internal backend** pour centraliser decrypt) |

Pattern de référence : `GET /api/config/clob-credentials/status` + `POST /api/config/clob-credentials` (`packages/backend/src/routes/config.ts`).

### 6.2 Provider

- `ChainlinkDirectSpotProvider` implémente `SpotPriceProvider`.
- Factory refuse `mode=chainlink_direct` si `credentialsConfigured=false` → health.error + reste disconnected (pas de fallback silencieux).
- Doc opérateur courte : `docs/crypto-algo-data-stream.md` (quand RTDS vs direct).

### 6.3 Critères 3.B

- [ ] GET status ne leak jamais les secrets
- [ ] Mode direct impossible sans credentials
- [ ] Changement credentials → publish kind D2 → reconnect
- [ ] Doc opérateur rédigée

---

## 7. Phase 3.C — UI Système → Configs (~1–2 j)

### 7.1 Navigation

```
Système
├── Overview
├── Rapports
├── Snapshots
├── …
└── Configs                         ← nouveau SystemPageTab
    └── Data stream mode            ← sous-onglet MVP
```

| Couche | Fichier |
|---|---|
| Tab enum | `packages/frontend/src/lib/ui-persistence.ts` — ajouter `'configs'` à `SystemPageTab` / `SYSTEM_PAGE_TABS` |
| Page | `packages/frontend/src/components/SystemConfigsPage.tsx` |
| Sous-onglet | `packages/frontend/src/components/system-configs/DataStreamModeTab.tsx` |
| Routing | `packages/frontend/src/components/SystemPage.tsx` + `TAB_LABELS` |
| Metadata | `packages/frontend/src/components/system-config-metadata.ts` (labels/descriptions) |
| API client | `packages/frontend/src/api.ts` — helpers status / PUT mode / secrets |

### 7.2 Contenu Data stream mode

- Cards / radios des 5 modes (TWAP recommandé, spot, Binance, book_only, Chainlink direct).
- Pour chaque mode : 1 ligne description + alignement résolution + coût.
- Badge live (poll 10 s) : `GET /api/system/data-stream-status`.
- Enregistrer → PUT `crypto_algo.data_stream.mode` (+ url si exposée) → feedback « redémarrage flux… ».
- Section Chainlink direct : champs write-only + checkbox confirmation coût + disable si non configuré.

### 7.3 Critères 3.C

- [ ] Tab visible + persisté (`ui-persistence`)
- [ ] Mode persisté, visible après refresh
- [ ] Health &lt; 10 s ; worker mort ⇒ disconnected &lt; 15 s
- [ ] Chainlink direct grisé sans credentials ; secrets jamais préremplis

---

## 8. Séquençage d’exécution recommandé

```
J1     3.A.1–4   types + RTDS client + BookOnly + factory + seed
J1–J2  3.A.5–7   σ EWMA + K + oracle ticks + StrategyContext
J2     3.A.8–10  health heartbeat + API status + hot-reload D2
J3     3.C MVP   tab Configs + DataStreamModeTab (sans secrets)
J3–J4  3.B       table secrets + provider + garde-fous
J4     3.C fin   UI secrets + doc opérateur + critères globaux
```

Parallélisation possible : UI 3.C MVP dès que `GET data-stream-status` + seed mode existent (même si provider encore mock/book_only).

---

## 9. Plan de tests

| Couche | Cas |
|---|---|
| Unit RTDS parse | message TWAP valide / `full_accuracy_value` / topic rejected |
| Unit freshness (déc. 4) | `lastWsActivityAt` &gt; 5 s ⇒ `connected=false` ; `lastPriceAt` &gt; 30 s ⇒ valeur stale même si `connected=true` (PING seul ne rafraîchit pas `lastPriceAt`) |
| Unit D11 (déc. 8) | `getTwap` null en mode twap si seul spot dispo (même spot récent ≤ 5 s) |
| Unit σ (déc. 2/3) | warm-up &lt; 30 ⇒ sigma null ; après 30 ticks ⇒ `σ̂ = max(sqrt(σ̂²), 1e−6)` ≥ 1e−6 ; vérifier que σ̂² non planché |
| Unit K (déc. 1) | premier spot ≥ eventStartTime → upsert `algo_oracle_strikes` PK `condition_id` ; reload boot O(1) |
| Unit hot-reload (déc. 7) | `config-changed` → nouveau provider `start()` avant `stop(old)` ; ancien flag `stopped=true` → n'écrit plus health/ticks |
| Unit setDesiredSymbols (déc. 6) | appel pendant resubscribe → liste appliquée au cycle suivant, pas de symboles partiels |
| API | status 15 s rule ; secrets status boolean-only |
| Integration manuelle | docker up → worker → badge UI connected ; kill worker → disconnected ; hot-reload mode sans clignotement |

---

## 10. Risques & garde-fous (rappel)

- Pas de bascule auto de mode (D8).
- Pas de substitut spot pour TWAP (D11).
- Secrets jamais dans logs / GET list system-config.
- Volume `algo_oracle_ticks` : pas de purge MVP ; monitorer taille disque (Phase 5 si besoin).
- Un seul writer health (crypto-algo) — pas de multi-replica sans redesign I4.

---

## 11. Livrables de fin de Phase 3

1. Provider RTDS opérationnel en sim avec health UI.
2. Tables `algo_oracle_ticks` (+ strikes) + `crypto_algo_data_stream_status` + secrets Chainlink.
3. Onglet Système → Configs → Data stream mode.
4. `StrategyContext.spotData` peuplé (prêt pour Phase 4.C/D).
5. Doc opérateur data stream.
6. Parent plan : cocher Phase 3.A/B/C.

**Ensuite** : reprendre parent Phase **4.A S9** (book_only OK) en parallèle éventuelle de rodage RTDS.

---

## 12. Kickoff — clos (rev. 2)

Les 3 questions d'origine (I3 secrets table dédiée, I5 timestamps par champ, I8 ordre 3.A → 3.C MVP → 3.B) sont **tranchées par défaut** : table dédiée, timestamps par champ, ordre 3.A → 3.C MVP → 3.B.

---

## 13. Décisions d'implémentation tranchées (rev. 2 — session 2026-08-06)

Les 8 décisions ci-dessous **font foi** en cas de divergence avec toute autre section. Elles résolvent les bugs potentiels / bugs fantômes identifiés lors de la revue du plan.

| # | Décision | Rationale | Impact |
|---|---|---|---|
| **1** | **Table dédiée `algo_oracle_strikes`** (`condition_id PK, strike_k, symbol, source, captured_at`) ; `algo_oracle_ticks` **sans** colonne `strike_k` | Colonne clairsemée + race sur UNIQUE partielle en cas de capture concurrente ; reload boot O(1) par marché via PK | §5.2 schéma, D6, D10, §9 tests K |
| **2** | **σ_min s'applique sur σ̂ à la lecture** : `σ̂ = max(sqrt(σ̂²), 1e−6)`. **Jamais** sur σ̂² à l'écriture | Sinon σ_min effectif = `sqrt(1e−6) = 1e−3` (facteur 1000) → calibration S1/S2 faussée d'un facteur 1000 (bug fantôme silencieux) | D5, §5.3, §9 tests σ |
| **3** | **Warm-up 30 ticks conservé** + commentaire explicite « conservatoire, pas garantie de convergence (5 demi-vies = 150 s) » | 30 ticks ≈ 1 demi-vie = convergence ~50%. Suffisant pour S1/S2 en fin de fenêtre (marché a tourné avant). Lever à 150 s casserait la dispo en début de marché | D5, §9 tests σ |
| **4** | **2 compteurs indépendants** : `lastWsActivityAt` (PING/PONG inclus, détermine `connected`) et `lastPriceAt` (messages prix uniquement, détermine staleness valeur). `fresh` = `connected` **ET** `now − lastPriceAt ≤ 30 s` | Sinon PING seul masque un silence de prix → `fresh=true` trompeur → stratégies trade sur stale (bug fantôme critique) | D4/D15, §5.3 `DataStreamHealth`, §5.5 point 5, §9 tests freshness |
| **5** | **Upsert immédiat** health `connected=false, fresh=false` **avant** `start()` au boot | Évite flash rouge trompeur sur row héritée d'un crash précédent (API lit `updated_at` ancien → `disconnected` pendant ~5 s avant 1er heartbeat) | §5.5 point 2, §9 tests |
| **6** | **`setDesiredSymbols` idempotent et différé** : stocke la liste désirée, applique au prochain cycle subscribe/resubscribe — jamais en plein milieu d'une resubscribe en cours | Sinon race : liste change en plein resubscribe → symboles partiels → certains marchés ne reçoivent jamais de prix (bug fantôme) | §5.3 interface, §5.5 point 7, §9 tests |
| **7** | **Hot-reload = replace-then-stop** : `createNew → start(new) → stop(old)`. Ancien provider porte flag `stopped=true` ; recorder/heartbeat vérifient ce flag avant d'écrire | `stop()` bloquant avant `start()` = si WS figée, double connexion (ticks en double, health écrasé). Le flag évite que l'ancien écrase la row health du nouveau pendant sa fermeture lente (bug fantôme clignotement disconnected) | §5.5 point 6, §9 tests hot-reload |
| **8** | **D11 strict** : en mode `rtds_chainlink_twap`, `getTwap()` retourne **`null`** si aucun tick TWAP ≤ 30 s — **même si** un spot Chainlink récent est en cache. Le spot sert uniquement à capturer K (D10) et à alimenter `getSpot()` en mode `rtds_chainlink_spot` | Sinon substitut spot silencieux = violation D11 + décision sur métrique non alignée settlement (bug critique) | D11, §5.3 règle, §9 tests D11 |

**Subtilité déc. 4** : `connected` (WS alive via PING) ne suffit pas pour trader — il faut **aussi** `lastPriceAt ≤ 30 s`. Une socket alive sans prix pendant des minutes afficherait `fresh=true` à tort si on ne séparait pas les compteurs. `SpotDataSlot.fresh` doit refléter **les deux** conditions (connexion + valeur), pas `connected` seul.

**Subtilité déc. 7** : avec overlap court (~1 s), les deux providers reçoivent des ticks simultanément. Sans flag `stopped=true` sur l'ancien, il peut écrire une row health `connected=false` (en cours de fermeture) **après** le nouveau → health clignote disconnected au hot-reload. Le recorder d'`algo_oracle_ticks` doit aussi vérifier le flag pour éviter ticks en double.
