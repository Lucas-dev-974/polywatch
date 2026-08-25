# Plan — Weather algo : 4 modes de sélection de stratégie

**Date** : 2026-08-25
**Auteur** : Assistant IA
**Statut** : 🟢 **Prêt à implémenter** — vague **F** du [plan maître](./2026-08-25_PLAN-weather-algo-implementation-master.md) (après A–E)
**Référence audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)
**Constat couvert** : #4 (first-wins vs multi-lanes)
**Plan d'orchestration** : [`2026-08-25_PLAN-weather-algo-implementation-master.md`](./2026-08-25_PLAN-weather-algo-implementation-master.md)
**Plan lié** : remplace la Phase 2 du plan [`2026-08-25_PLAN-weather-algo-date-unique-et-multi-lanes.md`](./2026-08-25_PLAN-weather-algo-date-unique-et-multi-lanes.md)

---

## 📋 Contexte

L'utilisateur veut pouvoir configurer **comment l'algo parcourt les stratégies** sur une même paire (ville, date). **4 modes** :

1. **`single`** : une seule stratégie configurée (`weatherAlgoSingleStrategyId`), l'algo n'évalue qu'elle.
2. **`first-wins`** : parcours dans l'ordre du catalogue, **1er signal** (comportement actuel). Défaut.
3. **`multi`** : évalue **toutes** les stratégies ; chaque signal gagnant peut ouvrir une position sur la **même** ville+date (sous `maxPositionsPerCityDate` par stratégie).
4. **`consensus`** : accumule les votes sur une fenêtre, n'ouvre que si assez de stratégies s'accordent sur le **même palier**.

⚠️ **Ne pas confondre** avec `weatherAlgoSelectionMode` (`single` / `multi`) qui filtre **entre villes**. Les deux axes sont orthogonaux : d'abord les stratégies (ce plan), ensuite le filtre ville (`applySelectionMode`).

Dans l'UI, **ne jamais** libeller les deux selects « Mode single » sans préfixe : « Sélection des villes » vs « Parcours des stratégies ».

**Décisions produit (revue 2026-08-25)** :
- 4 modes (`multi` stratégies conservé, en plus du consensus).
- Consensus : accord sur **même palier (`conditionId`)**.
- Consensus : quorum **configurable** (défaut `0.67`).
- Consensus : pas de quorum → **skip**.
- Consensus : fenêtre défaut **60 min** (2 polls si `pollMs` = 30 min). **Garder `windowMs >= pollMs`** (valider à l'API).
- Consensus : `highest-yes` vote **égal**.
- Consensus : exits **immédiats** ; seules les entrées attendent la fin de fenêtre.
- Consensus : **re-fetch** prix + forecast en fin de fenêtre, **puis** `applySelectionMode` (filtre ville).
- Consensus : **1 vote par stratégie et par paire (ville, date) et par fenêtre** = dernier palier seulement (si le palier change entre polls **sur cette paire**, l'ancien vote est écrasé). **Pas** 1 vote mondial par stratégie — sinon la dernière ville de la boucle efface Paris, Londres, etc.
- Consensus : **1 position** par palier au quorum. Signal / bag d'entry = **`weather-forecast-aligned` s'il a voté**, sinon premier votant dans l'ordre catalogue (forecast → highest-yes). Les autres votes ne servent qu'au décompte. *(Correction autopilote : cohérent avec la thèse aligned, pas avec first-wins catalogue.)*
- Consensus : **live only**. Le backtest (`evaluateRunnerSimGroup`) reste first-wins ; pas de fenêtre Redis en replay.
- Consensus 1 stratégie activée : `ceil(1 * 0.67) = 1` → first-wins retardé d'une fenêtre. UI : hint, pas de refus API.

---

## 1. Nouveau config : `weatherAlgoStrategySelectionMode`

### Champs à ajouter à `WeatherConfig`

| Champ | Type | Default | Description |
|---|---|---|---|
| `weatherAlgoStrategySelectionMode` | `string` | `'first-wins'` | `single` / `first-wins` / `multi` / `consensus` |
| `weatherAlgoSingleStrategyId` | `string \| null` | `null` | Stratégie unique si mode `single`. Si null ou pas dans la liste activée → skip entries (`lastSkipReason = 'single_strategy_missing'`), **ne pas** retomber silencieusement sur first-wins. |
| `weatherAlgoConsensusWindowMs` | `number` | `3_600_000` (60 min) | Fenêtre de consensus. API : `>= weatherAlgoPollMs`. |
| `weatherAlgoConsensusQuorum` | `number` | `0.67` | Ratio 0–1. `requiredVotes = ceil(nStratégiesActivées * quorum)`. Un abstention compte dans le dénominateur (pas au numérateur). |

### Migration TypeORM

```ts
// AddWeatherStrategySelectionMode1700000000120
export class AddWeatherStrategySelectionMode1700000000120 implements MigrationInterface {
  name = 'AddWeatherStrategySelectionMode1700000000120';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_strategy_selection_mode" TEXT DEFAULT 'first-wins'`);
    await queryRunner.query(`ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_single_strategy_id" TEXT`);
    await queryRunner.query(`ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_consensus_window_ms" INTEGER DEFAULT 3600000`);
    await queryRunner.query(`ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_consensus_quorum" REAL DEFAULT 0.67`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_strategy_selection_mode"`);
    await queryRunner.query(`ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_single_strategy_id"`);
    await queryRunner.query(`ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_consensus_window_ms"`);
    await queryRunner.query(`ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_consensus_quorum"`);
  }
}
```

Numéro **0120** : libre (0119 = `AddBacktestRunUserIdAndActiveUnique` ; le nom `0120` backtest n'a jamais été créé). Si un autre patch a pris 0120 entre-temps, incrémenter.

### Fichiers touchés

- `packages/core/src/entities/WeatherConfig.ts` (4 nouveaux champs)
- `packages/core/src/migrations/AddWeatherStrategySelectionMode1700000000120.ts` (nouveau)
- `packages/backend/src/routes/config-per-kind.ts` — **`weatherConfigUpdateSchema` est `.strict()`** : ajouter les 4 champs ici (pas « étendre l'enum `weatherAlgoSelectionMode` »). Nouvel enum `weatherAlgoStrategySelectionMode: z.enum(['single','first-wins','multi','consensus'])`. Valider `consensusWindowMs >= pollMs` au PATCH. Si mode `single`, `weatherAlgoSingleStrategyId` obligatoire (non vide).
- `packages/backend/src/routes/config.ts` seulement si encore un schéma legacy parallèle.
- `packages/frontend/src/api/config.ts` (type + nouveaux champs)
- `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx` (UI : select mode + champs)

---

## 2. Mode `single` — une seule stratégie configurée

### Comportement

L'algo n'évalue **qu'une seule stratégie** (`weatherAlgoSingleStrategyId`). Les autres stratégies activées dans `weatherAlgoStrategies` sont ignorées pour l'entry (mais leurs positions ouvertes restent gérées par l'exit evaluator).

### Patch

Dans `WeatherStrategyRunner.runEvaluationCycle` (`strategy-runner.ts`), **avant** le check `strategies.length === 0` :

```ts
const strategyMode = risk.weatherAlgoStrategySelectionMode ?? 'first-wins';
let strategies = this.registry.getOrdered(enabledStrategyIds);

if (strategyMode === 'single') {
  const singleId = risk.weatherAlgoSingleStrategyId;
  if (!singleId) {
    status.lastSkipReason = 'single_strategy_missing';
    status.lastSkipAt = Date.now();
    log.warn('single strategy mode: weatherAlgoSingleStrategyId is null');
    return; // ne PAS évaluer le catalogue entier
  }
  strategies = strategies.filter((s) => s.id === singleId);
  if (strategies.length === 0) {
    status.lastSkipReason = 'single_strategy_missing';
    status.lastSkipAt = Date.now();
    log.warn({ singleId, enabledStrategyIds }, 'single strategy mode: configured strategy not in enabled list');
    return;
  }
}
```

**Bug évité** : si `singleId` est `null` et qu'on ne filtre pas, le runner évaluerait **toutes** les stratégies activées (first-wins / multi de fait). Le tableau de config dit skip — le code doit `return`, pas seulement `warn`.

`evaluateCityFollowDateGroup` reçoit `strategies` (déjà filtré, 1 élément) et **garde le `return` au premier signal** (une seule stratégie).

### Fichiers touchés

- `packages/weather-algo/src/strategy/strategy-runner.ts`
- Tests : `strategy-runner.test.ts` (mode single → 1 seule stratégie ; `singleId` null → skip, 0 signal)

---

## 3. Mode `first-wins` — comportement actuel

Aucun changement de boucle. Documenter. Défaut. `evaluateCityFollowDateGroup` **garde** le `return` au premier signal.

---

## 3bis. Mode `multi` — toutes les stratégies émettent

Brancher **dans** `evaluateCityFollowDateGroup` :

- `first-wins` et `single` : **garder** `return` au premier signal.
- `multi` et `consensus` : collecter `WeatherSignal[]` (pas de `return` précoce).

`dedupSignalsByCityDate` puis, pour `multi` seulement, `applySelectionMode` (filtre **villes**) + `onSignal`. En `consensus`, les signaux vont au Redis de votes, **pas** à `onSignal` tout de suite.

Capacité : `maxPositionsPerCityDate` est **par stratégie**. Documenter la double exposition possible (forecast + highest-yes sur Paris-demain). Pas de cap global toutes stratégies dans ce plan.

**Ne pas** réutiliser `weatherAlgoSelectionMode === 'single'` pour signifier « une stratégie » : ce champ reste le filtre **villes**.

Tests : 2 stratégies gagnantes même paire → 2 signaux avant le filtre ville.

---

## 4. Mode `consensus` — fenêtre + quorum

### Bugs du draft initial (ne pas implémenter)

1. `evaluateConsensusWindow()` puis **`return`** sans stocker les votes du cycle courant → la fenêtre reste vide à jamais.
2. Clé Redis par `(window, conditionId, strategyId)` → si le palier change, l'ancien `conditionId` reste et **double-vote**.
3. Clé par `(window, strategyId)` **sans ville/date** → un seul vote mondial ; la dernière ville de la boucle écrase les autres.
4. `KEYS` Redis (O(N) bloquant). `JSON.parse` d'une `Date` → string → `.toISOString()` explose au tally.
5. `validateConsensusSignal` qui « retourne le signal original » = no-op (gates jamais rejouées).
6. Oublier `applySelectionMode` → toutes les villes au quorum ouvrent, même en `weatherAlgoSelectionMode=single`.

### Flux correct d'un cycle

```
1. Exits (immédiat, inchangé)
2. Évaluer TOUTES les stratégies (comme multi) ; écrire le vote Redis de la fenêtre COURANTE
   (par paire ville+date, pas un vote global)
3. Si la fenêtre PRÉCÉDENTE vient de se terminer : tally + re-fetch + applySelectionMode + onSignal
```

Étapes 2 et 3 dans le **même** cycle (premier poll de la nouvelle fenêtre = flush de l'ancienne + début des votes de la nouvelle). **Ne pas** `return` entre 2 et 3.

### Vote : 1 par stratégie **et par paire ville+date** et par fenêtre

Clé : `weather-consensus:{windowStartIso}:{normalizeWeatherCity(city)}:{dateIso}:{strategyId}`

`Hong Kong` / `hong kong` = même vote. Extraire `normalizeWeatherCity` (déjà dans le runner).

Valeur JSON : `{ conditionId, signal }` avec `signal.targetDate` sérialisé en **ISO string**. Au parse, revivre `targetDate = new Date(signal.targetDate)` — un `JSON.parse` brut laisse une string et casse le cap Redis / forecast.

- Signal → `SET` (écrase le palier précédent de **cette** stratégie sur **cette** paire).
- Abstention → `DEL` la clé de cette stratégie pour cette paire dans la fenêtre (elle ne vote plus).
- Ne **pas** clé par `conditionId` : palier 24 °C puis 25 °C laisserait deux votes.
- Ne **pas** omettre `city`+`dateIso` : une stratégie émet un signal par groupe ville+date dans la même boucle.

TTL = `2 * windowMs`. **`SCAN`**, pas `KEYS`.

### Tally

`requiredVotes = ceil(enabledStrategyCount * quorum)` — dénominateur = stratégies **activées** (un abstention pèse).

Grouper les votes restants par `conditionId`. Si `votes.length >= requiredVotes` → candidat.

Plusieurs `conditionId` peuvent passer (villes différentes, ou deux paliers de la même ville si deux paires… en pratique un palier par paire). Passer **un signal représentatif par conditionId**, après re-fetch, dans **`applySelectionMode`** (`weatherAlgoSelectionMode` villes).

**Signal représentatif** (pas l'ordre SCAN) :

```ts
function pickConsensusExecutor(votes: WeatherSignal[]): WeatherSignal {
  const aligned = votes.find((v) => v.strategyId === WEATHER_FORECAST_ALIGNED_STRATEGY_ID);
  if (aligned) return aligned;
  const order = WEATHER_STRATEGY_CATALOG.map((s) => s.id);
  return [...votes].sort((a, b) => order.indexOf(a.strategyId) - order.indexOf(b.strategyId))[0]!;
}
```

C'est ce signal qui va à `onSignal` / pipeline (sizing, SL/TP, `strategyId` snapshot). Test : forecast + aligned d'accord → position taguée **aligned**.

### Re-fetch réel (pas un no-op)

Ne pas réimplémenter les gates dans le runner. **Déléguer au pipeline d'entry** (`runWeatherEntryPipeline`), qui refetch déjà le CLOB (plan CLOB #3) : au tally, n'émettre que des candidats quorum ; le pipeline drop si l'edge CLOB / minYesPrice / forecast a disparu.

Forecast : cache live = **60 min** (`WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT`) = fenêtre consensus. Un `getOrFetch` normal à la clôture de fenêtre **revient du cache** du 1er poll → le « re-fetch » est un no-op.

**Obligatoire** : avant `onSignal` des candidats, `forecastService.getOrFetch(..., ttlMs)` avec **`forceRefresh: true`** (nouveau flag : ignorer `isFresh`, refetch Open-Meteo, réécrire le cache). Si fetch KO → garder stale et laisser le pipeline décider (fail-open forecast existant) ; log `consensus_forecast_refresh_failed`. Ne pas skip le palier uniquement pour un cache miss si un stale existe (le CLOB gate reste la garde prix).

Le runner **n'a pas** besoin de `marketService` / `connectionManager` si toute la validation live est dans le pipeline.

### Marqueur `SET NX`

`ioredis` : `set(processedKey, '1', 'EX', ttlSec, 'NX')` comme `simulation.ts`. Retour `null` = déjà traitée. Ne pas comparer à `'OK'` sans vérifier le client (certains wrappers).

`processedKey = weather-consensus-processed:{windowStartIso}`.

**Poll en retard** : ne pas se limiter à `now - windowMs`. Un cycle sauté laisserait une fenêtre jamais tallyée (votes TTL 2× puis disparus). À chaque cycle, tenter le flush de **toute fenêtre dont `end <= now`**, jusqu'à 2 fenêtres en arrière (`i = 1, 2` : `resolveConsensusWindow(now - i * windowMs)`). `SET NX` empêche le double traitement.

### Dépendance poll / fenêtre

Si `windowMs < pollMs`, 0–1 poll par fenêtre → consensus dégénéré. API refuse. Défaut 60 min vs poll 30 min = 2 votes max par stratégie et par paire.

### Tests minimaux

- Palier qui change sur Paris : un seul vote restant (25 °C), pas 24+25.
- Deux villes (Paris + Londres) : forecast vote les deux ; les deux clés coexistent.
- 2 villes au quorum + `weatherAlgoSelectionMode=single` → 1 ville.
- Quorum non atteint → 0 entry.
- Re-fetch / pipeline skip (edge CLOB mort) → pas d'enqueue.

### Fichiers touchés

- `packages/weather-algo/src/strategy/strategy-runner.ts`
- `packages/weather-algo/src/strategy/strategy-runner-selection.ts` (consensus n'ignore pas `applySelectionMode`)
- `packages/core/src/services/weather-forecast.service.ts` (`forceRefresh`)
- `packages/core/src/redis/sim-reset-redis-hygiene.ts` (SCAN/DEL `weather-consensus*` + `weather-consensus-processed*` au reset sim)
- Tests : `strategy-runner.test.ts` ; `weather-forecast.service` forceRefresh

---

## 5. UI — Configuration des 4 modes

### Onglet Paramètres (`WeatherAlgoSettingsTab`)

Section **« Parcours des stratégies »** (libellé distinct du select villes) :

```
Parcours des stratégies : [first-wins ▾]
  ○ First-wins (1er signal) — défaut
  ○ Single (une seule stratégie) → Strategy ID : [weather-forecast-aligned ▾]
  ○ Multi (toutes les stratégies, même ville+date)
  ○ Consensus (fenêtre + quorum)
      Fenêtre (ms) : [3600000]
      Quorum (0–1) : [0.67]
```

- Mode `single` : select des stratégies **activées** ; ID obligatoire.
- Mode `consensus` : `windowMs` et `quorum`.
- Mode `multi` : hint « double exposition possible par ville+date ».
- Mode `first-wins` : aucun champ supplémentaire.

### Fichiers touchés

- `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx`

---

## 6. Doc

Mettre à jour :

- `docs/weather-algo.md` §3 : **4** modes (stratégies) vs `weatherAlgoSelectionMode` (villes).
- `docs/code/08-weather-algo.md` : consensus (fenêtre, clé Redis par ville+date+stratégie, quorum, re-fetch via pipeline, `applySelectionMode`).
- `docs/configuration.md` : 4 nouveaux champs.

---

## Checklist de validation

### Config + migration
- [ ] 4 nouveaux champs dans `WeatherConfig`
- [ ] Migration TypeORM (numéro libre)
- [ ] Schema zod `.strict()` étendu (`config-per-kind.ts`) + `windowMs >= pollMs`
- [ ] UI : 4 modes, libellés distincts du filtre villes

### Mode `single`
- [ ] Une seule stratégie évaluée
- [ ] `singleId` null **ou** pas dans la liste activée → skip (`single_strategy_missing`), **0** signal
- [ ] Test dédié (pas seulement warn)

### Mode `first-wins`
- [ ] `return` au premier signal conservé
- [ ] Test : comportement actuel

### Mode `multi`
- [ ] 2 stratégies gagnantes → 2 signaux avant filtre ville
- [ ] `maxPositionsPerCityDate` reste par stratégie

### Mode `consensus`
- [ ] Votes Redis par `(fenêtre, city, dateIso, strategyId)` — pas par conditionId, pas globaux
- [ ] Palier qui change → un seul vote
- [ ] Deux villes → deux votes forecast possibles
- [ ] `targetDate` revivifié au parse
- [ ] `SCAN` + `SET NX`
- [ ] Fin de fenêtre : pipeline re-fetch ; puis `applySelectionMode`
- [ ] Quorum configurable ; skip si non atteint
- [ ] Exits immédiats
- [ ] `highest-yes` vote égal
- [ ] Exécuteur = aligned s'il a voté, sinon 1er catalogue ; 1 entry par palier
- [ ] Test : forecast+aligned d'accord → `strategyId` aligned
- [ ] Test : quorum 2/3 → entry ; quorum raté → skip ; filtre ville single → 1 ville
- [ ] `forceRefresh` forecast à la clôture de fenêtre
- [ ] Flush jusqu'à 2 fenêtres en retard (`SET NX`)
- [ ] Clés ville normalisées ; reset sim purge `weather-consensus*`

### Doc
- [ ] 4 modes documentés (pas 3)
- [ ] `configuration.md` : 4 champs

---

## Références

- Audit : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md) §4 #4
- Plan remplacé : [`2026-08-25_PLAN-weather-algo-date-unique-et-multi-lanes.md`](./2026-08-25_PLAN-weather-algo-date-unique-et-multi-lanes.md) Phase 2
