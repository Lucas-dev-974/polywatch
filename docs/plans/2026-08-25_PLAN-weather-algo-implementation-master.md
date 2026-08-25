# Plan maître — Weather algo live : vagues d'implémentation

**Date** : 2026-08-25
**Statut** : 🟢 **Prêt à coder** (décisions produit verrouillées, revue logique faite)
**Audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)

Ce fichier est **la source d'ordre**. Chaque vague a un plan détaillé ; ne pas fusionner les vagues dans un seul PR fourre-tout.

---

## Décisions produit verrouillées

| Sujet | Décision |
|---|---|
| Date d'identité | `dateKey` (question) = `signal.targetDate`. `endDate` = `hoursToResolution` seulement |
| Default stratégies | JSON vide/invalide → `weather-forecast-aligned`. **Pas** de migration des `'["weather-forecast"]'` live |
| Catalogue | Ordre inchangé (forecast first-wins si les deux sont cochées) |
| minEdge défaut | aligned **0.08** ; forecast / highest-yes **0.10**. Stored gagne. `NON_NULLABLE` restaure depuis catalogue+per-strategy, pas `DEFAULT` seul |
| BUY NO | Hors scope. Documenter BUY YES only |
| Knobs morts | Retirer `minTimeToClose`, `minBidToAskRatio`, `allowedMarketTags`, `signalScoreSizingEnabled` du bag weather. **Garder** `entryDepthRetryMax` |
| Snapshot fail | Fail-open + log `alert: snapshot_missing` + Redis `weather-algo:snapshot-missing:{copiedPositionId}` TTL 24 h |
| Throttle re-entry | Clé **avec** `strategyId` (arg en dernier) |
| TTL compteur | `dateIso + 2 j`, clamp [1 j, 32 j] ; `EXPIRE` si `count===1` **ou** `ttl===-1` |
| Shutdown | Un flag : `stopped`. Checks intra-cycle. Pas de second `shuttingDown` |
| Parcours stratégies | 4 modes : `single` / `first-wins` (défaut) / `multi` / `consensus` — champ **nouveau**, pas l'enum villes |
| Consensus unité | Même `conditionId` (palier) |
| Consensus quorum | `ceil(nActivées * ratio)`, défaut 0.67 ; abstention au dénominateur ; skip si non atteint |
| Consensus fenêtre | Défaut 60 min, API `>= pollMs` |
| Consensus vote | 1 par (fenêtre, ville normalisée, dateIso, strategyId) = dernier palier |
| Consensus exécuteur | **aligned s'il a voté**, sinon 1er votant catalogue |
| Consensus scope | **Live only**. Backtest reste first-wins (`evaluateRunnerSimGroup`) |
| highest-yes | Vote égal |
| Sorties | Immédiates ; seules les entries attendent la fenêtre |
| Filtre villes | `applySelectionMode` **après** le quorum |

---

## Vagues (ordre obligatoire)

```
A robustesse  →  B dateKey + année  →  C CLOB/knobs/doc-preclose
        →  D aligned default  →  E docs qualité  →  F modes
```

| Vague | Plan | Pourquoi cet ordre | PR suggéré |
|---|---|---|---|
| **A** | [`…-robustesse-snapshot-ttl-throttle-shutdown.md`](./2026-08-25_PLAN-weather-algo-robustesse-snapshot-ttl-throttle-shutdown.md) | Isolé, faible couplage, réduit les fuites Redis / courses SIGTERM avant de toucher au runner | 1 |
| **B** | [`…-date-unique-et-multi-lanes.md`](./2026-08-25_PLAN-weather-algo-date-unique-et-multi-lanes.md) Phase 1 **+** qualité §2.3 `resolveWeatherDate` | L'autorité `dateKey` est fausse au 31/12 sans l'année `endDate`. Backtest ctx dans le même PR | 2 |
| **C** | [`…-prix-clob-knobs-morts-doc-preclose.md`](./2026-08-25_PLAN-weather-algo-prix-clob-knobs-morts-doc-preclose.md) | Garde CLOB **avant** le consensus (F délègue au pipeline). `runMode` reçoit `market` (vague B ne casse pas `endDate`) | 3 |
| **D** | [`…-default-aligned-strategy.md`](./2026-08-25_PLAN-weather-algo-default-aligned-strategy.md) | Default + `getStrategyParams` overlay. Après C pour ne pas sanitizer deux fois le bag | 4 |
| **E** | [`…-qualite-forecast-buy-yes-cadences.md`](./2026-08-25_PLAN-weather-algo-qualite-forecast-buy-yes-cadences.md) §1, §2.1–2.2, §3 | Geocode + docs. §2.3 déjà dans B | 5 (ou fusionné D+E si petit) |
| **F** | [`…-modes-selection-strategie.md`](./2026-08-25_PLAN-weather-algo-modes-selection-strategie.md) | Collecte N signaux, Redis votes, `forceRefresh`. Dépend de B (dateKey dans le JSON vote) et C (gate CLOB au fill) | 6 |

Ne **pas** implémenter la Phase 2 annulée du plan date-unique (multi-lanes). C'est F.

---

## Dépendances techniques (ne pas inverser)

1. **`WeatherEvaluationContext.targetDate`** (B) avant tout appel `evaluateGroup` live/backtest.
2. **`getOrFetch({ forceRefresh })`** (F, service core) avant le tally consensus — le cache 60 min == fenêtre 60 min.
3. **`weatherConfigUpdateSchema` `.strict()`** : F ajoute 4 champs ; un PATCH sans eux casse si on oublie le schéma.
4. **Throttle `strategyId` en dernier** (A) : `hasWeatherReentryThrottle(redis, city, date, mode, strategyId)`. Oubli = compile error sur `weather-city-first.test.ts`.
5. **`redisCmd` pipeline** aujourd'hui `Pick<Redis, 'exists' \| 'get' \| 'incr'>` : A ajoute `set` / `ttl` / `expire` ; F n'en a pas besoin (runner a déjà `Redis` complet).

---

## Hors scope (ne pas glisser dans ces PRs)

- BUY NO
- `MIN_STD_FLOOR`
- Champ `country` sur `WeatherAutoTrackRule`
- Consensus / 4 modes dans le **backtest**
- Colonne `marketPrice` sur `WeatherPositionForecast`
- Inversion du catalogue
- Migration des JSON `'["weather-forecast"]'` existants
- Second flag `shuttingDown`
- Cap global toutes stratégies en mode `multi`
- Réécrire les audits historiques (`docs/audits/`, `docs/weather-algo-audits-plans/`)

---

## Tests de non-régression par vague

**A** — `weather-reentry-count` (TTL / pas de reset) ; throttle forecast ≠ highest-yes ; snapshot fail → enqueue + clé Redis ; `stop()` mid-cycle → 0 `onSignal`.

**B** — gate : `targetDate` = `2026-01-01T12:00:00Z` alors que `endDate` = 2 jan minuit ; rollover 31/12 ; runner-sim : signal.date = `snapshotTargetDateIso`.

**C** — CLOB ask trop haut → skip ; `allowedComparisons: 'exact'` string → `['exact']` ; `entryDepthRetryMax` toujours lu ; docs pre-close live plus dans `weather-algo.md` / `08` / `01` / `04` / `09`.

**D** — `parseWeatherAlgoStrategies('')` → aligned ; `'["weather-forecast"]'` inchangé ; aligned sans stored → 0.08 ; `minEdge: null` aligned → **0.08**.

**E** — geocode 2 hits → plus grande `population` ; docs BUY YES + cadences + std inter-modèles.

**F** — `singleId` null → 0 signal ; multi 2 stratégies → 2 signaux ; palier qui change → 1 vote ; 2 villes → 2 clés forecast ; aligned+forecast quorum → `strategyId` aligned ; ville `single` → 1 paire ; `windowMs < pollMs` → 400 API.

---

## Smoke live (après F, ou après D si on n'active pas consensus)

1. Un cycle poll : exits puis entries, pas d'exception Redis TTL.
2. Position ouverte : snapshot `targetDate` = jour météo question.
3. Config default (JSON stratégies vide) : signal `weather-forecast-aligned`.
4. Si consensus : attendre 1 fenêtre, vérifier une seule entry, tag aligned si aligned a voté.

---

## Fichiers « uns » (collision entre vagues)

Toucher dans **plusieurs** vagues — merger dans l'ordre A→F, pas en parallèle sur la même branche sans rebase :

| Fichier | Vagues |
|---|---|
| `weather-entry-pipeline.ts` | A (snapshot alert, throttle, redis Pick), C (CLOB, sizing false) |
| `strategy-runner.ts` | A (`stopped`), B (`ctx.targetDate`), F (4 modes) |
| `strategy-catalog.ts` | C (knobs, coerce comparisons), D (default + per-strategy minEdge) |
| `strategy.ts` (ctx) | B |
| `config-per-kind.ts` | F (et rien d'autre weather sauf si C n'y touche pas) |
| `sim-reset-redis-hygiene.ts` | A (throttle 5 segments), F (`weather-consensus*`) |
| `docs/weather-algo.md` + `code/08-weather-algo.md` | C, D, E, F — **une passe doc en fin de chaque PR**, pas un mega-diff doc unique |

---

## Definition of done globale

- [ ] 15 constats audit couverts (code ou doc assumée) — voir mapping ci-dessous
- [ ] Aucun knob mort restant dans le bag weather
- [ ] `dateKey` unique live + backtest ctx
- [ ] 4 modes live ; first-wins = défaut = comportement actuel
- [ ] Tests listés par vague verts
- [ ] `docs/plans/INDEX.md` : ces 7 fichiers en **not_implemented** jusqu'à merge, puis `applied/`

### Mapping audit → vague

| # | Constat | Vague |
|---|---|---|
| 1 | Deux dates | B |
| 2 | Best-edge default | D |
| 3 | Gamma vs CLOB | C |
| 4 | First-wins vs multi | F |
| 5 | Gates identiques | D (minEdge 0.08) |
| 6 | allowedComparisons | C |
| 7 | Knobs morts | C |
| 8 | Doc pre-close | C |
| 9 | Snapshot fail-open | A |
| 10 | Compteur sans TTL | A |
| 11 | Shutdown | A |
| 12 | BUY YES | E |
| 13 | std / geocode / année | E + B (§2.3) |
| 14 | Throttle transversal | A |
| 15 | Cadences | E |

---

## Références plans enfants

1. [Robustesse](./2026-08-25_PLAN-weather-algo-robustesse-snapshot-ttl-throttle-shutdown.md)
2. [Date unique](./2026-08-25_PLAN-weather-algo-date-unique-et-multi-lanes.md)
3. [CLOB / knobs / pre-close](./2026-08-25_PLAN-weather-algo-prix-clob-knobs-morts-doc-preclose.md)
4. [Aligned default](./2026-08-25_PLAN-weather-algo-default-aligned-strategy.md)
5. [Qualité forecast](./2026-08-25_PLAN-weather-algo-qualite-forecast-buy-yes-cadences.md)
6. [Modes](./2026-08-25_PLAN-weather-algo-modes-selection-strategie.md)
