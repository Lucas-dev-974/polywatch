# Audit Weather Backtest — Zero-holding, fill stale, marker hors courbe

**Date** : 2026-08-25
**Auteur** : Assistant IA (vérification post-implémentation + correctifs)
**Statut** : 🟢 **Corrigé** pour les findings de cette session — `engineVersion` **`0.8.0`**
**Périmètre** : `packages/backtest/src/adapters/weather/weather-adapter.ts`,
`packages/backtest/src/engine-version.ts`, tests adapter, UI ridge
(`RidgePlayTooltip`, `RidgeTooltip`, `format.ts`, `BacktestFidelityWarnings`)

> Fait suite aux audits moteur
> [`2026-08-19_audit-weather-backtest-moteur.md`](./2026-08-19_audit-weather-backtest-moteur.md),
> per-strategy
> [`2026-08-21_audit-weather-backtest-per-strategy-risk.md`](./2026-08-21_audit-weather-backtest-per-strategy-risk.md)
> et complet
> [`2026-08-23_audit-weather-backtest-complet.md`](./2026-08-23_audit-weather-backtest-complet.md).
>
> Runs `< 0.8.0` **non comparables** aux runs `0.8.0` : sémantique d’entrée
> runner-sim (horodatage, coalesce, gardes marché résolu / prix stale / SL immédiat,
> ordre flush-avant-gardes, pairing `decidedAt` par identité d’objet).

---

## ✅ Résolution (plan appliqué — `engineVersion` 0.8.0)

| Finding | Gravité | Action appliquée |
|---------|---------|------------------|
| F1 — `entryAt === exitAt` | 🔴 Critique | **Corrigé** — `entryAt` = timestamp de décision (`decidedAt`), pas `clock.now()` au flush |
| F2 — holds 10–20 ms (même seconde UI, « 0 min ») | 🔴 Critique | **Corrigé** — coalesce 1 s des ticks d’un même poll + garde marché résolu sur le **tick courant** |
| F3 — fill hors courbe (Austin #5808) | 🔴 Critique | **Corrigé** — skip si `\|currentPrice − decisionPrice\| > 0.10` (`entry_skipped_stale_price`) |
| F4 — flush bloqué par duplicate / maxPos / throttle | 🔴 Critique | **Corrigé** — flush du batch précédent **avant** ces gardes (drop, pas de file) |
| F5 — pairing `decidedAt` par `conditionId` | 🟡 Moyen | **Corrigé** — Map par identité d’objet signal (`pairDecidedAtBySignal`) |
| F6 — tooltip ridge sans ID | 🟢 UX | **Corrigé** — `Position #{id}` (player + tooltip voie) |
| F7 — `fmtHolding` affiche « 0 min » sous 1 min | 🟢 UX | **Corrigé** — `ms` / `s` sous 60 s |
| F8 — warning `fill_price_clamped` sur entrée skippée | 🟢 Cosmétique | **Corrigé** — émis seulement si la position est réellement ouverte (après la garde SL immédiat) |
| F9 — `ctx` inutilisé sur helpers forecast | — | **Dead code retiré** |

> **Note de relecture (2026-08-25, passe 0.8.0)** : la première passe (0.7.0)
> déclarait F4/F5/F8 corrigés alors que le code ne les implémentait pas. Cette
> passe les implémente réellement et bump `engineVersion` à `0.8.0` (les runs
> `0.7.0` n’avaient pas la sémantique documentée — non comparables).

---

## 📋 Résumé exécutif

Les runs #45 / #47 / #51 / #52 montraient des positions « fantômes » :

1. **Zero-holding exact** (`entry_at === exit_at`) : le flush runner-sim ouvrait
   au timestamp du **tick suivant** (`clock.now()`), puis `evaluateExits` fermait
   au même timestamp (RESOLUTION / SL).
2. **Holds de 10–20 ms** : jitter `Date.now()` entre marchés d’un même poll.
   Après F1, `entryAt` et `exitAt` n’étaient plus égaux mais restaient dans la
   même seconde — le tooltip affichait « 0 min ».
3. **Marqueur d’entrée dans le vide** (Austin 2026-08-20) : un signal flushé
   **après** une clôture (batch retenu par les gardes duplicate/maxPos) fillait
   au prix de décision (~0.58) alors que la courbe au `entryAt` était déjà à
   ~0.98. Le marker vert (`entryPrice` + slippage) ne tombait pas sur la ligne.

Ces trois symptômes sont des artefacts de **batching runner-sim**, pas de la
stratégie live. Les correctifs 0.8.0 les empêchent à l’entrée. D’autres risques
du même genre restent ouverts (voir § « Risques restants » dans le compte-rendu
de session — non codés).

---

## 🔴 F1 — Entrée horodatée au flush, pas à la décision

**Gravité** : 🔴 Critique (positions de durée nulle, PnL de résolution/SL
immédiat comptabilisé comme un trade réel)
**Localisation** : `weather-adapter.ts` — `flushPendingRunnerSimSignals`,
`onBookTickRunnerSim`

### Problème

Les signaux runner-sim sont accumulés puis flushés au **changement de
timestamp**. `openPosition({ entryAt: ctx.clock.now() })` dattait l’entrée au
tick de flush. Si ce tick (ou un event au même `at`) déclenchait déjà une
sortie, `entryAt === exitAt`.

### Correctif

`pendingRunnerSimSignals: { signal, decidedAt }[]`. Au push,
`decidedAt = at` du tick qui a généré le signal. Au flush,
`entryAt: decidedAtBySignal.get(signal) ?? ctx.clock.now()`.

Test : `reevaluate: timestamps entry at decision, not at flush`.

---

## 🔴 F2 — Jitter de poll 10–20 ms → RESOLUTION/SL immédiat

**Gravité** : 🔴 Critique
**Localisation** : `onBookTickRunnerSim` (flush à chaque `at` distinct)

### Problème

Les ticks d’un même cycle de poll sont horodatés à quelques ms d’écart
(`Date.now()` par marché). Flush à T, tick résolu à T+10 ms → hold de 10 ms.
Run #51 Atlanta #5692 : 10 ms `RESOLUTION`. La garde « marché résolu » lisait
le **prix de décision** (ex. 0.60), pas le tick courant (0.99).

### Correctif

- `RUNNER_SIM_BATCH_COALESCE_MS = 1000` : les ticks du même poll restent un
  seul batch.
- Garde `entry_skipped_market_resolved` : `currentPrice <= 0.01 || >= 0.99`
  (tick **courant** du cache).
- Garde `entry_skipped_immediate_sl` : skip si le tick courant déclencherait
  le SL dès l’ouverture.

Tests : `does not open a position that would resolve 10ms later`,
`sibling tick 10ms later does not flush into an immediate resolution`.

---

## 🔴 F3 — Fill au prix de décision vs courbe au `entryAt`

**Gravité** : 🔴 Critique (marker vert hors courbe, fill irréaliste)
**Localisation** : `flushPendingRunnerSimSignals` (fill `signal.marketPrice`)
**Exemple** : run #52 Austin #5808 — fill 0.5779 alors que yes=0.9775 à `entryAt`

### Problème

Le fill runner-sim utilise le prix de **décision** (correct pour ne pas filler
à ~0.0005 post-résolution). Si le signal est flushé **plus tard** (batch retenu
tant qu’une position est ouverte / cap atteint), le marché a pu bouger de 40
cents. Le ridge place le marker à `(entryAt, entryPrice)` : X = décision,
Y = fill stale → point dans le vide. `computeGapThreshold` (trou > 1.5× médiane,
plancher 60 s) peut aussi couper le trait, indépendamment du fill.

### Correctif

Skip si `|currentPrice - decisionPrice| > STALE_DECISION_PRICE_DELTA` (0.10),
warning `entry_skipped_stale_price`.

Le marker n’est **pas** snappé sur la courbe : un snap masquerait un fill faux.

Test : skip stale decision vs current tick → 0 positions.

---

## 🔴 F4 — Flush sauté quand duplicate / maxPos / re-entry

**Gravité** : 🔴 Critique (cause racine de F3)
**Localisation** : `onBookTick` (gardes **avant** le flush)

### Problème

`onBookTick` retournait sur `isDuplicateOpen`, `maxConcurrentPositions` ou
`isReentryBlocked` **avant** d’appeler le flush (qui ne vivait que dans
`onBookTickRunnerSim`). Les signaux pending restaient en file jusqu’à la
clôture ou `finish()`, puis étaient fillés sur un marché déjà ailleurs.

C’est le scénario Austin : ré-entrée stale après RESOLUTION.

### Correctif

1. `maybeFlushRunnerSimBatch(at)` extrait le test de coalesce 1 s.
2. `onBookTick` appelle ce flush **après** `evaluateExits` (un slot peut se
   libérer sur le tick courant) et **avant** les gardes duplicate / maxPos /
   throttle.
3. Les signaux non retenus au flush sont **droppés** (pas de file) : le prochain
   tick non bloqué re-évalue à prix courant. Pas de leftover — une file
   recréerait le fill stale que F3 supprime.
4. `onBookTickRunnerSim` ne flush plus : uniquement évaluation + push.

Test : `reevaluate: flush runs before reentry throttle guard and drops pending signal (F4)` —
deux buckets london (cond-12 ouvert, cond-13 pending) ; à la résolution de cond-12
le flush droppe cond-13 (throttle actif), jamais re-fillé à `finish()`.

---

## 🟡 F5 — `decidedAt` indexé par `conditionId`

**Gravité** : 🟡 Moyen (deux signaux pending du même marché : dernier gagne)
**Localisation** : `flushPendingRunnerSimSignals`

### Problème

Un `Map<conditionId, Date>` écrasait le premier `decidedAt` si le batch
contenait deux signaux pour le même marché.

### Correctif

`Map<WeatherSignal, Date>` par identité d’objet (helper `pairDecidedAtBySignal`).
`selectRunnerSimSignals` / `dedupSignalsByCityDate` ne clonent pas les
signaux — le pairing reste valide.

Test : `pairDecidedAtBySignal keeps each signal own decidedAt by object identity (F5)`.

---

## 🟢 F6 / F7 — UI ridge

**F6** : tooltip player (`RidgePlayTooltip`) et tooltip voie (`RidgeTooltip`)
affichent `Position #{id}`.

**F7** : `fmtHolding` — `< 1 s` → `N ms`, `< 1 min` → `N s` (plus « 0 min »
pour un hold de 10 ms).

**F8** : `noteFillClampedIfNeeded` n’est appelé qu’après la garde SL immédiat,
pour ne pas émettre `fill_price_clamped` sur une entrée jamais ouverte.

---

## Tests

`packages/backtest/src/adapters/weather/weather-adapter.test.ts` — 24 tests
passés après correctifs (F1/F2/F3 zero-holding/stale/jitter, F4 flush avant
throttle, F5 `pairDecidedAtBySignal`). Snapshot golden replay mis à jour : `engineVersion` `0.7.0` → `0.8.0` (mode replay, stats
inchangées).

Rebuild `@polywatch/backtest` requis pour que le backend charge `dist/`.

---

## Comparabilité des runs

| engineVersion | Comparable à 0.8.0 ? |
|---------------|----------------------|
| `< 0.5.0` | Non (garde-fous risk globaux) |
| `0.5.0` | Non (`multi_position_stale_mark`, clamp, résolution) |
| `0.6.0` | Non (sémantique d’entrée runner-sim) |
| `0.7.0` | Non (F4/F5/F8 non implémentés malgré la doc) |
| `0.8.0` | Oui |
