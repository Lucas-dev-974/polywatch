# Plan patch — Correctifs audit weather-algo backtest

**Date** : 2026-08-09  
**Source** : [`2026-08-09_audit-weather-algo-backtest.md`](./2026-08-09_audit-weather-algo-backtest.md)  
**Vérification** : audit confronté au code (session 2026-08-09) — findings confirmés  
**Statut** : **applied** (2026-08-09) — `engineVersion` / package `@polywatch/backtest` **`0.2.0`**  
**Doc produit** : [`../backtest.md`](../backtest.md) · [`../code/09-backtest.md`](../code/09-backtest.md) · [`../api.md`](../api.md)  
**Objectif** : aligner le backtest weather sur le live (fidélité), corriger les bugs UI, et documenter les écarts restants.

### Décisions enregistrées (2026-08-09)

| Q | Choix | Détail |
|---|---|---|
| Q1 | **C** | Filtrer `closed` / `acceptingOrders` / `tokenIdYes` / `closeBeforeHours` + warning compteur |
| Q2 | **A** | Hystérésis sur fenêtre `weatherAlgoPollMs` (horloge virtuelle) |
| Q3 | **A** | `force_close_all` ferme toutes les positions ; `exitReason` = `KILL_SWITCH` |
| Q4 | **A** | DELETE refusé (409) si run `running`/`queued` |
| Q5 | **Full** | Tout le backlog (P1 + P2 + P3) |

---

## 0. Décisions bloquantes (tranchées)

### Q1 — B2 Entrées sur marchés fermés (CRITIQUE)

En mode `reevaluate`, le live filtre via `isMarketActiveForWeather` (`closed`, `acceptingOrders === false`, `tokenIdYes`, `minHoursToClose` = `weatherAlgoCloseBeforeResolutionHours`). Le backtest n’applique aucun de ces filtres.

| Option | Comportement | Avantage | Inconvénient |
|---|---|---|---|
| **A — Filtrer (recommandé)** | Avant `strategy.evaluateAt`, skip si `closed` / `acceptingOrders === false` / pas de `tokenIdYes` / hoursToEnd ≤ closeBeforeHours (horloge virtuelle) | Alignement live | Moins de trades vs runs historiques déjà produits |
| **B — Warning only** | Entrées toujours possibles + fidelity warning `market_lifecycle_filter_ignored` | Pas de changement de résultats | Backtest reste non représentatif |
| **C — Filtrer + warning compteur** | A + warning une fois avec détail (ex. « N ticks exclus ») | Fidélité + observabilité | Un peu plus de code |

**Question** : A, B ou C ? Inclure aussi `weatherAlgoCloseBeforeResolutionHours` côté entrée (comme le live), ou seulement `closed`/`acceptingOrders` ?

### Q2 — F1 Hystérésis bucket (ticks vs polls) (fidélité)

Live : +1 par poll exit (~`weatherAlgoPollMs`, défaut 30 min).  
Backtest : +1 à chaque `evaluateExits`, appelé à **chaque** `book_tick` de **n’importe quel** marché → `hysteresisPolls=2` n’a pas la même durée.

| Option | Comportement |
|---|---|
| **A — Horloge virtuelle (recommandé)** | Compteur hystérésis incrémenté au plus une fois par fenêtre `weatherAlgoPollMs` (ou param backtest dédié) **par position**, basé sur `clock.now()` |
| **B — Uniquement ticks du marché de la position** | Incrément seulement quand le `book_tick` courant concerne `pos.conditionId` (améliore, mais granularité ≠ poll) |
| **C — Warning only** | Garder comportement actuel + fidelity warning `risk_bucket_hysteresis_tick_based` |

**Question** : A, B ou C ?

### Q3 — F3 Kill-switch `force_close_all` (fidélité)

Backtest : `maxDailyLoss` bloque seulement les **entrées**. Live peut **forcer la clôture** de toutes les positions weather si `weatherAlgoKillSwitchAction === 'force_close_all'`.

| Option | Comportement |
|---|---|
| **A — Implémenter** | Quand `dailyPnl <= -maxDailyLoss` et action = `force_close_all`, clôturer toutes les positions ouvertes au mid/slippage courant (`KILL_SWITCH` ou raison dédiée) ; `block_entries` / `block_and_notify` = blocage entrées seul |
| **B — Warning only** | Garder block entries + warning `kill_switch_force_close_ignored` |

**Question** : A ou B ? Si A, quelle `exitReason` ? (`STRATEGY_FLIP` existant / nouvelle valeur `KILL_SWITCH` + migration enum UI) ?

### Q4 — B8 DELETE d’un run actif

| Option | Comportement |
|---|---|
| **A — Refuser (409)** | DELETE interdit si `running`/`queued` → forcer cancel d’abord |
| **B — Cancel puis delete différé** | DELETE annule + marque « delete_after_finish » ; purge à la fin du runner |
| **C — Garder delete immédiat** | Tolérer flush post-delete (ignorer erreur FK / no-op append) sans log `backtest run failed` trompeur |

**Question** : A, B ou C ?

### Q5 — Périmètre de livraison

| Option | Contenu |
|---|---|
| **P1 only** | B1 + B2 + tests + doc minimale (runs représentatifs) |
| **P1+P2** | + B3, B4–B6, F1 (selon Q2), doc |
| **Full** | Tout le backlog ci-dessous (B7–B9, F2–F6, cleanup, UI métriques) |

**Question** : quel lot pour le premier PR ?

---

## 1. Principes du patch

1. **Réutiliser le core live** dès que possible (`resolveWeatherEntryExitParams`, helpers exit, sémantique throttle) — pas de seconde source de vérité.
2. **Fidélité explicite** : toute approximation restante = fidelity warning nommé + entrée dans `docs/backtest.md`.
3. **Tests de non-régression** obligatoires pour B1/B2/B3 (et F1 si option A/B).
4. **Pas de breaking API** sauf décision Q3 (nouvelle `exitReason`) ou Q4 (409 DELETE).
5. Incrémenter `engineVersion` (aujourd’hui hardcodé `'1'`) → `'1.1.0'` ou `'2'` selon convention choisie (voir patch B-meta).

---

## 2. Backlog ordonné

### Phase 1 — Critique (bloquant décisionnel)

#### P1.1 — B1 SL/TP/Trailing alignés sur le live

**Fichiers**
- `packages/backtest/src/engine/exit-manager.ts`
- `packages/backtest/src/adapters/weather/weather-adapter.ts` (résolution à l’entrée)
- `packages/backtest/src/adapters/weather/weather-adapter.test.ts` (+ test défauts)
- éventuellement `packages/backtest/src/engine/ledger.ts` (stocker seuils résolus sur la position)

**Patch proposé**
1. À l’ouverture de position (`onBookTick` / `onSignal`), appeler  
   `resolveWeatherEntryExitParams(ctx.configSnapshot, 'sim', null)`.
2. Persister les seuils résolus dans `LedgerPosition.meta` (ou champs dédiés) :  
   `slBidPoints`, `tpBidPoints`, `trailingBidPoints`, `trailingActivationBidPoints`.
3. `evaluateSlTpTrailing` lit **uniquement** ces valeurs résolues (null = jambe inactive) — plus de `flag !== false` / lecture brute config.
4. Test dédié : config flags `true`, bidPoints `null` → seuils = `WEATHER_EXIT_DEFAULTS` (0.10 / 0.12 / 0.05 / 0.06) et une sortie SL se déclenche.
5. Test flags `false` + bidPoints renseignés → aucune jambe active.

**Critère done** : avec snapshot config DB par défaut, backtest applique les mêmes offsets que le live.

#### P1.2 — B2 Filtres cycle de vie marché (selon Q1)

**Fichiers**
- `packages/backtest/src/adapters/weather/weather-adapter.ts`
- tests adapter
- `docs/backtest.md` (warning ou comportement)

**Patch proposé (si Q1 = A ou C)**
1. Extraire ou réutiliser une fonction pure partagée (idéalement déplacer `isMarketActiveForWeather` vers `@polywatch/core` / weather helpers pour éviter la duplication runner/backtest).
2. Dans `onBookTick` (mode reevaluate), avant `strategy.evaluateAt` :  
   `if (!isMarketActiveForWeather(market, minHours, clock.now())) return;`
3. Utiliser `ctx.clock.now()` (pas `Date.now()`).
4. Si Q1=C : `warnOnce` + compteur optionnel dans le message.

**Critère done** : tick `closed: true` ou `acceptingOrders: false` ne crée plus d’entrée en reevaluate.

---

### Phase 2 — Majeure

#### P2.1 — B3 Throttle re-entry aligné live

**Fichiers** : `packages/backtest/src/engine/exit-manager.ts` + tests

**Patch**
- `markClosed` uniquement pour `WEATHER_BUCKET_EXIT` et `WEATHER_FORECAST_CHANGE`.
- Retirer les appels sur `WEATHER_PRE_CLOSE`, `SL`, `TP`, `TRAILING`.
- Test : après SL, ré-entrée même ville possible immédiatement ; après bucket exit, bloquée `throttleMs`.

#### P2.2 — F1 Hystérésis (selon Q2)

**Fichiers** : `exit-manager.ts`, `weather-adapter.ts`, tests, `docs/backtest.md`

**Si Q2=A** : map `positionId → lastHysteresisAdvanceAt` ; n’incrémenter que si `now - last >= weatherAlgoPollMs` (fallback 1_800_000).  
**Si Q2=B** : n’appeler l’évaluation bucket/hystérésis que pour la position dont le tick vient d’arriver (SL/TP peuvent rester globaux).  
**Si Q2=C** : warning static `risk_bucket_hysteresis_tick_based`.

#### P2.3 — B4 / B5 / B6 Frontend

**Fichier** : `packages/frontend/src/components/WeatherAlgoBacktestTab.tsx`

| Bug | Patch |
|---|---|
| B4 | `onCleanup(() => stopPolling())` |
| B5 | `capital={Number(run.params?.capital) \|\| 1000}` (depuis le run sélectionné, pas le formulaire) |
| B6 | Soit brancher `setDetailLoading(true/false)` dans `refreshDetail`, soit supprimer signal + prop `loading` morte |

#### P2.4 — F3 Kill-switch (selon Q3)

Si A : dans adapter, quand daily loss breach + `force_close_all`, close all open positions puis bloquer entrées.  
Si B : fidelity warning only.

#### P2.5 — Documentation

- ~~`docs/backtest.md` §1/§5~~, ~~`code/09-backtest.md`~~, ~~bandeau plan 08-08 §12.2~~ — **faits** (doc sync 2026-08-09).

---

### Phase 3 — Mineure

#### P3.1 — B7 `strategyId` / `decision` SQL

- `data-loader.ts` `loadSignalEvents` :  
  `.andWhere('e.decision = :decision', { decision: 'signal' })`  
  + si `params.strategyId` : filtre `e.strategyId`.
- Documenter dans `api.md` que le filtre est effectif.

#### P3.2 — B8 DELETE (selon Q4)

Implémenter l’option choisie + test route si possible.

#### P3.3 — B9 `profitFactor` Infinity

Options techniques (non bloquant — défaut proposé **D1**) :
- **D1** : dans `computeStats` / avant persist, mapper `Infinity` → `null` et documenter « null = ∞ » ; UI : si `profitFactor == null && totalTrades > 0 && avgLoss == 0` afficher `∞`.
- **D2** : sérialiser en string `"Infinity"` (breaking type).

#### P3.4 — F2 Sorties stale

- Option soft : ne pas exit SL/TP/trailing/pre-close si `tick.recordedAt` (ou `at`) est plus vieux que X vs `clock.now()` — **ou** warning `exit_stale_tick` une fois.
- Défaut proposé : warning only (pas de seuil magique sans données).

#### P3.5 — F4 Question décimale

- `question-builder` : arrondir `bucketTarget` entier avant synthèse ; ou étendre parser (hors scope si buckets Polymarket toujours entiers).
- Défaut proposé : `Math.round` + warning si non-entier.

#### P3.6 — F5 / F6

- F5 : documenter abort coopératif (pas de fix code).
- F6 : no-op acceptable ; optionnel `UPDATE … WHERE status IN (...)` atomique — low priority.

#### P3.7 — Cleanup + UX métriques

- Retirer ou isoler `event-bus.ts` dead code.
- Nettoyer params morts `FillInput` / `_at` ForecastRevisionStore.
- UI : afficher `byExitReason` / `byCity` / `avgHoldingMs` dans `RunDetail`.
- **B-meta** : `engineVersion` depuis semver package `@polywatch/backtest` (ou constante unique documentée), plus de `'1'` magique.

---

## 3. Ordre d’implémentation recommandé

```
P1.1 B1 (SL/TP)     ──┐
P1.2 B2 (filtres)   ──┼─► tests backtest verts ──► bump engineVersion
P2.1 B3 (throttle)  ──┘
P2.3 B4/B5/B6 UI
P2.2 F1 (selon Q2)
P2.4 F3 (selon Q3)
P2.5 Doc
P3.* reste
```

---

## 4. Plan de tests

| ID | Cas | Attendu |
|---|---|---|
| T1 | Config défaut (flags true, bidPoints null) | SL se déclenche à entry−0.10 |
| T2 | `weatherAlgoSlEnabled: false` | Pas de sortie SL même si bidPoints set |
| T3 | Tick `closed: true` reevaluate | Pas d’entrée (si Q1 A/C) |
| T4 | Sortie SL puis nouveau signal même ville | Entrée OK (pas de throttle) |
| T5 | Sortie `WEATHER_BUCKET_EXIT` puis signal | Entrée bloquée `throttleMs` |
| T6 | Hystérésis (si Q2 A) | 2 avancées espacées de `pollMs` → exit ; 2 ticks rapides → pas d’exit |
| T7 | Frontend | smoke manuel : quitter onglet pendant run → plus de requêtes poll ; capital chart = `run.params.capital` |

Commandes :
```bash
npm run test -w @polywatch/backtest
npm run build -w @polywatch/backtest
npm run build -w @polywatch/frontend
```

---

## 5. Hors scope (rappel)

- Warnings quantitatifs plan 08-08 (`inactiveBucketsExcluded`, etc.) — non livrés ; bandeau doc seulement.
- Socket.IO `backtest:*` / Prometheus `polywatch_backtest_*` — restés hors livrable.
- Backtest crypto / copy — non concernés.

---

## 6. Checklist merge

- [x] Réponses Q1–Q5 enregistrées en tête de ce fichier
- [x] Phase Full (P1+P2+P3) implémentée
- [x] Tests unitaires exit-manager (T1/T2/T4/T5/T6) + suite backtest **24/24**
- [x] `docs/backtest.md` / `code/09-backtest.md` / `api.md` / audit à jour
- [x] `engineVersion` = `BACKTEST_ENGINE_VERSION` (`0.2.0`)
- [x] Note « runs `< 0.2.0` non comparables » dans `backtest.md` §5

### Preuves code (résumé)

| Item | Fichiers |
|---|---|
| B1 | `exit-manager.ts`, `weather-adapter.ts` (`resolveWeatherEntryExitParams` → meta) |
| B2 | `isMarketActiveForWeather` (`core/weather/market-active.ts`) + adapter |
| B3 / F1 | `exit-manager.ts` (throttle restreint + fenêtre `pollMs`) |
| F3 | `weather-adapter.ts` (`KILL_SWITCH`) |
| B4–B6 / UI | `WeatherAlgoBacktestTab.tsx` |
| B7–B9 | `data-loader.ts`, `routes/backtest.ts`, `stats.ts` |
| Cleanup | suppression `event-bus.ts` ; `engine-version.ts` |

---

## 7. Follow-up post-vérif (2026-08-09) — R1–R3

Source : vérification d’implémentation post-patch 0.2.0 (builds OK, tests **24/24**, aucun bug bloquant).  
Les items ci-dessous sont des **résidus mineurs** / durcissements ; **pas de bump `engineVersion`**.

| ID | Sévérité | Constat | Patch |
|---|---|---|---|
| **R1** | Mineur (UI) | `Number(run.params?.capital) \|\| 1000` traite `0` / `NaN` comme fallback 1000 via `\|\|` | Helper `resolveRunCapital` : `Number.isFinite(n) && n > 0 ? n : 1000` |
| **R2** | Fantôme (kill-switch) | `killSwitchFired = true` **avant** la boucle de close ; si `ledger.closePosition` throw mid-loop (`ledger_close_missing`), les positions restantes restent ouvertes **sans retry** | Close chaque position en `try/catch` ; si des positions restent ouvertes → reset `killSwitchFired` + warning `kill_switch_partial_close` pour retry au tick suivant |
| **R3** | Doc / non-bug | `hoursToEnd` peut être **négatif** si `endDate` est passé — `shouldCloseBeforeResolution` (`hoursToEnd <= closeBeforeHours`) ferme correctement en `WEATHER_PRE_CLOSE` | Commentaire explicite dans `exit-manager.ts` (pas de changement de sémantique) |

### Hors follow-up (optionnel, non livré ici)

- Refactor `evaluateExits` (~120 lignes) en sous-méthodes (`resolveResolution` / `evaluateWeatherExit` / `evaluateSlTp`) — lisibilité seulement.
- DELETE 409 basé sur statut DB (vs tracker mémoire) — **volontaire**, plus robuste après restart process.

### Checklist follow-up

- [x] R1 capital UI
- [x] R2 kill-switch résilient
- [x] R3 commentaire `hoursToEnd`
- [x] Référencé dans ce plan §7 + audit weather-backtest
