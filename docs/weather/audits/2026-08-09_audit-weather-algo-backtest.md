# Audit — Weather Algo Backtest

**Date** : 2026-08-09  
**Périmètre** : `packages/backtest` (moteur complet : runner, ledger, fill-engine, exit-manager, stats, merge, adaptateur weather), `packages/core` (entités Backtest*, `BacktestRunService`, helpers exit, migration), `packages/backend/src/routes/backtest.ts`, frontend (`WeatherAlgoBacktestTab`, `BacktestEquityChart`, `WeatherAlgoPage`, hooks, `ui-persistence`, `api.ts`), et documentation (`backtest.md`, `code/09-backtest.md`, `api.md`, `modele-donnees.md`, `frontend.md`, `architecture.md`, plans 08-05 et 08-08).

> **Statut post-patch (2026-08-09)** : les findings B1–B9 et F1–F4 sont **corrigés** dans
> `engineVersion` **`0.2.0`**. Voir
> [`../plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md`](../plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md)
> et [`../../reference/backtest.md`](../../reference/backtest.md).  
> Follow-up post-vérif **R1–R3** (capital UI, kill-switch résilient, doc `hoursToEnd`) :
> plan §7 — pas de bump version.  
> Le corps de ce document est **conservé comme constat d’audit** (état pré-fix) ;
> ne pas le lire comme description du code actuel.

---

## 1. Compilation / types / tests

| Vérification | Résultat (jour de l’audit) |
|---|---|
| Build `@polywatch/core`, `@polywatch/backtest` | OK |
| Build `@polywatch/weather-algo`, `@polywatch/backend`, `@polywatch/frontend` | OK (warning vite chunk > 500 kB, pré-existant) |
| Tests `npm run test -w @polywatch/backtest` | **19/19** au moment de l’audit → **24/24** après patch |

---

## 2. Bugs réels détectés (pré-fix)

### B1 — SL/TP/Trailing : divergence majeure backtest vs live — CRITIQUE → **FIXED 0.2.0**

Résolution via `resolveWeatherEntryExitParams` à l’entrée ; seuils stockés dans `meta`.

### B2 — Entrées possibles sur marchés fermés en mode `reevaluate` — CRITIQUE → **FIXED 0.2.0**

Filtre `isMarketActiveForWeather` + warning compteur `market_lifecycle_filtered`.

### B3 — Throttle de ré-entrée appliqué à toutes les sorties — MAJEUR → **FIXED 0.2.0**

`markClosed` uniquement pour `WEATHER_BUCKET_EXIT` / `WEATHER_FORECAST_CHANGE`.

### B4 — Fuite de timer dans l'onglet Backtest — MAJEUR → **FIXED 0.2.0**

`onCleanup(stopPolling)`.

### B5 — Capital de référence du graphique pris sur le formulaire — MAJEUR → **FIXED 0.2.0**

Capital depuis `run.params.capital`.

### B6 — `detailLoading` mort — MINEUR → **FIXED 0.2.0**

Branché dans `refreshDetail`.

### B7 — Paramètre `strategyId` accepté mais ignoré — MINEUR → **FIXED 0.2.0**

Filtre SQL `decision = 'signal'` + `strategyId` dans `loadSignalEvents`.

### B8 — DELETE d'un run actif → violation FK probable — MINEUR → **FIXED 0.2.0**

**409** `run_still_active` si `running`/`queued`.

### B9 — `profitFactor = Infinity` perdu en JSON — MINEUR → **FIXED 0.2.0**

`null` = ∞ (JSON-safe) ; UI affiche `∞`.

---

## 3. Bugs fantômes (pré-fix)

| ID | Statut |
|---|---|
| F1 Hystérésis ticks vs polls | **FIXED** — avancées espacées de `weatherAlgoPollMs` |
| F2 Sorties prix stale | **MITIGÉ** — warning `exit_stale_tick` |
| F3 Kill-switch `force_close_all` | **FIXED** — clôture `KILL_SWITCH` |
| F4 Question décimale | **FIXED** — `Math.round` dans `question-builder` |
| F5 Cancel pendant chunk SQL | **Assumé** (doc) — abort coopératif |
| F6 Race cancel↔timeout | **Assumé** — fenêtre étroite single-process |

---

## 4–5. Confrontation Doc / lacunes (pré-fix)

Les divergences listées le jour de l’audit (réécriture SL/TP, throttle élargi, etc.)
sont traitées dans le patch et la doc produit (`backtest.md`, `code/09-backtest.md`,
`api.md`). Restent **hors scope** : warnings quantitatifs plan 08-08 §12.2,
Socket.IO `backtest:*`, Prometheus `polywatch_backtest_*`.

---

## 6. Synthèse (historique)

Priorité d’origine : corriger B1/B2 avant toute décision basée sur des runs.
Livré en full (Q5) avec décisions Q1=C, Q2=A, Q3=A, Q4=A.

## Verdict (jour de l’audit)

L'architecture était saine ; le bug de fond B1 rendait les backtests non
représentatifs avec la config par défaut. **Corrigé en 0.2.0** — relancer les runs
pour toute analyse postérieure.
