# Audit Weather Backtest — Fonctionnement du moteur & vérification des findings

**Date** : 2026-08-19
**Auteur** : Assistant IA (lecture directe du code, confrontation aux usages réels via grep/tests)
**Statut** : 🟢 **Résolu** — 10 points d'audit, 8 confirmés exacts, 2 corrigés ; plan de remediation appliqué (voir § « Résolution »)
**Périmètre** : `packages/backtest/src/**`, `packages/backend/src/routes/backtest.ts`, `packages/core/src/services/backtest-run.service.ts`, `packages/frontend/src/components/backtest/**`

> **Note de périmètre** : ce document est distinct de l'audit [`2026-08-18_audit-weather-backtest-fidelite-correctude.md`](./2026-08-18_audit-weather-backtest-fidelite-correctude.md), qui traite des 11 findings (bugs de timing, multi-stratégies, etc.) déjà résolus. Celui-ci porte sur le **fonctionnement du moteur** et une **relecture/vérification** de chaque point d'une passe d'audit indépendante.

---

## ✅ Résolution (plan appliqué — `engineVersion` 0.4.0)

Le plan de remediation issu de cet audit a été implémenté. Changements :

| Point | Action appliquée |
|-------|------------------|
| 1 (`detectionDelayMs` mort) | **Retiré** du schéma `params.ts`, de la propagation (`index.ts`, `runner.ts`), du warning `detection_delay_unused`, de l'API frontend et des tests |
| 2 (résolution par proxy forecast) | **Remplacé** par une résolution par prix YES : `yesPrice >= 0.99` → YES / `<= 0.01` → NO, 1 tick suffit. `resolution.ts` supprimé. Fallback `markPrice` → `entryPrice` si `tick.yesPrice` absent |
| 6 (`fidelityMinutes` ignoré en replay) | **Bloqué** : `replay + fidelityMinutes` → erreur 400 `replay_fidelity_filter_unsupported` dans `backtest.ts`. Warning retiré |
| 9 (ghost positions en annulation/timeout) | **Corrigé** : `adapter.finish` appelé aussi sur `cancelled`/`timeout` + check d'abort final après épuisement des événements |
| 10 (drawdown sur échantillons 60s) | **Amélioré** : échantillon d'equity ajouté à chaque close de position (drawdown intra-minute) |
| — (alignement `maxPositionsPerCityDate` runner-sim) | **Corrigé** : résolution par `signal.strategyId` (alignement live) |

---

## 📋 Résumé exécutif

Le moteur backtest weather est **événementiel, déterministe et bien architecturé** (horloge virtuelle, fusion k-way, ledger in-memory, adapter isolé, fidelity warnings explicites). La passe d'audit a produit 10 points de vigilance. Après vérification approfondie contre le code réel, les usages (grep) et les tests, **8 points sont exacts**, **1 point était partiellement erroné (point 4)** et **1 point était obsolète (point 5, déjà géré par le frontend)**. Ce document consigne les versions **corrigées** de ces points, et le schéma de fonctionnement du moteur.

| Point | Sujet | Statut après vérification | Gravité |
|-------|-------|---------------------------|---------|
| 1 | `detectionDelayMs` est un paramètre mort | ✅ Exact | 🟡 |
| 2 | Résolution par proxy forecast (pas de température observée) | ✅ Exact (nuance highest-yes) | 🟠 |
| 3 | Deux garde-fous de positions distincts | ✅ Exact | 🟡 |
| 4 | Sizing/frais à l'entrée | ❌ **Corrigé** : pas de double frais, notional = `entryUsdc` | — |
| 5 | `profitFactor: null` côté frontend | ❌ **Corrigé** : déjà géré (∞) | — |
| 6 | Filtre `fidelityMinutes` ignoré en replay | ✅ Exact | 🟠 |
| 7 | `markPrice` sticky sans décroissance | ✅ Exact | 🟠 |
| 8 | Singleton lock par domaine, pas de file d'attente | ✅ Exact | 🟡 |
| 9 | Ghost positions non résolues en annulation/timeout | ✅ Exact | 🟡 |
| 10 | Drawdown sur échantillons 60s | ✅ Exact | 🟡 |

---

## ✅ Ce qui est bien fait (référence positive)

1. **Déterminisme strict** — `VirtualClock.advanceTo` (`engine/virtual-clock.ts:25`) jette sur régression temporelle. Aucun `Date.now()` dans le chemin moteur. Base solide pour la reproductibilité.

2. **Fusion k-way correcte** — `engine/merge-event-streams.ts` : tas binaire avec `bubbleUp` à l'insertion (commentaire ligne 40 documente le bug évité). La pagination keyset `(timestamp, id)` du `data-loader.ts` est alignée sur la clé de fusion — pas de régression d'horloge possible.

3. **Fidélité documentée** — `AdapterWarnings` (`adapter-warnings.ts`) liste honnêtement les simplifications : pas de profondeur de carnet, sizing fixe, SL sans ticks de confirmation, `minTimeToClose` ignoré, `detectionDelayMs` non appliqué, `fidelityMinutes` ignoré en replay. Excellente pratique.

4. **Gestion des positions fantômes en fin de run** — `adapter.finish` (`weather-adapter.ts:93`) force la résolution des positions encore ouvertes (`BACKTEST_INCOMPLETE_DATA`), évitant de fausser l'équité finale et les stats.

5. **Kill-switch robuste** — `killSwitchFired` est marqué avant la boucle de close pour éviter un double-close en cas de throw, et réarmé si un close échoue (retry au tick suivant). `weather-adapter.ts:192-245`.

6. **Coopératif** — Annulation/timeout vérifiés à chaque événement, `setImmediate` tous les 5000 événements, persistance incrémentale (progress 2s, equity 60s).

7. **Tests de qualité** — `weather-adapter.test.ts` couvre replay, résolution, fallbacks, `maxConcurrentPositions`, `no_events_in_range`, `replay_fidelity_filter_unsupported`.

---

## Schéma de fonctionnement du moteur

```
┌─────────────────────────── FRONTEND ───────────────────────────┐
│  WeatherAlgoBacktestTab.tsx                                   │
│   • fetchBacktestDataCoverage → GET /backtest/data-coverage   │
│   • LaunchBacktestForm → POST /backtest/runs                  │
│   • polling 4s (useBacktestPolling) → GET /runs/:id           │
│   • BacktestRunDetail → GET /runs/:id/positions + /equity     │
└──────────────────────────────┬────────────────────────────────┘
                               │ POST /runs (params JSON)
                               ▼
┌─────────────────────────── BACKEND ───────────────────────────┐
│  routes/backtest.ts                                           │
│   1. parseBacktestParams (Zod)                                │
│   2. hasActiveRun → singleton lock (409 si déjà actif)         │
│   3. snapshot WeatherConfig + configFingerprint                │
│   4. service.create → BacktestRun (status=queued)              │
│   5. backtestRunTracker.track (timeout 30min)                 │
│   6. fire runBacktest() en async (202)                        │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌─────────────────────────── MOTEUR (@polywatch/backtest) ──────┐
│  index.ts → runBacktest()                                     │
│    • applyConfigOverrides                                     │
│    • new BacktestRunner().run(spec)                           │
│                                                               │
│  ┌─────────────── BacktestRunner (engine/runner.ts) ────────┐ │
│  │  markStarted → boucle événementielle                      │ │
│  │  for await (event of spec.events()):                      │ │
│  │    • check abort (cancelled/timeout)                      │ │
│  │    • clock.advanceTo(event.at)  ← déterministe            │ │
│  │    • adapter.handle(event, ctx)                           │ │
│  │    • échantillon équité toutes les 60s                     │ │
│  │    • persist progress toutes les 2s                       │ │
│  │  adapter.finish(ctx) → résolution ghost positions         │ │
│  │  finishRun → stats + persist positions/equity             │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─── loadWeatherEvents (data-loader.ts) ──────────────────┐  │
│  │ 3 flux async paginés keyset (timestamp,id):             │  │
│  │   • forecast  (WeatherForecastHistory)                  │  │
│  │   • book_tick (WeatherBucketTick ⋈ MarketSnapshot)      │  │
│  │   • signal    (WeatherEvaluationLog, mode replay only)   │  │
│  │ mergeEventStreams → k-way heap merge par timestamp       │  │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─── WeatherBacktestAdapter (adapters/weather) ──────────┐  │
│  │  handle(event):                                        │  │
│  │   forecast → ForecastRevisionStore.set                  │  │
│  │   book_tick → onBookTick                               │  │
│  │   signal   → onSignal (replay)                          │  │
│  │                                                        │  │
│  │  ENTRÉE (3 modes):                                     │  │
│  │   • strategy:  strategy.evaluateAt → signal → fill     │  │
│  │   • runner-sim: BucketGroupStore + evaluateRunnerSim   │  │
│  │   • replay:    onSignal → fill au prix enregistré       │  │
│  │                                                        │  │
│  │  SORTIE (par tick):                                    │  │
│  │   • maybeForceCloseAll (kill-switch)                    │  │
│  │   • evaluateExits → WeatherExitManager                 │  │
│  │     - pre-close / drift / bucket(hystérésis) / SL/TP/  │  │
│  │       trailing / RESOLUTION                            │  │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  Ledger (engine/ledger.ts): cash + positions + mark-to-market │
│  FillEngine: simulateWeatherEntryFill / ExitFill (slippage+3%)│
│  Stats (engine/stats.ts): PnL, drawdown, winrate, PF, ...     │
└──────────────────────────────┬────────────────────────────────┘
                               │ BacktestRunService (persistance)
                               ▼
┌─────────────────────────── POSTGRES ──────────────────────────┐
│  backtest_runs / backtest_positions / backtest_equity_points   │
└────────────────────────────────────────────────────────────────┘
```

### Boucle de décision d'une position (détail)

```
book_tick reçu
  │
  ├─ maybeForceCloseAll()  → kill-switch (daily loss) force_close_all
  ├─ evaluateExits()       → pour chaque position ouverte :
  │     ├─ updateMark (markPrice + peakBid pour trailing)
  │     ├─ tryResolvePosition → RESOLUTION si échéance atteinte
  │     │     • highest-yes : prix YES final > 0.5 → YES
  │     │     • sinon : forecast final dans le bucket (proxy)
  │     ├─ tryExitByDecision → drift / bucket-exit (hystérésis)
  │     └─ evaluateSlTpTrailing → SL / TP / TRAILING
  │
  ├─ si position déjà ouverte (duplicate) → return
  ├─ si openCount >= maxConcurrentPositions → return
  ├─ si reentry bloqué (throttle) → return
  ├─ si mode replay → return (entrée via onSignal)
  ├─ si runner-sim → onBookTickRunnerSim (groupe ville/date/métrique)
  └─ sinon (strategy) :
        buildMarketListItem → isMarketActiveForWeather
        strategy.evaluateAt → signal ?
        openCountForCityDate < maxPositionsPerCityDate ?
        canEnter (cash / maxExposure / daily loss) ?
        simulateWeatherEntryFill → ledger.openPosition
```

---

## 🔴 PROBLÈME 2 — Résolution par proxy forecast (ni température observée)

### Localisation
`packages/backtest/src/adapters/weather/resolution.ts:21-34` + `weather-adapter.ts:694-722` (`tryResolvePosition`)

### Analyse
`resolveWeatherBucket` décide du gagnant en vérifiant si le **forecast final** (dernière révision) tombe dans les bornes du bucket : `isForecastInBucket(forecastMean, ...)`. Il n'existe **pas de store de température observée** dans ce codebacktest. La résolution est donc une approximation du résultat réel Polymarket (basé sur l'observation météo, pas le forecast).

Warning émis : `resolution_via_forecast` (« Résolution via forecast final (pas de température observée stockée) »).

**Nuance highest-yes** : pour `weather-highest-yes` (sans forecast), la résolution utilise le prix YES final (consensus marché) via fallback `tick.yesPrice → markPrice → entryPrice`, pas le forecast. C'est une heuristique différente, documentée par `resolution_proxy_yes_price`.

### Sévérité
**🟠** — Biais potentiel du winrate / PnL si le forecast final s'écarte de l'observation réelle. Documenté et assumé, mais à quantifier.

### Décision
Documenter le biais ; si des résolutions réelles deviennent disponibles, privilégier un comparatif. Sans action bloquante.

---

## 🟠 PROBLÈME 6 — Filtre `fidelityMinutes` ignoré en mode `replay`

### Localisation
`packages/backtest/src/adapters/weather/data-loader.ts:26-37` (`loadWeatherEvents`) + `adapter-warnings.ts:70-76`

### Analyse
Le filtre `fidelityMinutes` est appliqué uniquement aux `book_tick` (`data-loader.ts:282-284`), jamais aux `signal`. `weather_evaluation_log` ne porte pas de colonne `fidelity_minutes`. En mode `replay`, on charge donc des signaux **non filtrés** alors que les ticks le sont → densité de données incohérente au sein d'un même run. Warning `replay_fidelity_filter_unsupported` émis.

### Preuve
- Test dédié : `weather-adapter.test.ts:287` (`replay mode with fidelityMinutes emits replay_fidelity_filter_unsupported warning`).
- Doc `api.md:443` : « ignoré en `replay` → warning `replay_fidelity_filter_unsupported` ».

### Sévérité
**🟠** — Divergence de densité de données entre ticks et signaux dans un run replay. Documenté, mais peut biaiser les comparaisons replay vs reevaluate.

---

## 🟠 PROBLÈME 7 — `markPrice` sticky sans décroissance

### Localisation
`packages/backtest/src/engine/ledger.ts:126-133` (`updateMark`) + `weather-adapter.ts:594-586` (`evaluateExits`)

### Analyse
`updateMark` ne fait que fixer `markPrice` et monter `peakBid`, sans décroissance. Si un marché cesse d'émettre des ticks (fermé), `markPrice` reste à la dernière valeur connue. Le fallback dans `evaluateExits` confirme la dernière valeur (warning `markprice_stale_carry_forward`), mais l'equity mark-to-market reste **optimiste** pour une position qui ne se résout pas.

### Sévérité
**🟠** — Equity curve / drawdown potentiellement surévalués. Lié au point 2 (résolution).

---

## 🟡 PROBLÈME 1 — `detectionDelayMs` est un paramètre mort

### Localisation
`packages/backtest/src/params.ts:18` (déclaration), `index.ts:64` (propagation), `runner.ts:26,60,136` (passage), `adapter-warnings.ts:63-69` (warning)

### Analyse
`detectionDelayMs` est déclaré, propagé dans `RunSpec`/`RunContext`, mais **jamais utilisé** dans la logique de l'adapter (ni entrée ni sortie). Seul le warning `detection_delay_unused` est émis. En mode replay, le signal est rejoué à son timestamp d'évaluation sans latence de détection.

### Décision
**Appliquer** (décaler l'entrée de `detectionDelayMs`) ou **retirer** du schéma de params. Recommandé : décider explicitement pour éviter la confusion.

---

## 🟡 PROBLÈME 3 — Deux garde-fous de positions distincts

### Localisation
`weather-adapter.ts:390` (`maxConcurrentPositions`), `openCountForCityDate` (`:285`), `flushPendingRunnerSimSignals` (`: `)

### Analyse
- `maxConcurrentPositions` : **global** au ledger (toutes villes/dates confondues).
- `maxPositionsPerCityDate` : **par (ville, date, stratégie)** — clé `city|targetDate|strategyId`.

En mode `strategy`, le check `openCountForCityDate` utilise `this.strategyId` (`weather-adapter.ts:446`) ; en `runner-sim`/`replay`, il utilise `signal.strategyId` / `data.strategyId`. Cohérent. En mode `strategy` mono-stratégie, si `maxPositionsPerCityDate >= maxConcurrentPositions`, le garde global domine (redondance). Ce n'est pas un bug.

---

## 🟡 PROBLÈME 8 — Singleton lock global, pas de file d'attente

### Localisation
`packages/backend/src/routes/backtest.ts:82-86` (`hasActiveRun('weather')`)

### Analyse
`POST /runs` rejette (409) si un run weather est déjà actif (`running`/`queued`). Pas de file d'attente. Un run long (jusqu'à 30 min, `BACKTEST_TIMEOUT_MS`) bloque tous les autres backtests weather. Choix de simplicité assumé.

---

## 🟡 PROBLÈME 9 — Ghost positions non résolues en cas d'annulation/timeout

### Localisation
`packages/backtest/src/engine/runner.ts:236-271`

### Analyse
`adapter.finish` (qui force la résolution des ghost positions) n'est appelé **que** sur le chemin `completed` (`runner.ts:269`). En cas de `cancelled`/`timeout`, on retourne directement `finishRun(...)` sans `adapter.finish`. Les positions ouvertes sont persistées avec `exitPrice: null` (via `mapPositionForPersist`). Cohérent pour un run interrompu, mais les stats d'un run annulé incluent des positions non résolues.

---

## 🟡 PROBLÈME 10 — Drawdown calculé sur échantillons 60s

### Localisation
`packages/backtest/src/engine/runner.ts:70,253` (`EQUITY_SAMPLE_INTERVAL_MS`) + `stats.ts:12-23` (`computeMaxDrawdown`)

### Analyse
`recordEquitySample` est déclenché toutes les 60s + à la fin. `computeMaxDrawdown` opère sur ces points espacés. Un drawdown intra-minute (pic puis chute rapide entre deux échantillons) peut être sous-estimé.

### Décision (recommandée)
Ajouter un échantillon d'équité à chaque événement de **close** (pas seulement toutes les 60s) pour un drawdown plus fidèle.

---

## ⚠️ POINTS CORRIGÉS (vérification de l'audit)

### Point 4 — Sizing/frais à l'entrée : **pas de bug** (correct)

Relu `canEnter` + `simulateWeatherEntryFill` + `ledger.openPosition` :

- `canEnter` calcule `estFees` **uniquement pour le check de solvabilité** (`cash < cost`), il ne débite pas.
- Le débit réel dans `openPosition` est `qty*price + fees` (une seule fois).
- `qty = entryUsdc / price` → `qty*price = entryUsdc` **exactement** : le notional investi est `entryUsdc`, pas « légèrement inférieur ».

**Conclusion** : pas de double application de frais, notional exactement `entryUsdc`. Le seul point de vigilance réel est que le sizing est basé sur `entryUsdc` (avant frais), les frais s'ajoutant au cash déboursé — un choix, pas un bug.

### Point 5 — `profitFactor: null` (∞) : déjà géré par le frontend

Vérifié dans `BacktestRunDetail.tsx:174` :

```174:175:packages/frontend/src/components/backtest/BacktestRunDetail.tsx
          {s.profitFactor == null && s.totalTrades > 0 ? '∞' : formatNum(s.profitFactor, 2)}
```

Le cas `null` (∞, aucune perte) est bien affiché. **Retiré** de la liste des faiblesses.

---

## 📊 Synthèse des points à traiter

| Priorité | Action |
|----------|--------|
| **Haute** | Décider le sort de `detectionDelayMs` (appliquer ou retirer). |
| **Haute** | Documenter/quantifier le biais de la résolution par proxy forecast (comparer aux résolutions réelles si disponibles). |
| **Moyenne** | En mode replay, appliquer un filtre de densité aux signaux, ou lever le warning `replay_fidelity_filter_unsupported` en erreur bloquante. |
| **Moyenne** | Ajouter un échantillon d'équité à chaque close pour un drawdown plus fidèle. |
| **Basse** | Gérer la résolution des ghost positions dans les chemins `cancelled`/`timeout` si l'on veut des stats cohérentes même en interruption. |

---

## 🔍 Vérification finale (passe 3 — logique/incohérences/bugs fantômes)

Relecture point par point confrontée au code, aux usages (grep) et aux tests. Aucune erreur logique bloquante trouvée dans l'audit. Trois nuances supplémentaires identifiées (mineures, non listées dans les 10 points initiaux).

### Nuances / mini-findings supplémentaires

**N-a — `fallbackSource` trompeur dans la résolution highest-yes**
`weather-adapter.ts:670` : `const fallbackSource = pos.markPrice != null ? 'markPrice' : 'entryPrice';`. Or `pos.markPrice` est **toujours** non-null (initialisé à `entryPrice` dans `openPosition`, jamais remis à null). Le `fallbackSource` indiquera donc toujours `'markPrice'`, même quand `markPrice == entryPrice` (jamais mis à jour par un tick). Le warning `resolution_highest_yes_fallback` est donc **techniquement inexact** : il dit « via markPrice » même si c'est juste l'entryPrice. Impact : traçabilité uniquement, pas de bug de calcul.

**N-b — `maxPositionsPerCityDate` incohérent en `runner-sim` multi-stratégies**
`weather-adapter.ts:285` : `flushPendingRunnerSimSignals` utilise `this.bag.maxPositionsPerCityDate` (résolu avec `this.strategyId`), mais la clé `seenCityDates` (`:281`) et le check (`:293`) sont dimensionnés par `signal.strategyId`. Si deux stratégies ont des `maxPositionsPerCityDate` différents, la limite appliquée est celle de `this.strategyId` (override ou `weather-forecast` par défaut), pas celle de la stratégie émettrice. Divergence avec le live (`strategy-runner.ts:344` qui résout par `signal.strategyId`). Impact : mineur avec la config par défaut (1 partout), mais fragile en config avancée. Même famille que les points #2/#3 de l'audit 2026-08-18 (corrigés pour le bag de sortie, mais pas pour ce check d'entrée en `runner-sim`).

**N-c — Abort check coopératif non temps réel**
`runner.ts:237-243` : le check d'abort est en **début** de boucle, avant `clock.advanceTo`. Si l'abort est demandé pendant le traitement d'un événement, il n'est détecté qu'au prochain événement. Si la boucle n'a plus d'événements, `finishRun('completed')` est appelé même si `getAbortReason()` aurait renvoyé `cancelled` (le tracker est déjà marqué). C'est un edge case mineur (coopératif par conception), mais un runcould se terminer en `completed` alors qu'un cancel était en attente. Le `tracker.release` final compense côté backend, mais le statut persisté reste `completed`. Impact : rare, UX uniquement.

### Confirmation des 10 points

| # | Vérification | Résultat |
|---|--------------|----------|
| 1 | `detectionDelayMs` : grep sur `packages/backtest/src` + `packages/weather-algo/src` → aucun usage logique (uniquement déclaration/propagation/warning) | ✅ Exact |
| 2 | `resolveWeatherBucket` utilise `isForecastInBucket(forecastMean, ...)` ; highest-yes utilise prix YES final (fallback `tick → mark → entry`) | ✅ Exact (nuance highest-yes documentée) |
| 3 | `maxConcurrentPositions` (global) vs `maxPositionsPerCityDate` (par city\|date\|strategyId) ; `openCountForCityDate` utilise `this.strategyId` en strategy, `signal.strategyId` en runner-sim/replay | ✅ Exact (nuance N-b sur le check d'entrée runner-sim) |
| 4 | `canEnter` calcule `estFees` pour check solvabilité uniquement ; `openPosition` débite `qty*price + fees` une fois ; `qty*price = entryUsdc` exactement | ✅ Correction confirmée : pas de double frais |
| 5 | `BacktestRunDetail.tsx:174` : `s.profitFactor == null && s.totalTrades > 0 ? '∞' : ...` | ✅ Correction confirmée : déjà géré |
| 6 | `data-loader.ts:282-284` : filtre `fidelityMinutes` sur `book_tick` uniquement ; test `weather-adapter.test.ts:287` couvre le warning | ✅ Exact |
| 7 | `ledger.updateMark` sticky (montée only) ; fallback `markprice_stale_carry_forward` confirme la dernière valeur ; equity mark-to-market reste optimiste | ✅ Exact |
| 8 | `backtest.ts:82-86` : `hasActiveRun('weather')` → 409, pas de file d'attente | ✅ Exact |
| 9 | `runner.ts:269` : `adapter.finish` (résolution ghost) appelé uniquement sur chemin `completed` ; en `cancelled`/`timeout`, positions ouvertes persistées `exitPrice: null` ; `buildStats` inclut ouvertes dans `finalEquity` mais pas dans `closedPositions` → stats incohérentes en interruption | ✅ Exact (raffiné : incohérence stats en interruption) |
| 10 | `runner.ts:253` : `EQUITY_SAMPLE_INTERVAL_MS = 60_000` ; `computeMaxDrawdown` opère sur ces points ; drawdown intra-minute sous-estimé | ✅ Exact |

### Conclusion de la vérification

L'audit ne contient **aucune erreur logique bloquante**. Les 8 points exacts sont confirmés, les 2 corrections (points 4 et 5) sont validées. Trois nuances mineures supplémentaires (N-a, N-b, N-c) sont identifiées : traçabilité inexacte d'un warning (N-a), divergence fragile avec le live sur un check d'entrée runner-sim (N-b), et abort coopératif non temps réel (N-c). Aucun bug fantôme nouveau (silencieux, stats faussées) au-delà du point 7 (déjà listé).

---

## 🔗 Liens

- Doc backtest : [`docs/reference/backtest.md`](../reference/backtest.md)
- Audit précédent (11 findings résolus) : [`docs/audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md`](./2026-08-18_audit-weather-backtest-fidelite-correctude.md)
- API backtest : [`docs/reference/api.md`](../reference/api.md)
