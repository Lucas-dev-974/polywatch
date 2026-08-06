# Plan d'implémentation — stratégies crypto-algo 5 min + hygiène config naive-momentum

**Date** : 2026-08-06 (rev. 6 — Phases 0–2 livrées ; Phase 3 détaillée dans le plan suite)  
**Source** : `docs/audits/2026-08-05_audit-naive-momentum-config.md` + `docs/audits/2026-08-05_strategies-5min-binary-crypto.md`  
**Objectif** : (1) assainir la config naive-momentum, (2) rendre l'architecture multi-stratégie, (3) brancher un **flux spot/TWAP RTDS par défaut** (gratuit, sans API Chainlink payante), (4) livrer les stratégies prioritaires (S9, S3, S1, S2).

**État** : Phases **0–2 terminées** (migrations `0093`/`0094` appliquées ; export CSV `exports/algo_price_ticks_2026-08-06.csv`).  
**Suite Phase 3 (3.A+3.B+3.C)** → [`2026-08-06_PLAN-phase3-data-stream-rtds.md`](./2026-08-06_PLAN-phase3-data-stream-rtds.md) — **ne pas implémenter depuis ce fichier parent** ; suivre le plan suite.

---

## Principes directeurs

1. **Stop-bleeding d'abord** (config-only, zéro risque) avant tout nouveau code.
2. **Mesurer la sélection adverse** avant d'ajouter une stratégie.
3. **Une stratégie active à la fois** — pas de concurrence sur le même marché.
4. **Chaque stratégie = une classe** sous `implementations/` + id dans `cryptoAlgoStrategies` + params JSON.
5. **RTDS Polymarket par défaut** — pas d'abonnement Chainlink Data Streams sauf choix explicite opérateur (mode avancé).
6. **Data stream = couche infra** configurable depuis la page Système (onglet Configs), pas mélangée aux tunables de stratégie.
7. **Pas de dégradation silencieuse** — RTDS down ou topic TWAP indispo ⇒ badge + abstention oracle ; jamais de bascule auto de mode ni de substitution spot sans signal.

---

## Data stream — modèle cible

### Pourquoi un flux externe ?

Polymarket règle les marchés crypto 5 min sur le **Chainlink TWAP** (30 s). Le book CLOB seul ne suffit pas pour S1/S2 (fair value, filtre marge). **Ce n'est pas obligatoire** pour S9, S3, Phase 0–2.

### Modes proposés (choix sûrs)

| Mode | Source | Coût | Alignement résolution | Usage |
|---|---|---|---|---|
| **`rtds_chainlink_twap`** *(défaut)* | Polymarket RTDS `crypto_prices_twap_thirty` / `sixty` | **Gratuit**, sans auth | **Parfait** (même TWAP que settlement) | S1, S2, S4, S5 |
| `rtds_chainlink_spot` | Polymarket RTDS raw `crypto_prices_chainlink` | Gratuit | Bon (spot, pas TWAP) | Choix opérateur explicite (jamais de bascule auto, D11) |
| `rtds_binance` | Polymarket RTDS raw `crypto_prices` | Gratuit | Proxy — pas settlement-grade | Dev |
| `book_only` | Aucun flux externe | — | Aucun pour oracle | S3, S9, naive-momentum |
| `chainlink_direct` | Chainlink Data Streams API | **Payant / clé API** | Parfait | Avancé — opt-in explicite |

**Défaut système** : `rtds_chainlink_twap`.  
**Pas de mode Chainlink direct** activable sans credentials en BDD + confirmation UI coût.

Endpoint RTDS : `wss://ws-live-data.polymarket.com` · heartbeat `PING` toutes les 5 s · doc Polymarket [Chainlink TWAP](https://docs.polymarket.com/market-data/chainlink-twap).

**Protocole retenu : WebSocket RTDS brut** (pas le SDK `@polymarket/client`) :

- TWAP 30 s : topic `crypto_prices_twap_thirty`, filtre compact `{"symbol":"btc/usd"}`.
- TWAP 60 s : topic `crypto_prices_twap_sixty`, même format de filtre.
- Chainlink spot : topic `crypto_prices_chainlink`, filtre compact `{"symbol":"btc/usd"}`.
- Binance spot : topic `crypto_prices`, filtre CSV tel que `btcusdt,ethusdt`.
- Après toute reconnexion, réémettre toutes les subscriptions.
- Conserver les valeurs exactes TWAP en décimal / `full_accuracy_value` (E18) ; ne pas utiliser le `number` d'affichage pour les calculs de stratégie.

### Persistance (non-secret)

- Clé `system_config` : `crypto_algo.data_stream.mode` (category `crypto_algo`, default `rtds_chainlink_twap`).
- Clé optionnelle : `crypto_algo.data_stream.rtds_url` (default `wss://ws-live-data.polymarket.com`).
- **Pas de clé `fallback_mode`** (D8) — RTDS down = badge rouge + abstention oracle, sans bascule auto.

### Credentials Chainlink Direct (D13)

- Stockés en **BDD**, configurables depuis l'UI (onglet Configs).
- Pattern secret write-only (à créer) calqué sur CLOB credentials :
  - GET status → `{ credentialsConfigured: boolean }` uniquement ;
  - PUT/POST écrit les secrets (client id + client secret) **sans** les renvoyer en réponse ;
  - GET list/by-category **n'inclut jamais** les valeurs secrètes.
- Crypto-algo lit les credentials via API backend authentifiée (service token) ou table dédiée chiffrée — **jamais** exposés au frontend.

Changement de mode / credentials data-stream → publish Redis `config-changed` avec kind **`crypto_algo.data_stream` uniquement** (D2) → crypto-algo **reconnecte** le client data stream (étendre `publishConfigChanged` + handler subscriber).

---

## Décisions d'architecture (verrouillées)

| # | Décision |
|---|---|
| **D1** | Health worker → API via table Postgres `crypto_algo_data_stream_status`, heartbeat **5 s** |
| **D2** | `config-changed` uniquement sur clés `crypto_algo.data_stream.*` — kind `crypto_algo.data_stream` |
| **D3 / D9** | Au boot : **recharger K** depuis `algo_oracle_ticks` ; abstention S1/S2 seulement si K introuvable |
| **D4 / D15** | Fraîcheur à deux niveaux : **connexion** = `now − lastRtdsMessageAt > 5 s` ⇒ stale global ; **valeur** = chaque `getSpot`/`getTwap` porte son `timestamp`, S1/S2 exigent un TWAP ≤ 30 s (fenêtre TWAP). Les deux conditions doivent être vraies pour trader |
| **D5** | **Convention secondes** : σ̂ en « par √seconde » (EWMA sur log-returns 1 s, demi-vie 30 s, λ = 2^(−1/30) ≈ 0,977), T = secondes restantes ; z = ln(S/K)/(σ̂√T) adimensionnel — pas d'annualisation. Garde-fous : σ_min = 1e−6, warm-up ≥ 30 ticks |
| **D6** | Table dédiée **`algo_oracle_ticks`** |
| **D7 / D8** | Badge rouge + abstention oracle ; **pas** de clé `fallback_mode` ; pas de bascule silencieuse |
| **D10** | Strike K = **premier spot Chainlink** RTDS à/après `eventStartTime` |
| **D11** | **Interdit** de substituer spot si topic TWAP down — stale + abstention (mode reste `rtds_chainlink_twap`) |
| **D12** | Health row : `updated_at` > **15 s** ⇒ disconnected (worker mort) |
| **D13** | Credentials Chainlink Direct en **BDD + UI** (write-only / masked) |
| **D14** | Phase 0.3 sizing ≥ 2× MOS : selon `sizingMode` (`entryShareCount` **ou** `entryUsdcAmount`) |
| **D16** | **Pas de purge** `algo_oracle_ticks` en MVP ; ajouter en Phase 5 si besoin |

---

## Phase 0 — Stop-bleeding (config only, ~0 dev) — jour 1

Objectif : stopper l'hémorragie SL et produire des données propres.

- [x] **0.1** Passer `crypto_algo_sl_enabled = false` (défaut entity + migration `CryptoAlgoStopBleed1700000000093` — flag partagé sim/real).
- [x] **0.2** TP actif : `crypto_algo_tp_enabled = true` forcé par migration ; defaults intervalle TP 0,12 inchangés.
- [x] **0.3** Sizing ≥ 2× MOS CLOB selon `sizingMode` (D14) — migration floor shares/USDC ≥ 2 ; UI Entrée min=2.
- [x] **0.4** `entryPriceMin` défaut code + migration → `0,55` ; bande ON. `minTimeToClose` non modifié.
- [x] **0.5** Purge ticks désactivée (défaut + migration). **À faire opérateur** : exporter `algo_price_ticks` (`pg_dump`/`COPY`) avant tout redémarrage de purge.

**Critère** : session sim sans jambe SL, outcomes redemption propres sur 1–2 jours.

---

## Phase 1 — Hygiène config naive-momentum (~1–2 j)

Réf. rapport 1 §7.

- [x] **1.1 (P0)** Label UI « Price-band entry » + knobs legacy grisés (`CryptoAlgoSettingsEntryTab`).
- [x] **1.2 (P0)** Onglet **Entrée** séparé (sizing + stratégie) vs Général / Sortie.
- [x] **1.3 (P1)** Champs morts marqués dead/deprecated (colonnes DB conservées pour compat ; getter `@deprecated`).
- [x] **1.4 (P1)** Filtre courbe fail-closed → abstain `curve_insufficient`.
- [x] **1.5 (P1)** `schedulePostEntryMidLog` branché sur `algo-reentry-fill` (+1 s / +5 s / +30 s).

---

## Phase 2 — Architecture multi-stratégie (~2–3 j)

- [x] **2.1** `StrategyContext` : `bidSize/askSize` sur books, `secondsUntilEnd`, `spotData` (nullable).
- [x] **2.2** Params JSON `cryptoAlgoStrategyParams` sur `CryptoConfig` (+ migration 0094).
- [x] **2.3** `applyRiskTunables` registry-driven via `ConfigurableCryptoAlgoStrategy.applyTunables`.
- [x] **2.4** Auto-enregistrement via `registerBuiltinStrategies`.
- [x] **2.5** Override `minTimeToClose` par stratégie (`resolveStrategyMinTimeToClose` dans entry pipeline) ; `exitProfile` réservé dans le bag JSON.
- [x] **2.6** Catalogue UI stratégies (Général) + hint priorité.
- [x] **2.7** Priorité = ordre de `cryptoAlgoStrategies` (first-wins documenté).

---

## Phase 3 — Data stream RTDS (backend, ~2–3 j)

> **Spec détaillée** : [`2026-08-06_PLAN-phase3-data-stream-rtds.md`](./2026-08-06_PLAN-phase3-data-stream-rtds.md) (3.A + 3.B + 3.C).  
> **RTDS par défaut.** Chainlink direct = mode optionnel Phase 3B, pas le chemin nominal.  
> Checklist ci-dessous = résumé ; le plan suite fait foi pour fichiers, schémas, critères et ordre.

### 3.A — Abstraction + client RTDS (défaut)

- [ ] **3.A.1** Interface `SpotPriceProvider` dans `packages/crypto-algo/src/data-stream/` :
  - `getSpot(symbol): { value, timestamp, source } | null`
  - `getTwap(symbol, windowSeconds): … | null`
  - `getHealth(): { connected, subscribed, fresh, mode, lastUpdateAt, error? }`
- [ ] **3.A.2** Implémentation **`RtdsSpotPriceProvider`** :
  - WS `wss://ws-live-data.polymarket.com`
  - Subscribe TWAP 30 s (5M) / 60 s (15M) selon intervalle marché
  - Subscribe aussi `crypto_prices_chainlink` **uniquement pour capturer K (spot à l'open)** — **pas** comme substitut de TWAP pour S1/S2 (D11)
  - Si topic TWAP rejeté / stale → health `stale` + abstention oracle ; **pas** de fallback spot silencieux
  - Mapping explicite marché → symbole RTDS (`BTC` → `btc/usd`, `ETH` → `eth/usd`, etc.)
  - Reconnect avec backoff borné + resubscribe systématique après disconnect / `topic not found`
  - Heartbeat textuel `PING` toutes les 5 s
  - Distinguer `connected`, `subscribed`, `fresh` et `stale` dans le health
- [ ] **3.A.3** Implémentation **`BookOnlySpotProvider`** (no-op, retourne null — stratégies abstinent ou utilisent mid book).
- [ ] **3.A.4** Factory `createSpotPriceProvider(mode, systemConfig)` — lit `crypto_algo.data_stream.mode`.
- [ ] **3.A.5** Ring buffer spot + σ̂ EWMA (D5) : log-returns 1 s, `σ̂²_t = λσ̂²_{t−1} + (1−λ)r²_t` avec λ = 2^(−1/30) (demi-vie 30 s) ; plancher σ_min = 1e−6 ; warm-up ≥ 30 ticks avant tout signal (s'inspirer de `mid-history-buffer.ts` pour la rétention, pas pour l'EWMA).
- [ ] **3.A.6** Persister **strike K** + ticks spot/TWAP dans **`algo_oracle_ticks`** :
  - Colonnes MVP : `condition_id`, `symbol`, `strike_k`, `spot_usd`, `twap_usd`, `twap_window_s`, `source`, `recorded_at`
  - **K** = premier spot Chainlink à/après `eventStartTime` (D10), écrit une fois
  - Ticks oracle à 1 Hz (aligné recorder book)
  - **Pas de purge MVP** (D16)
  - Au boot worker : **recharger K** depuis la table ; si absent → abstention S1/S2 (D9)
- [ ] **3.A.7** Exposer dans `StrategyContext` : `spot`, `twap`, `strikeK`, `sigma`, `dataStreamMode`, `dataStreamHealth` — chaque valeur avec son `timestamp` propre. Stale connexion si `now − lastRtdsMessageAt > 5 s` ; stale valeur si `now − twap.timestamp > 30 s` (D4/D15).
- [ ] **3.A.8** Seed `system_config` : catégorie `crypto_algo` + `crypto_algo.data_stream.mode = rtds_chainlink_twap` (+ `rtds_url` optionnel).
- [ ] **3.A.9** Health inter-processus :
  - Table Postgres `crypto_algo_data_stream_status` (heartbeat 5 s depuis crypto-algo)
  - Colonnes MVP : `mode`, `connected`, `subscribed`, `fresh`, `last_update_at`, `error`, `updated_at`
  - Backend `GET /api/system/data-stream-status` : si `updated_at` > **15 s** ⇒ `disconnected` (D12)
- [ ] **3.A.10** Hot-reload data stream :
  - Étendre `publishConfigChanged` pour accepter kind `crypto_algo.data_stream`
  - `PUT /api/system-config/:key` sur `crypto_algo.data_stream.*` → publish ce kind
  - Subscriber crypto-algo : sur ce kind → reconnecter `SpotPriceProvider` (pas seulement reload `CryptoConfig`)

**Critère** : avec mode défaut, `z = ln(S/K)/(σ̂√T)` calculable quand K + TWAP frais ; health visible en runtime sous 10 s ; worker mort détecté sous 15 s.

### 3.B — Chainlink direct (opt-in, ~1–2 j suppl.)

- [ ] **3.B.1** Mécanisme secret BDD write-only pour `chainlink_client_id` + `chainlink_client_secret` (pattern CLOB credentials).
- [ ] **3.B.2** Implémentation **`ChainlinkDirectSpotProvider`** (SDK Chainlink) lisant les secrets côté worker (via service backend / table chiffrée).
- [ ] **3.B.3** Garde-fous : mode `chainlink_direct` refusé si `credentialsConfigured = false` ; aucune valeur secrète en GET ; warning UI « coût API » + checkbox confirmation.
- [ ] **3.B.4** Doc opérateur : quand utiliser direct vs RTDS (latence, coût, redondance).

### 3.C — UI page Système — onglet Configs (~1–2 j)

**Emplacement** : page **Système** (`SystemPage.tsx`) — nouvel onglet top-level **« Configs »**, avec sous-onglets.

```
Système
├── Overview
├── Rapports
├── …
└── Configs                    ← NOUVEAU
    ├── Data stream mode       ← sous-onglet (MVP)
    └── (futurs sous-onglets infra)
```

**Fichiers cibles** :

| Couche | Fichier / route |
|---|---|
| Tab enum | `packages/frontend/src/lib/ui-persistence.ts` — ajouter `'configs'` à `SystemPageTab` |
| Page conteneur | `packages/frontend/src/components/SystemConfigsPage.tsx` (nouveau) |
| Sous-onglet | `packages/frontend/src/components/system-configs/DataStreamModeTab.tsx` (nouveau) |
| Routing | `packages/frontend/src/components/SystemPage.tsx` |
| API lecture | `GET /api/system-config/by-category/crypto_algo` (clés non secrètes uniquement) |
| API écriture | `PUT /api/system-config/crypto_algo.data_stream.mode` (existe) + publish D2 |
| Secrets Chainlink | endpoints status / write-only (nouveau, pattern CLOB) |
| Métadonnées UI | `packages/frontend/src/components/system-config-metadata.ts` |
| Health live | `GET /api/system/data-stream-status` (nouveau) — lit Postgres + règle 15 s |

**Contenu sous-onglet « Data stream mode »** :

- **Sélecteur radio / cards** des modes sûrs :
  - RTDS Chainlink TWAP *(recommandé, défaut)*
  - RTDS Chainlink spot
  - RTDS Binance *(proxy dev)*
  - Book only *(pas de flux oracle)*
  - Chainlink direct *(avancé, grisé si `credentialsConfigured = false`)*
- Pour chaque mode : label, description 1 ligne, alignement résolution, coût.
- **Badge statut live** : connected / disconnected / last tick / mode actif (poll 10 s).
- Bouton **Enregistrer** → PUT system_config + feedback inline « redémarrage flux… » (pattern `form-success`).
- Si mode `chainlink_direct` : champs secrets **write-only** (masqués, jamais préremplis depuis GET) + checkbox confirmation coût + statut `credentialsConfigured`.

**Critère UI** : changement de mode persisté, visible après refresh, health RTDS affiché sous 10 s, worker mort ⇒ disconnected sous 15 s.

---

## Phase 4 — Stratégies prioritaires (ordre révisé)

> S9 et S3 **avant** S1/S2 — ne nécessitent pas le data stream.

### 4.A — S9 Régime T + veto strike (~1 j)

- Ajouter les paramètres S9 explicites : `coinFlipVetoEnabled`, `coinFlipMin = 0,45`, `coinFlipMax = 0,55`, `coinFlipMaxTimeLeftSeconds = 60`.
- Gates `T_left` + veto coin-flip (`mid ∈ [0,45–0,55]` **et** `T_left ≤ 60 s`, ou `|z|≤0,5` si spot frais disponible).
- **Note** : le veto temporel `T ≤ 60 s` n'est utile que si `minTimeToClose` est abaissé (ex. override S1). Sous le défaut 150 s, les entrées n'atteignent jamais T≤60 — le veto mid via Phase 0.4 (`entryPriceMin = 0,55`) reste le filet global.
- Fonctionne en `book_only` ; utilise `z` si RTDS actif et tick non stale (D4).
- Tests de frontière obligatoires : 0,45 / 0,55 / 60 s, donnée spot stale, `secondsUntilEnd` absent, override `minTimeToClose`.

### 4.B — S3 OBI / microprice (~1–2 j)

- Entièrement book — **aucun data stream requis**.

### 4.C — S1 Convergence fin de fenêtre (~2–3 j)

- **Requiert** data stream (`rtds_chainlink_twap`) + K rechargé/capturé (D9/D10) + TWAP frais ≤ 30 s (pas de substitut spot, D11).
- Entrée `T_left ∈ [30,120] s`, `mid ≥ 0,87`, filtre marge `|ln(S/K)|/(σ̂√T_left) ≥ 2` — σ̂ par √seconde, T_left en secondes (D5).
- Override `minTimeToClose` (Phase 2.5).

### 4.D — S2 Fair value oracle (~3–5 j)

- **Requiert** data stream RTDS TWAP + tick frais (D4) + K (D9/D10).
- `F = Φ(ln(S/K)/(σ̂√T_left))` — σ̂ par √seconde, T_left en secondes (D5) ; entrée `bestAsk ≤ F − δ`.

---

## Phase 5 — Backtest + activation progressive

- [ ] **5.1** Backtest `optimize-report` par stratégie.
- [ ] **5.2** Une stratégie active à la fois en sim.
- [ ] **5.3** Mesure WR conditionnel, PF, sélection adverse.
- [ ] **5.4** Promotion sim → réel : PF > 1 sur ≥ 200 trades.
- [ ] **5.5** (optionnel) Purge / rétention `algo_oracle_ticks` si volume trop élevé (D16).

---

## Séquençage & dépendances

```
Phase 0 ──┐
Phase 1 ──┼──> Phase 2 ──> 4.A S9 ──> 4.B S3 ──┐
          │                                       │
          └──> Phase 3.C (UI Configs) ────────────┤
          └──> Phase 3.A (RTDS backend) ──────────┴──> 4.C S1 ──> 4.D S2 ──> Phase 5
                    └──> Phase 3.B (Chainlink direct + secrets BDD)
```

| Phase | Effort | Bloque | Data stream |
|---|---|---|---|
| 0 Stop-bleed | 0,5 j | — | Non |
| 1 Config naive | 1–2 j | — | Non |
| 2 Archi multi-strat | 2–3 j | S1 minTimeToClose | Non |
| **3.C UI Configs** | **1–2 j** | D1, D2, D13 | Choix mode |
| **3.A RTDS backend** | **2–3 j** | D1–D16 | **Défaut RTDS TWAP** |
| 3.B Chainlink direct | 1–2 j | secrets BDD | Opt-in |
| 4.A S9 | 1 j | — | Optionnel |
| 4.B S3 | 1–2 j | — | Non |
| 4.C S1 | 2–3 j | 2.5, 3.A | RTDS |
| 4.D S2 | 3–5 j | 3.A | RTDS |

---

## Risques & garde-fous

- **RTDS down (connexion > 5 s sans message) ou TWAP stale (valeur > 30 s)** → badge rouge + abstention oracle ; **pas** de bascule mode, **pas** de substitut spot (D7/D8/D11).
- **Worker mort** → health `updated_at` > 15 s ⇒ disconnected (D12).
- **Ne pas confondre** data stream (infra, onglet Système) et tunables stratégie (page crypto-algo).
- **Chainlink direct** : opt-in ; credentials BDD write-only ; jamais renvoyés en GET (D13).
- **Strike K** : capturé en spot à l'open ; rechargé depuis DB au boot ; sinon abstention S1/S2 (D9/D10).
- **Tail risk S1** : filtre marge k ≥ 2, sizing conservateur.
- **Backtest avant activation** ; PF > 1 mesuré.

---

## Livrables liés

- Rapport config : `docs/audits/2026-08-05_audit-naive-momentum-config.md`
- Rapport stratégies : `docs/audits/2026-08-05_strategies-5min-binary-crypto.md`
- UI existante : `SystemPage.tsx`, `SystemConfigDialog.tsx` (dialog hero — l'onglet Configs est la vue dédiée page Système)
- Pattern secrets voisin : CLOB credentials (`packages/backend/src/routes/config.ts`)
- Doc Polymarket RTDS : https://docs.polymarket.com/market-data/chainlink-twap
