# Ne garder que le mode d'exécution `runner-sim` (retrait du mode `strategy`)

> **For Hermes:** implement this plan task-by-task with the polywatch-feature-development workflow; verify with the exact commands in each task.

**Goal:** Retirer le `backtestExecutionMode='strategy'` du moteur de backtest weather pour n'exécuter que `runner-sim`, sans toucher à la dimension indépendante `mode: reevaluate|replay`.

**Architecture:** `backtestExecutionMode` est un paramètre distinct de `mode`. Le mode `strategy` évalue chaque bucket isolément et produit des signaux mutuellement exclusifs (défaut documenté). On fige `runner-sim` comme seul comportement : suppression du chemin isolé dans l'adapter, du warning associé, du sélecteur UI, et du champ de propagation. Le schéma `params.ts` **garde** le champ en `.default('runner-sim')` pour rétro-compat (un body qui envoyait `'strategy'` ne casse pas l'API — la valeur est ignorée).

**Tech Stack:** TypeScript, Vitest, zod, SolidJS.

---

## Portée et limites (zones d'ombre explicites)

- **Dimension `mode` NON touchée.** `mode: 'reevaluate' | 'replay'` reste intact. Le `replay` (via `onSignal`) doit continuer de fonctionner — il est le socle du golden snapshot. Ce plan ne le modifie pas.
- **Méthodes partagées à CONSERVER** (utilisées par les deux modes / le replay) : `canEnter`, `openCountForCityDate`, `isDailyLossBreached`, `maybeForceCloseAll`, `evaluateExits`, `tryResolveByPrice`, `onSignal`, `flushPendingRunnerSimSignals`, `noteFillClampedIfNeeded`, `noteStaleMarks`, `getCurrentForecast`, `lastTickByCondition`, `exitManager`.
- **Chemin runner-sim à CONSERVER intégralement** : `BucketGroupStore`, `buildActiveMarketsForGroup`, `createRunnerSimStrategies`, `evaluateRunnerSimGroup`, `selectRunnerSimSignals`, `onBookTickRunnerSim`, le fallback `evaluate` par marché dans `runner-sim.ts` (garde pour stratégies futures sans `evaluateGroup`).
- **core (`@polywatch/core`) NON modifié** — aucun type/entité/signal core ne change. Aucun rebuild core nécessaire.

---

## Rétro-compat API (decision de conception)

Le schéma zod `params.ts:11` **continue d'accepter** `'strategy' | 'runner-sim'`, avec `.default('runner-sim')`. Sa valeur n'est plus transmise au moteur (dimension supprimée de `RunSpec`/`RunContext`). Un client qui envoie encore `backtestExecutionMode: 'strategy'` est **accepté silencieusement** et exécuté en `runner-sim`. On ne change pas le contrat API → aucun risque de 400 sur les anciens clients.

---

## Task 1 — Retirer le champ `backtestExecutionMode` du moteur (`runner.ts`)

**Objectif:** supprimer la dimension du contrat d'exécution.

**Fichiers:**
- Modify: `packages/backtest/src/engine/runner.ts` (lignes 41, 72, 150)

**Steps:**
1. Supprimer la ligne `backtestExecutionMode: 'strategy' | 'runner-sim';` dans `RunContext.params` (ligne 41).
2. Supprimer `backtestExecutionMode: 'strategy' | 'runner-sim';` de `RunSpec` (ligne 72).
3. Supprimer la ligne `backtestExecutionMode: spec.backtestExecutionMode,` du bloc `params: {...}` dans `run()` (ligne 150).

**Vérif:**
```bash
cd "C:/Users/lcsystem/Desktop/TradeInterface/Polytwatch versioning/Polywatch-v1.1"
npx tsc --noEmit -p packages/backtest/tsconfig.json
```
Attendu: erreurs TS sur `adapter-warnings.ts` (Task 4), `index.ts` (Task 3), `runner.test.ts` et `data-loader.test.ts` (Task 7). C'est attendu à ce stade.

---

## Task 2 — Normaliser l'adapter `weather-adapter.ts` (mode runner uniquement)

**Objectif:** rendre l'adapter toujours runner-sim, supprimer le chemin isolé mort et le champ `this.strategy`.

**Fichier:**
- Modify: `packages/backtest/src/adapters/weather/weather-adapter.ts`

**Steps (dans l'ordre):**

1. **Constructeur** (lignes 77-91) : remplacer la branche conditionnelle par un bloc toujours-runner-sim :
   ```ts
   constructor(ctx: RunContext) {
     const strategyId = (ctx.params.strategyId ?? WEATHER_FORECAST_STRATEGY_ID) as WeatherStrategyId;
     this.strategyId = strategyId;
     this.bag = getStrategyParams(ctx.configSnapshot, strategyId);
     this.runnerSimStrategies = createRunnerSimStrategies(ctx.configSnapshot, strategyId);
     for (const s of this.runnerSimStrategies) {
       s.setRiskConfig(getStrategyParams(ctx.configSnapshot, s.id));
     }
     this.exitManager = new WeatherExitManager();
   }
   ```
   - **Supprimer** le champ `private strategy: ClockedWeatherStrategy;` (déclaration ligne 60) et son initialisation.

2. **`finish`** (ligne 93-96) : retirer la condition — le flush est toujours exécuté :
   ```ts
   async finish(ctx: RunContext): Promise<void> {
     await this.flushPendingRunnerSimSignals(ctx);
     // ... (ghost positions inchangées)
   }
   ```

3. **`onBookTick`** (lignes 459-569) : retirer le chemin mort. Le bloc `if (ctx.params.backtestExecutionMode === 'runner-sim') { ... return; }` (lignes 482-485) disparaît **ainsi que tout le reste de la méthode après** (lignes 487-569 : reconstruction forecast isolée, `evaluateAt`, entrée single-market). La méthode devient :
   ```ts
   private async onBookTick(data: BookTickEventData, at: Date, ctx: RunContext): Promise<void> {
     this.lastTickByCondition.set(data.conditionId, { tick: data, at });
     this.maybeForceCloseAll(ctx);
     await this.evaluateExits(ctx);

     if (ctx.ledger.isDuplicateOpen(data.conditionId)) return;
     const maxPos = ctx.params.maxConcurrentPositions;
     if (ctx.ledger.openCount() >= maxPos) return;

     if (data.snapshotTargetDateIso && this.exitManager.isReentryBlocked(
       data.snapshotCity, data.snapshotTargetDateIso, ctx.clock.now(), ctx.configSnapshot, this.strategyId,
     )) return;

     if (ctx.params.mode === 'replay') return;

     await this.onBookTickRunnerSim(data, at, ctx);
   }
   ```
   **NE PAS supprimer** : `onBookTickRunnerSim` (ligne 408), `getCurrentForecast` (ligne 332), `onSignal` (ligne 571), `evaluateExits` (747), `tryResolveByPrice` (636), ni les helpers d'entrée/sortie partagés.

4. **`onBookTickRunnerSim` callback `onExcluded`** (lignes 433-445) : ce callback ne fait actuellement que `ctx.excludedTicks.push`. L'ancien chemin `strategy` émettait **aussi** les warnings `warnOnce('unsupported_metric_or_bucket')` et `noteLifecycleSkip('market_lifecycle_filtered')` dans `fidelityWarnings`. En supprimant le chemin `strategy`, on perd ces warnings → le test `ignores unsupported metrics with a fidelity warning (reevaluate)` (qui utilise `reevaluate` + défaut `runner-sim` et vérifie `fidelityWarnings`) va casser. Il faut donc modifier le callback pour rétablir la parité :
   ```ts
   const activeMarkets = buildActiveMarketsForGroup(
     ticks,
     ctx.clock.now().getTime(),
     (tick, reason) => {
       if (reason === 'market_lifecycle_filtered') {
         this.noteLifecycleSkip(ctx, tick, at);
         return; // noteLifecycleSkip pousse déjà dans excludedTicks
       }
       // unsupported_metric_or_bucket
       this.warnOnce(
         ctx,
         'unsupported_metric_or_bucket',
         `Marché ignoré (metric=${tick.snapshotMetric} non supporté) pour ${tick.snapshotCity}`,
       );
       ctx.excludedTicks.push({
         t: at,
         reason,
         city: tick.snapshotCity ?? null,
         conditionId: tick.conditionId,
         metric: tick.snapshotMetric ?? null,
       });
     },
   );
   ```
   **Pourquoi** : `noteLifecycleSkip` (weather-adapter.ts:138-151) appelle déjà `this.warnings.noteLifecycleSkip(ctx)` (compteur + `setOrUpdateWarning`) **et** pousse dans `ctx.excludedTicks`. Il ne faut donc **pas** re-pusher dans le branch `market_lifecycle_filtered`. Pour `unsupported_metric_or_bucket`, le `warnOnce` + push manuel sont nécessaires (parité avec l'ancien chemin `strategy`).

5. **Commentaire doc** (ligne 190) : adapter la phrase "`signal.strategyId` for runner-sim, `this.strategyId` for strategy mode" → "signal.strategyId (runner-sim)".

**Attention TS:** après suppression, `evaluateAt` de `ClockedWeatherStrategy` (clocked-weather-strategy.ts:33) n'a plus d'appelant. Vérifier avec `rg "evaluateAt"` dans `packages/backtest`. S'il est orphelin, le retirer de la classe (Task 5). `evaluate` (ligne 49) est **conservé** (utilisé par le fallback runner-sim.ts:115).

**Vérif:** `npx tsc --noEmit -p packages/backtest/tsconfig.json` — les erreurs restantes doivent être uniquement : `adapter-warnings.ts` (référence `ctx.params.backtestExecutionMode`, retirée en Task 4), `index.ts` (Task 3) et les tests `runner.test.ts` / `data-loader.test.ts` (Task 7). C'est attendu à ce stade.

---

## Task 3: Retirer la propagation dans `index.ts`

**Objectif:** arrêter de passer le champ désormais inexistant.

**Fichier:**
- Modify: `packages/backtest/src/index.ts` (ligne 93)

**Steps:**
- Supprimer la ligne `backtestExecutionMode: params.backtestExecutionMode,` du `runner.run({...})`.

**Vérif:** `npx tsc --noEmit -p packages/backtest/tsconfig.json` — ne doivent rester que : `adapter-warnings.ts` (Task 4) et les erreurs dans `runner.test.ts` / `data-loader.test.ts` (Task 7).

---

## Task 4: Retirer le warning `strategy_mode_no_group_selection`

**Objectif:** supprimer le warning devenu impossible (il référence `ctx.params.backtestExecutionMode`, champ supprimé en Task 1 — il faut donc le retirer avant que `tsc` soit vert).

**Fichier:**
- Modify: `packages/backtest/src/adapters/weather/adapter-warnings.ts` (lignes 63-69)

**Steps:**
- Retirer le bloc `if (ctx.params.backtestExecutionMode === 'strategy') { this.warnOnce(...) }`.

**Vérif:** aucun usage restant de `strategy_mode_no_group_selection` dans `packages/backtest` : `rg "strategy_mode_no_group_selection" packages/backtest` → 0.

---

## Task 5: Retirer `evaluateAt` orphelin de `ClockedWeatherStrategy`

**Fichier:**
- Modify: `packages/backtest/src/adapters/weather/clocked-weather-strategy.ts`

**Steps:**
- Après Task 2, vérifier `rg "evaluateAt" packages/backtest/src`. Si aucun appelant → supprimer la méthode `evaluateAt` (lignes 33-39).
- Vérifier aussi le commentaire redondant des lignes 41-48 (4 fois "Required by the WeatherStrategy interface...") → le réduire à un seul commentaire.

---

## Task 6: Supprimer le sélecteur et l'état UI du mode d'exécution

**Fichiers:**
- Modify: `packages/frontend/src/components/backtest/LaunchBacktestForm.tsx`
- Modify: `packages/frontend/src/components/WeatherAlgoBacktestTab.tsx`
- Modify: `packages/frontend/src/components/backtest/types.ts`
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/components/backtest/BacktestFidelityWarnings.tsx`

**Steps (dans cet ordre):**

1. `types.ts` : supprimer le fichier `packages/frontend/src/components/backtest/types.ts` (type `BacktestRunMode`) — il n'est utilisé que par LaunchBacktestForm et WeatherAlgoBacktestTab. Vérifier qu'il n'est importé nulle part ailleurs : `rg "BacktestRunMode" packages/frontend/src`. Si d'autres usages, retirer seulement la ligne 1 et mettre un export de placeholder si besoin (sinon le retirer complètement).

2. `LaunchBacktestForm.tsx` :
   - Retirer `import type { BacktestRunMode } from './types';` (ligne 8).
   - Retirer `executionMode: Accessor<BacktestRunMode>;` et `setExecutionMode: Setter<BacktestRunMode>;` de `LaunchBacktestFormProps` (lignes 43-44).
   - Retirer les usages `props.executionMode()` / `props.setExecutionMode(...)` du sélecteur (lignes 123-135).
   - Retirer le bloc `<label class="backtest-field">` du sélecteur d'exécution (lignes 120-136, du `<span>Exécution backtest</span>` jusqu'à la fermeture `</label>`), y compris le `<Show when={props.executionMode() === 'strategy'}>` (lignes 131-135).
   - Conserver `import { Show } from 'solid-js'` — d'autres `<Show>` restent dans le fichier (coverage, coverageLoading, launchError).

3. `WeatherAlgoBacktestTab.tsx` :
   - Retirer le signal `executionMode`/`setExecutionMode` (lignes 67-71).
   - Retirer `backtestExecutionMode: executionMode(),` de l'objet `body` de `submit` (ligne 355).
   - Retirer les props `executionMode={executionMode}` et `setExecutionMode={setExecutionMode}` dans `<LaunchBacktestForm ...>` (lignes 483-484).

4. `api.ts` : retirer `backtestExecutionMode?: 'strategy' | 'runner-sim';` de `BacktestRunParamsInput` (ligne 1163).

5. `BacktestFidelityWarnings.tsx` : retirer le **bloc entier** `strategy_mode_no_group_selection` (lignes 90-94 : `icon`/`title`/`hint`).

**Vérif:** `rg -n "executionMode|BacktestRunMode|strategy_mode_no_group_selection|runner-sim|strategy'" packages/frontend/src` → doit ne rester que les `<option value="runner-sim">` si ce champ de body existait encore (après Task 6, aucun).

---

## Task 7: Nettoyer les tests backtest qui passent le champ supprimé

**Fichiers:**
- Modify: `packages/backtest/src/engine/runner.test.ts` (lignes 41, 140, 178)
- Modify: `packages/backtest/src/adapters/weather/data-loader.test.ts` (ligne 21)

**Steps:**
- Retirer chaque ligne `backtestExecutionMode: 'runner-sim',` de ces fichiers.

**Vérif:** `npx tsc --noEmit -p packages/backtest/tsconfig.json` → plus d'erreurs.

---

## Task 8: Vérifier et ajuster `weather-adapter.test.ts`

**Fichier:**
- Modify (si besoin): `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

**Analyse:** la majorité des tests utilisent `mode: 'replay'` (entrée via `onSignal`, qui n'utilise jamais `backtestExecutionMode`). **Un test utilise `reevaluate`** : `ignores unsupported metrics with a fidelity warning (reevaluate)` (ligne 362). Ce test ne passe pas `backtestExecutionMode` explicitement → il utilise le défaut zod qui devient `'runner-sim'`. Avec la correction du callback `onExcluded` (Task 2, step 4), le warning `unsupported_metric_or_bucket` est ré-émis en `runner-sim` → le test doit rester vert **sans modification**.

**Vérification obligatoire après Tasks 1-7 :**
```bash
npx vitest run packages/backtest/src/adapters/weather/weather-adapter.test.ts
```
- Si le test `ignores unsupported metrics` échoue → le callback `onExcluded` n'a pas été correctement modifié (Task 2, step 4). Re-vérifier.
- Aucun test ne devrait référencer `strategy_mode_no_group_selection` dans ses assertions : `rg "strategy_mode_no_group_selection" packages/backtest/src` → 0.

---

## Task 9: Mettre à jour la documentation

**Fichier:**
- Modify: `docs/backtest.md`

**Steps:**
- Ligne 53-54 (§1) : "Avec `backtestExecutionMode=strategy` (défaut) : évaluation par tick / bucket. Avec `runner-sim`..." → réécrire : "évaluation regroupée ville/date + `evaluateGroup` + dedup / `selectionMode` (proche live ; l'UI passe un seul `strategyId`)." Mentionner que `runner-sim` est désormais l'unique mode d'exécution.
- Ligne 96 (§1 tableau warnings) : retirer la ligne `strategy_mode_no_group_selection`.
- §2 (lignes 136-165) : supprimer la colonne/description de `backtestExecutionMode` si présente, indiquer que le champ est conservé dans le schéma pour rétro-compat mais ignoré.
- Chercher toute autre mention `runner-sim`/`strategy` dans `docs/backtest.md` et aligner.

**Vérif:** `rg -n "strategy|runner-sim|backtestExecutionMode" docs/backtest.md` → cohérent avec le nouveau comportement.

---

## Task 10: Build + lint + tests globaux (validFichier)

**Commandes (depuis la racine du monorepo):**
```bash
cd "/c/Users/lcsystem/Desktop/TradeInterface/Polytwatch versioning/Polywatch-v1.1"
npm run test -w @polywatch/backtest
npm run lint
npm run build
```

**Attendu:**
- `npm run test -w @polywatch/backtest` → tous les tests (runner, adapter, data-loader, runner-sim, stats, exit-manager, fill-engine, merge-event-streams, golden-replay) verts.
- `npm run lint` → 0 erreur.
- `npm run build` → builds core + backtest + backend + frontend réussis (ordre core→back→frontend, vérifier dans package.json le script build racine).

**Vérification anti-régression à la main :** que la fonctionnalité runner-sim n'est pas cassée :
```bash
rg -n "evaluateGroup|onBookTickRunnerSim|flushPendingRunnerSimSignals|BucketGroupStore|applySelectionMode" packages/backtest/src/adapters/weather/
```
→ toutes les fonctions runner-sim présentes, aucune branche `=== 'strategy'` restante :
```bash
rg -n "=== 'strategy'|'strategy' mode|strategy_mode" packages/
```
→ 0.

---

## Risques / décisions

- **Bug fantôme corrigé (warnings `unsupported_metric_or_bucket` et `market_lifecycle_filtered`)** : l'ancien chemin `strategy` émettait ces warnings dans `fidelityWarnings` via `warnOnce` / `noteLifecycleSkip`. Le callback `onExcluded` de `onBookTickRunnerSim` ne faisait que `ctx.excludedTicks.push` sans émettre de warning. En supprimant le chemin `strategy` et en faisant de `runner-sim` le défaut, le test `ignores unsupported metrics (reevaluate)` aurait cassé silencieusement. Le plan corrige cela en modifiant le callback (Task 2, step 4) pour ré-émettre les warnings. **Point d'attention principal de l'implémentation.**
- **Rétro-compat API (choisi)** : on garde le champ dans le schéma pour ne pas casser les anciens bodies. Coût : 1 ligne mort dans `params.ts`. Acceptable (YAGNI inversé au profit de l'opération).
- **`evaluateAt` orphelin** : retiré (Task 5) — c'est le seul endroit qui l'utilisait. Le fallback `evaluate` par marché est conservé dans `runner-sim.ts` pour stratégies futures sans `evaluateGroup`.
- **Pas de changement en DB** : aucune migration, aucun champ d'entité. Les runs passés (stockés en DB) restent affichables tels quels.
- **Golden snapshot (`golden-replay.test.ts`)** : utilise `mode: 'replay'`, non affecté par la suppression du chemin reevaluate-isolé. Doit rester vert (Task 10 le confirme).
- **Test `ignores unsupported metrics` (ligne 362)** : utilise `mode: 'reevaluate'` + défaut `runner-sim`. Avant la correction du callback (Task 2, step 4), ce test aurait échoué car le warning `unsupported_metric_or_bucket` n'était pas émis en `runner-sim`. Après correction, il doit rester vert sans modification.

## Exécution

Suite à la fin de ce plan, proposer une exécution directe (pas de délégation nécessaire — tâches mécaniques et bien balisées, volume modéré). Vérification finale sur `npm run test`, `npm run lint`, `npm run build` réels, pas de sortie inventée.
