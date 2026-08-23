# Plan de patch — Audit weather backtest complet

**Date** : 2026-08-23
**Auteur** : Assistant IA
**Statut** : ✅ **Appliqué** — implémenté et validé (commit `d1bea64`)
**Référence** : [`docs/audits/2026-08-23_audit-weather-backtest-complet.md`](../audits/2026-08-23_audit-weather-backtest-complet.md)
**Engine version cible** : `0.6.0` (bump appliqué — changements sémantiques de replay)

> **Note de mise à jour (2026-08-23)** : ce plan a été intégralement implémenté puis commité
> (`d1bea64`). La checklist en §3.2 est cochée au niveau de l'implémentation réelle. Une
> section « Écarts / décisions finales » documente les points où le code livré diverge
> légèrement du plan d'origine (volontairement ou par simplification).

---

## 📋 Structure du plan

Le plan est organisé en **3 phases séquentielles** :

- **Phase 1 — Fixes** : corriger chaque finding confirmé de l'audit, par ordre de gravité décroissante. Chaque patch est indépendant et committable séparément.
- **Phase 2 — Nettoyage dead code** : supprimer le code mort identifié pendant l'audit.
- **Phase 3 — Vérification finale** : tests de régression, golden snapshot, build, et revue croisée de chaque fix.

Chaque section référence le finding de l'audit (`C1`, `M5`, etc.) et indique les fichiers touchés avec file:line.

---

## ⚠️ Corrections apportées au plan pendant la vérification

Le plan a été relu contre le code source réel. Les corrections suivantes ont été apportées pour éviter d'introduire des bugs :

| Section | Correction | Raison |
|---|---|---|
| §1.1 (C1/C2/M6) | **Rétrogradé** de « fix sémantique » à « transparence + doc » | Le backtest ne peut pas reconstruire le prix d'un marché entre ses ticks observés. C1 est une **limitation de fidélité inhérente**, pas un bug corrigible. Le patch devient un warning + documentation, pas un changement de PnL. |
| §1.2 (C3) | Précisé : ne pas changer le code `strategy` mode | C'est un mode legacy intentionnel. Patch purement warning + doc. |
| §1.3 (C4) | Ajouté la rétro-compatibilité des runs hérités (`userId = null`) | Sans ça, les runs existants deviendraient invisibles après migration. |
| §1.4 (C5) | Clarifié la cohérence avec §1.3 (`userId` dans l'index unique) | L'index unique doit inclure `user_id` pour matcher le lock par utilisateur. |
| §1.5 (C6) | Corrigé le cursor SQL : `getCount()` séparé + `truncated` cohérent | `LIMIT/OFFSET` ne retourne pas le total ; il faut un `getCount` séparé. Le `truncated` doit se baser sur `total`, pas sur `allMarkets.length`. |
| §1.9 (M1/M7) | Clarifié : clamping à 1.0 → fees=0 (curve=0), c'est correct | Le clamping empêche `entryPrice > 1` mais les fees restent 0 au prix 1 (comportement Polymarket). Documenter. |
| §1.10 (M2) | **Rétrogradé en nit cosmétique** | `computeTakerFee` à `price=1` ou `0` → `curve=0` → fees=0. Appliquer `simulateWeatherExitFill` ne change rien au PnL. M2 n'est pas un bug réel. |
| §1.12 (M9) | Corrigé le regex `between` pour les négatifs + `parseFloat` | `parseInt` tronquerait les décimales. Le regex `-5-10°` (X négatif) doit être géré. |
| §1.14 (M15) | **Corrigé un bug critique** : ne pas passer en timezone local | Le backend fait `new Date(params.from)` → interprétation selon le timezone du serveur Node (non déterministe). **Garder le `Z` (UTC)**, juste documenter. |
| §1.15 (m5) | **Corrigé un bug** : retirer la garde `peak > 0` seul → division par zéro | La formule `(peak - s.equity)/peak` divise par `peak`. Si `peak ≤ 0`, division par zéro ou drawdown négatif. Rétrogradé en doc. |
| §2.1 | **Corrigé** : ne pas supprimer `evaluate` (exigé par l'interface `WeatherStrategy`) | `strategy.ts:49` exige `evaluate`. Supprimer casserait l'implémentation. |
| §2.1 | **Corrigé** : ne pas supprimer le paramètre `_now` de `equityAt` | `runner.ts:188` appelle `equityAt(clock.now())`. Supprimer casserait l'appel. |

**Conclusion** : le plan initial aurait introduit **3 bugs critiques** (timezone non déterministe, division par zéro dans drawdown, suppression de méthode d'interface) et **2 bugs mineurs** (cursor SQL sans getCount, regex négatif). Tous corrigés.

### Corrections supplémentaires (passe finale de cohérence)

| Section | Correction | Raison |
|---|---|---|
| §1.1 (C1) | Précisé les 2 appels `noteStaleTickIfNeeded` à remplacer (lignes 737 et 790) | Sans préciser les lignes, le patch risquait de ne remplacer qu'un seul appel. |
| §1.5 (C6) | Étendu aux **deux** endpoints `/markets-series` ET `/runs/:id/markets-series` | Le second endpoint (`backtest.ts:440-610`) a le même bug full-scan + slice mémoire. Le plan initial ne mentionnait que le premier. |
| §1.7 (C8) | Précisé la modification des **deux appelants** `useBacktestPolling` (`WeatherAlgoBacktestTab.tsx:107,113`) | Sans modifier les appelants (qui passent `() => { void refreshDetail() }` retournant `void`), le `await onTick()` ne wait rien — la garde anti-réentrance serait inopérante. |
| §1.14 (M16) | Corrigé la détection 404 : `err.message === 'not_found'` au lieu de `err.message.includes('404')` | La fonction `api()` (`api.ts:209`) lance `new Error(body.error)` où `body.error === 'not_found'` pour un 404 (`backtest.ts:164`). L'exception ne contient pas "404". |

**Conclusion finale** : le plan est maintenant cohérent avec le code réel et prêt à implémenter.

---

# Phase 1 — Fixes (par ordre de gravité)

## §1.1 — C1/C2/M6 : Marks périmés multi-position (cluster critique)

**Référence audit** : C1, C2, M6
**Fichiers** : `packages/backtest/src/adapters/weather/weather-adapter.ts:697-719`, `packages/backtest/src/engine/ledger.ts:138-152`

### Problème
`evaluateExits` n'utilise que le tick périmé de chaque position. Le mark, le trailing peak et le SL/TP ne sont évalués que sur le tick propre à chaque `conditionId`, jamais sur l'état courant du marché.

⚠️ **Limitation fondamentale confirmée** : le backtest ne dispose que des ticks **observés** pour chaque `conditionId`. Il ne peut pas reconstruire le prix d'un marché entre deux de ses ticks. Donc le mark d'une position est nécessairement « lag-1 par condition » — il ne peut pas être plus frais que le dernier tick observé pour ce marché. **C1 n'est pas un bug corrigible sans données supplémentaires** : c'est une limitation de fidélité inhérente au replay.

### Patch (transparence + documentation, pas de changement de sémantique de PnL)
1. **Vérifier** que `evaluateExits` (`weather-adapter.ts:697-719`) appelle bien `updateMark` pour **toutes** les positions ouvertes sur leur propre tick (lignes 707-718) — c'est déjà le cas. Ne pas modifier.
2. **Compter les positions dont le tick est âgé > `pollMs`** et émettre un warning agrégé `multi_position_stale_mark` (via `setOrUpdateWarning`) avec le nombre de positions concernées et l'âge max. ⚠️ **Implémentation** : remplacer les **deux** appels existants à `noteStaleTickIfNeeded` (ligne 737 dans `evaluateExits` pour SL/TP, ligne 790 dans `tryExitByDecision` pour drift/bucket) par un seul comptage agrégé **après la boucle `evaluateExits`**. Concrètement :
   - Supprimer les appels `noteStaleTickIfNeeded` aux lignes 737 et 790.
   - À la fin de `evaluateExits`, itérer les positions ouvertes, compter celles dont `clock.now() - cached.at > pollMs`, et appeler `setOrUpdateWarning(ctx, 'multi_position_stale_mark', ...)` une seule fois avec le compte et l'âge max.
   - Cela évite le bruit d'un warning par position et unifie la détection.
3. **Documenter** dans `docs/backtest.md` section « Limitations de fidélité » : le mark est lag-1 par condition, le trailing peak n'avance que sur le tick propre à chaque position, l'equity curve sous-représente les mouvements intra-sample pour les positions non-tickantes.
4. **Bumper `engineVersion` à `0.6.0`** (warning ajouté, transparence accrue, pas de changement de PnL).

⚠️ **Ce qui n'est PAS fixé** (documenté explicitement) :
- Le trailing peak d'une position n'avance que sur son propre tick (M6). Un pic favorable atteint via un autre marché ne déclenche pas le trailing. **Comportement conservé**, limitation documentée.
- L'equity curve est plate pour les positions non-tickantes entre leurs ticks (Q1). **Comportement conservé**.

### Tests
- Ajouter `weather-adapter.test.ts` : un run multi-position où une position a un tick âgé > `pollMs` → vérifier que le warning `multi_position_stale_mark` est émis avec le bon compte.
- Ajouter un test `trailing_stop_lag1_documented` : documenter que le trailing ne se déclenche pas sur un pic d'un autre marché (comportement attendu, pas un bug).

### Bump
`engine-version.ts` : `0.5.0` → `0.6.0`.

---

## §1.2 — C3 : `strategy` mode contourne `pickBestEdgeBucket`

**Référence audit** : C3
**Fichiers** : `packages/backtest/src/adapters/weather/weather-adapter.ts:519`, `clocked-weather-strategy.ts:37-39`, `adapter-warnings.ts:40-63`

### Problème
`strategy` mode appelle `evaluateAt` (→ `inner.evaluate`), jamais `evaluateGroup`. Le live choisit le meilleur bucket d'edge ; le backtest évalue chaque bucket isolément → sur-entrées.

### Patch
**Option A (recommandée) — Avertissement explicite + documentation** :
1. Dans `emitStaticFidelityWarnings` (`adapter-warnings.ts:40`), ajouter un warning conditionnel : si `ctx.params.backtestExecutionMode === 'strategy'`, émettre `strategy_mode_no_group_selection` avec message `"strategy mode évalue les buckets isolément (pas de pickBestEdgeBucket) — préférer runner-sim pour fidélité live"`.
2. Documenter dans `docs/backtest.md` que `runner-sim` est le mode fidèle et `strategy` est legacy.
3. Dans `LaunchBacktestForm.tsx`, ajouter un tooltip/avertissement côté UI sur le sélecteur `executionMode`.

**Option B (plus invasive) — Déprécier `strategy` mode** :
1. Marquer `strategy` comme `@deprecated` dans `params.ts`.
2. Forcer `runner-sim` par défaut.
3. Lever une erreur de validation si `strategy` est sélectionné.

### Décision recommandée** : Option A (non-cassant, transparent).

⚠️ **Note** : Ne pas changer le code de `strategy` mode — c'est un mode legacy intentionnel. Le fix est purement un avertissement + documentation. Aucune modification de sémantique.

### Tests
- `weather-adapter.test.ts` : vérifier que le warning `strategy_mode_no_group_selection` est émis en `strategy` mode et absent en `runner-sim`.

---

## §1.3 — C4 : Isolation multi-utilisateur (IDOR)

**Référence audit** : C4
**Fichiers** : `packages/backend/src/routes/backtest.ts` (tous les endpoints), `packages/core/src/services/backtest-run.service.ts`, entité `BacktestRun`

### Problème
Aucun endpoint ne filtre par `req.user.userId`. Tous les utilisateurs voient/modifient les runs de tout le monde.

### Patch
1. **Ajouter `userId` à l'entité `BacktestRun`** (migration) :
   ```typescript
   @Column({ type: 'integer', nullable: true })
   userId: number | null;
   ```
   Migration `AddBacktestRunUserId1700000000120.ts`.
2. **`POST /runs`** (`backtest.ts:78`) : peupler `userId: req.user!.userId` dans `service.create`.
3. **`GET /runs`** (`:141`) : filtrer `service.list({ ..., userId: req.user!.userId })`.
4. **`GET /runs/:id`, cancel, delete, positions, equity, excluded-ticks, markets-series** : filtrer par `userId` — si le run n'appartient pas à l'utilisateur, retourner 404 (ne pas leak l'existence).
5. **`BacktestRunService`** : ajouter `userId` aux méthodes `list`, `getById`, `hasActiveRun`, `delete`. `getById` prend un `userId` optionnel et filtre.
6. **`hasActiveRun`** (`backtest-run.service.ts:309`) : `where: { domain, userId, status: In(...) }` → le lock singleton devient **par utilisateur**.
7. **Compatibilité** : `userId` nullable pour les runs existants (pre-migration). Les anciens runs ont `userId = null` → décider avec l'utilisateur : soit les rendre visibles à tous (rétro-compatibilité), soit les assigner à un admin, soit les exclure des listes. **Recommandation** : les anciens runs restent visibles à tous jusqu'à suppression (filtre `userId = req.user.userId OR userId IS NULL`), avec un warning côté frontend « run hérité (sans propriétaire) ».

### Tests
- `backtest.routes.test.ts` (nouveau) : deux utilisateurs, vérifier que user A ne voit pas les runs de user B, ne peut pas cancel/delete.
- Vérifier que le lock singleton est par-utilisateur (deux users peuvent lancer en parallèle).
- Vérifier qu'un run hérité (`userId = null`) reste visible par tous.

---

## §1.4 — C5 : Lock singleton non-atomique (TOCTOU)

**Référence audit** : C5
**Fichiers** : `packages/backend/src/routes/backtest.ts:100-115`, `packages/core/src/services/backtest-run.service.ts:309-314`

### Problème
`hasActiveRun` puis `create` avec `await` entre les deux → race TOCTOU.

### Patch
**Option A — Contrainte unique DB** (recommandée) :
1. Migration ajoutant un index partiel unique. ⚠️ La condition exacte dépend de §1.3 : si `userId` est nullable, l'index doit gérer les NULLs. PostgreSQL : `NULL` sont distincts dans un index unique → deux runs `userId=NULL` ne se collisionnent pas. Pour les runs hérités, c'est acceptable. Pour les nouveaux runs (`userId` not null), la contrainte s'applique :
   ```sql
   CREATE UNIQUE INDEX backtest_run_active_unique
     ON backtest_runs(domain, user_id)
     WHERE status IN ('running', 'queued');
   ```
2. `service.create` tente l'INSERT ; si violation de contrainte unique → catch `QueryFailedError` (code `23505`) et retourner 409 `run_already_active` avec le `runId` de l'actif (re-fetch via `hasActiveRun`).
3. **Garder le `hasActiveRun` pré-check** comme fast-path pour un message d'erreur clair (évite l'exception dans le cas courant), mais l'INSERT est la source de vérité.
4. ⚠️ **Cohérence avec §1.3** : `hasActiveRun` filtre par `userId` (§1.3 patch 6). L'index unique inclut `user_id`. Les deux sont alignés.

**Option B — Transaction + SELECT FOR UPDATE** :
1. `ds.transaction(async (em) => { const active = await em.findOne(..., { lock: 'pessimistic_write' }); ... })`.
⚠️ Moins robuste cross-process (le lock est libéré à la fin de la transaction, mais si l'INSERT échoue, il faut rollback). Option A préférée.

**Décision recommandée** : Option A (plus simple, plus robuste cross-process).

### Tests
- `backtest.routes.test.ts` : lancer 2 POST `/runs` simultanés (Promise.all) → un seul réussit, l'autre 409.

---

## §1.5 — C6/M18 : Cache + pagination DB sur `/markets-series`

**Référence audit** : C6, M18
**Fichiers** : `packages/backend/src/routes/backtest.ts:262-428` (`/markets-series`) ET `:440-610` (`/runs/:id/markets-series`)

### Problème
Full-scan `allMarkets` + slice mémoire, pas de cache, re-fetch chaque seconde côté frontend. ⚠️ **Deux endpoints affectés** : `/markets-series` (ridge live, ligne 262) ET `/runs/:id/markets-series` (ridge par run, ligne 440) ont le même pattern de `getRawMany` complet + `allMarkets.slice(offset, offset+limit)`.

### Patch
1. **Cursor DB** : remplacer `allMarkets.slice(offset, offset+limit)` par `LIMIT/OFFSET` SQL dans le `marketQb` (`backtest.ts:310`). Ajouter `.skip(offset).take(limit)` (TypeORM QueryBuilder) sur le `marketQb` au lieu de charger `allMarkets` en entier.
   ⚠️ **Subtilité** : le `total` doit venir d'un `COUNT(*)` séparé (sans charger les rows), car `.skip/.take` ne retourne pas le total. Ajouter une requête `getCount()` avant la pagination.
   ⚠️ **Performance** : `.skip/.take` sur QueryBuilder génère `LIMIT/OFFSET` — acceptable pour offset < 10 000. Pour des offsets très grands, un cursor keyset (sur `MIN(t.recordedAt)`) serait mieux, mais complexe à coder. Pour l'usage actuel (ridge plot, offset rarement > 500), `LIMIT/OFFSET` suffit.
2. **Cache court-terme** : ajouter un cache LRU (ou simple `Map`) côté backend, clé `fidelityMinutes`, TTL 30 s. Le `window` (MIN/MAX) est stable → cacheable.
   ⚠️ **Invalidation** : si de nouveaux ticks sont ingérés pendant le TTL, le cache est stale. Acceptable pour le ridge plot (décoratif). Documenter.
3. **Comptage séparé** : le `total` vient d'un `getCount()` (TypeORM), également caché.
4. **Frontend** : `livePolling` passe à 10 s (au lieu de 1 s) pour le ridge live, et le backend cache à 30 s → 1 miss cache toutes les 3 polls. Voir §1.7.
5. ⚠️ **Borne `total` cohérente** : le `truncated` doit être `total > offset + limit`, pas `allMarkets.length > offset + limit` (qui n'a plus de sens après le passage au cursor DB).
6. ⚠️ **Appliquer aux DEUX endpoints** : `/markets-series` (ligne 262) ET `/runs/:id/markets-series` (ligne 440) ont le même pattern. Le cache côté backend est surtout utile pour `/markets-series` (ridge live pollé toutes les 10 s) ; pour `/runs/:id/markets-series` ( Ridge par run, peu re-pollé) le cache est optionnel mais la pagination DB s'applique.

### Tests
- `backtest.routes.test.ts` : vérifier que `limit` est respecté, que `total` est correct (via `getCount`), que 2 requêtes consécutives hit le cache (mesurer le temps de réponse ou mocker le repo).

---

## §1.6 — C7 : Boucles de pagination frontend non bornées

**Référence audit** : C7
**Fichiers** : `packages/frontend/src/components/WeatherAlgoBacktestTab.tsx:126-137, 202-211`

### Problème
Boucles `for(;;)` qui concatènent des pages sans borne ; risque de boucle infinie si `total` croît.

### Patch
1. **Borne hardcodée** : `MAX_PAGES = 50` (50 × 500 = 25 000 marchés max). Au-delà, tronquer avec un warning.
2. **Détection de croissance** : si `res.total > total` entre pages (le total backend croît pendant la pagination, signe d'ingestion live), abort et afficher un warning "données en cours d'ingestion, réessayez".
3. **Boucle bornée** :
   ```typescript
   const MAX_PAGES = 50;
   let grew = false;
   for (let p = 0; p < MAX_PAGES; p++) {
     const res = await fetchLiveMarketSeries({ offset, limit: MARKETS_PAGE_SIZE });
     if (p > 0 && res.total > total) {
       // Le total backend a cru pendant la pagination : abort pour éviter boucle infinie.
       grew = true;
       break;
     }
     items.push(...res.items);
     total = res.total;
     offset += res.items.length;
     if (offset >= total || res.items.length === 0) break;
   }
   if (grew) {
     setLiveError('Données en cours d\'ingestion (total instable) — réessayez');
   } else if (offset < total) {
     setLiveError('Troncation: trop de marchés (max 25 000)');
   }
   ```
   ⚠️ **Subtilité** : la comparaison `res.total > total` doit se faire **avant** `total = res.total`. Le code ci-dessus est correct (`p > 0` évite la comparaison à la première page où `total` est encore l'initialisation).
4. **Appliquer aux deux boucles** (`refreshLiveSeries` ligne 126, `refreshDetail` ligne 202).

### Tests
- Test frontend (vitest) : mocker `fetchLiveMarketSeries` avec un `total` croissant (page 1: total=1000, page 2: total=1100) → vérifier que la boucle abort après la page 2 avec l'erreur "Données en cours d'ingestion".
- Test frontend : `total` stable mais > 25 000 → vérifier `MAX_PAGES` borne la boucle et `setLiveError('Troncation...')`.

---

## §1.7 — C8 : Pollers sans garde anti-réentrance ni AbortController

**Référence audit** : C8
**Fichiers** : `packages/frontend/src/components/backtest/useBacktestPolling.ts`, `WeatherAlgoBacktestTab.tsx:107-115`

### Problème
Pollers 1 s sans vérifier si un fetch est en vol → storm + races.

### Patch
1. **Garde anti-réentrance dans `useBacktestPolling`** :
   ```typescript
   let inFlight = false;
   async function tick() {
     if (isPaused() || inFlight) return;
     inFlight = true;
     try { await onTick(); } finally { inFlight = false; }
   }
   ```
   Note : `onTick` doit retourner une `Promise`. Adapter la signature de `useBacktestPolling` (`onTick: () => Promise<void>`) ET les deux appelants dans `WeatherAlgoBacktestTab.tsx:107,113` :
   ```typescript
   // Avant : () => { void refreshDetail(id); void refreshList(); }
   // Après : async () => { await Promise.all([refreshDetail(id), refreshList()]); }
   ```
   ⚠️ Sans cette modification des appelants, le `await onTick()` ne wait rien (Promise déjà résolue via `void`).
2. **AbortController par run** : dans `WeatherAlgoBacktestTab`, créer un `AbortController` par `openRun`/`refreshDetail`, l'annuler sur `closeRun`/`openRun` suivant. Passer le `signal` aux `fetchBacktest*`.
3. **`livePolling` à 10 s** au lieu de 1 s (ridge live n'a pas besoin de fraîcheur 1 s).
4. **`polling` (détail) à 2 s** (compromis réactivité/storm).

### Tests
- Test `useBacktestPolling` : mocker `onTick` lent (2 s) avec intervalle 1 s → vérifier qu'il n'est appelé qu'une fois à la fois (pas de stack).

---

## §1.8 — C9 : Tests critiques manquants + CI

**Référence audit** : C9
**Fichiers** : nouveaux fichiers de test + `.github/workflows/ci.yml`

### Patch
1. **`packages/backtest/src/engine/fill-engine.test.ts`** (nouveau) :
   - slippage non-nul (50 bps) → vérifier `entryPrice = yesPrice * 1.005`, `exitPrice = yesPrice * 0.995`.
   - slippage 0 → `entryPrice = yesPrice`.
   - `maxPositionSizeUsdc` < `entryUsdc` → `qty` plafonné.
   - `yesPrice = 1.0` + slippage 200 bps → `entryPrice > 1` (documenter le comportement, pas de clamping encore).
   - fees avec `feeExponent = 2` (param custom) → vérifier la courbe.
2. **`packages/backtest/src/adapters/weather/data-loader.test.ts`** (nouveau) :
   - pagination keyset (offset/limit, bornes, fidélité).
3. **`packages/backtest/src/engine/runner.test.ts`** (nouveau) :
   - abort mid-event, cancel, timeout.
4. **`packages/backend/src/routes/backtest.test.ts`** (nouveau) :
   - validation params, lock race, cancel, delete cascade, IDOR (§1.3).
5. **Golden snapshot** : `packages/backtest/src/__snapshots__/golden-run-2026-08.json` + test `golden-replay.test.ts` qui rejoue un run historique connu et compare les stats. Régénérer le snapshot avec le moteur actuel, puis le figer.
6. **CI** : `.github/workflows/ci.yml` — `npm ci && npm run build && npm test` sur Node 20.

### Tests
- Les tests ci-dessus sont eux-mêmes les livrables.

---

## §1.9 — M1/M7 : Clamping prix [0,1] + résolution sur fallback

**Référence audit** : M1, M7
**Fichiers** : `packages/backtest/src/engine/fill-engine.ts:30,49`, `weather-adapter.ts:628`

### Problème
Slippage peut pousser le prix hors [0,1] → fees mis à 0. Fallback `entryPrice` dans `tryResolveByPrice` peut résoudre à tort.

### Patch
1. **Clamping dans `fill-engine.ts`** :
   ```typescript
   const entryPrice = Math.min(1, input.yesPrice * (1 + input.slippageBps / 10_000));
   const exitPrice = Math.max(0, input.yesPrice * (1 - input.slippageBps / 10_000));
   ```
   ⚠️ **Conséquence** : une entrée clamped à 1.0 paie quand même des fees (car `curve = 1*(1-1) = 0` → fees = 0). C'est cohérent avec le comportement Polymarket (un fill à 1.0 n'a pas de spread, donc pas de fees). Documenter. Le clamping empêche surtout `entryPrice > 1` qui rendrait la position immédiatement perdante de façon irréaliste.
2. **`tryResolveByPrice`** (`weather-adapter.ts:628`) : retirer le fallback `entryPrice` (garder seulement `tick.yesPrice ?? pos.markPrice`). Si aucun prix, retourner `false` (déjà fait lignes 629-636) — supprimer la branche `?? pos.entryPrice`.
   ⚠️ **Test d'impact** : vérifier que les tests existants `weather-adapter.test.ts:545-733` (résolution par fallback) ne cassent pas. Le fallback `markPrice` est conservé (marché sans tick mais avec mark précédent), seul `entryPrice` est retiré. Mettre à jour le test `resolution_by_entryPrice_fallback` si il existe → il doit soit être supprimé, soit converti en `resolution_by_markPrice_fallback`.
3. **Warning si clamping actif** : si `input.yesPrice * (1 + slippage/10_000) > 1` (entry) ou `< 0` (exit), émettre `fill_price_clamped` via l'adapter (pas dans `fill-engine` qui n'a pas accès à `ctx`). L'adapter peut wrapper le fill et vérifier a posteriori.

### Tests
- `fill-engine.test.ts` : `yesPrice=0.999, slippage=200` → `entryPrice=1` (clamped), pas d'erreur. Vérifier les fees (curve=0 → fees=0).
- `fill-engine.test.ts` : `yesPrice=0.001, slippage=200` → `exitPrice=0` (clamped).
- `weather-adapter.test.ts` : vérifier que `tryResolveByPrice` sans `tick.yesPrice` et sans `markPrice` retourne `false` (plus de fallback `entryPrice`).

---

## §1.10 — M2 : Fees de résolution

**Référence audit** : M2
**Fichiers** : `weather-adapter.ts:670` (résolution), `:116` (ghost-close)

### Problème
Résolutions et ghost-closes à `fees: 0` alors que les autres exits appliquent des fees.

### Patch
1. **`tryResolveByPrice`** : appliquer `simulateWeatherExitFill` à `exitPrice=1` (YES) ou `0` (NO) :
   ```typescript
   const { fees } = simulateWeatherExitFill({
     qty: pos.qty,
     yesPrice: winningOutcome === 'YES' ? 1 : 0,
     slippageBps: 0, // résolution = pas de slippage (prix de settlement)
   });
   ctx.ledger.closePosition({ ..., fees });
   ```
   ⚠️ **Vérification fees à yesPrice=1 ou 0** : `computeTakerFee(qty, 1, BACKTEST_PLATFORM_FEE)` → `curve = 1*(1-1) = 0` → **fees = 0**. Idem à `yesPrice=0` → `curve = 0` → fees = 0. Donc **les fees de résolution restent à 0** même après ce patch, car la courbe de fee Polymarket est nulle aux extrêmes. Le patch aligne le **chemin** (passe par `simulateWeatherExitFill`) mais le **résultat** est identique (fees=0).
   ⚠️ **Conséquence** : ce patch est en fait **cosmétique** — il unifie le code path mais ne change pas le PnL. **Rétrograder en nit** sauf si on veut appliquer des fees de settlement forfaitaires (différents de la courbe taker). Vérifier avec l'utilisateur si Polymarket charge des fees de settlement. Si non, **supprimer ce patch** (M2 n'est pas un bug réel).
2. **`finish` ghost-close** (`:116`) : même logique, `simulateWeatherExitFill` avec `yesPrice: exitPrice`, `slippageBps: 0`. Même conclusion — fees=0 aux extrêmes.

### Décision révisée
⚠️ **M2 est à reclassifier en nit cosmétique** : les fees de résolution sont déjà 0 car la courbe Polymarket est nulle aux prix 0/1. Le patch unifie le code path mais ne change pas le PnL. **Recommandation** : appliquer pour cohérence de code, mais ne pas bumper `engineVersion` pour ce seul changement. Documenter.

### Tests
- `weather-adapter.test.ts` : vérifier que les résolutions passent par `simulateWeatherExitFill` (test structurel) et que les fees sont 0 aux extrêmes (comportement inchangé).

### Bump
`engine-version.ts` : `0.6.0` (déjà bumpé en §1.1).

---

## §1.11 — M3/M4 : Garde d'exposition cohérente

**Référence audit** : M3, M4
**Fichiers** : `weather-adapter.ts:184-214`, `ledger.ts:72-82`

### Problème
`canEnter` utilise `entryUsdc` non plafonné et pré-slippage ; `openExposure` est post-slippage.

### Patch
1. **`canEnter`** : utiliser le même calcul que `simulateWeatherEntryFill` :
   ```typescript
   const cappedUsdc = Math.min(entryUsdc, bag.maxPositionSizeUsdc ?? Infinity);
   const entryPrice = yesPrice * (1 + slippage / 10_000);
   const qty = cappedUsdc / entryPrice;
   const estFees = computeTakerFee(qty, entryPrice, BACKTEST_PLATFORM_FEE);
   const cost = cappedUsdc + estFees;
   if (ctx.ledger.cash < cost) return false;
   if (maxExposure != null && ctx.ledger.openExposure(strategyId) + cappedUsdc > maxExposure) return false;
   ```
2. **`openExposure`** (`ledger.ts:79`) : documenter que c'est le notionnel post-slippage. Comparer à `cappedUsdc` (post-slippage) dans `canEnter` — cohérent.

### Tests
- `weather-adapter.test.ts` : `maxPositionSizeUsdc < entryUsdc` → vérifier que l'entry passe (pas rejetée par exposure), et que l'exposition ajoutée = `cappedUsdc`.

---

## §1.12 — M9 : Cibles fractionnaires (question-builder)

**Référence audit** : M9
**Fichiers** : `packages/backtest/src/adapters/weather/question-builder.ts:37-40`, `packages/core/src/weather/question-parser.ts`

### Problème
`Math.round(bucketTarget)` décale le seuil jusqu'à 0.5 °C.

### Patch
1. **Étendre les regex de `parseWeatherQuestion`** (`question-parser.ts`) pour accepter les décimales :
   - `HIGHEST_TEMP_REGEX_OR` : `(-?\d+)` → `(-?\d+(?:\.\d+)?)`
   - `HIGHEST_TEMP_REGEX_BETWEEN` : `(-?\d+)-(-?\d+)` → `(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)`
   - Idem pour `LOWEST_TEMP_*`.
   ⚠️ **Subtilité regex** : dans le pattern `between X-Y°`, le `-` entre X et Y est le séparateur. Si X est négatif (`-5-10°`), le regex `-?\d+(?:\.\d+)?-(-?\d+(?:\.\d+)?)` doit matcher `-5-10`. Le `-?` initial gère le signe de X, puis le `-` littéral sépare, puis `-?` gère le signe de Y. Vérifier avec des tests regex.
2. **`buildOrResult` / `buildBetweenResult`** (`question-parser.ts:37-75`) : remplacer `parseInt(match[2]!, 10)` par `parseFloat(match[2]!)`. ⚠️ `parseFloat` ne tronque pas les décimales. `fToC` utilise déjà `Math.round(...*10)/10` (1 décimale) — cohérent.
3. **`buildWeatherQuestion`** (`question-builder.ts:37-40`) : supprimer le `Math.round`, utiliser la valeur brute formatée. Pour les décimales, formatter proprement (pas de `0.5` → `0.5000`) :
   ```typescript
   const fmt = (n: number | null): string | null => {
     if (n == null) return null;
     return Number.isInteger(n) ? String(n) : String(n);
   };
   ```
   ⚠️ **Edge case** : un `bucketTarget = 12.0` (float mais entier en valeur) doit s'afficher `12` pas `12.0`. `Number.isInteger(12.0)` → true → `"12"`. OK.
4. **Warning si cible fractionnaire** : émettre `bucket_target_fractional` (informatif) si `bucketTarget` n'est pas entier.

⚠️ **Test d'impact** : les questions live réelles peuvent déjà contenir des entiers. Le regex étendu reste rétro-compatible (les entiers matchent `\d+(?:\.\d+)?`). Vérifier que les tests existants `question-parser.test.ts` passent.

### Tests
- `question-builder.test.ts` (nouveau) : `bucketTarget=12.5` → question contient `12.5`, `parseWeatherQuestion` récupère `12.5`.
- `question-parser.test.ts` (existant) : ajouter `12.5°C or below`, `-5.5-10.5°C between`.
- `question-parser.test.ts` : vérifier que les entiers existants matchent toujours (`12°C` → `12`).

---

## §1.13 — M11/M12 : Avertissements de fidélité complémentaires

**Référence audit** : M11, M12 (déjà documentés), C3 (§1.2)
**Fichiers** : `adapter-warnings.ts`

### Patch
1. Ajouter `strategy_mode_no_group_selection` (§1.2).
2. Ajouter `multi_position_stale_mark` (§1.1).
3. Les warnings M11 (`risk_sl_confirmation_ignored`) et M12 (`fill_no_book_depth`) existent déjà — pas de fix code, juste documentation dans `docs/backtest.md`.

---

## §1.14 — M14/M15/M16 : Validation frontend + timezone + selectedId

**Référence audit** : M14, M15, M16
**Fichiers** : `WeatherAlgoBacktestTab.tsx:261-301`, `backtest/format.ts`

### Problème
Pas de validation numérique, timezone off-by-one, `selectedId` persisté stale.

### Patch
1. **Validation numérique** (`submit`, lignes 261-301) :
   ```typescript
   const cap = Number(capital());
   if (!Number.isFinite(cap) || cap <= 0) { setLaunchError('Capital invalide'); return; }
   const slip = Number(slippageBps());
   if (!Number.isFinite(slip) || slip < 0) { setLaunchError('Slippage invalide'); return; }
   // ... idem entryUsdc (> 0), maxPos (entier >= 1)
   ```
2. **Timezone** : ⚠️ **Ne pas passer à `T00:00:00` local** — le backend fait `new Date(params.from)` (`data-loader.ts:21`) qui interprète selon le timezone **du serveur Node**, non déterministe en multi-instance. **Garder le `Z` (UTC)** mais **documenter** que la date saisie est interprétée comme UTC. L'off-by-one perçu vient de l'interprétation UTC d'une date saisie en local — c'est une question de spec, pas un bug. **Action** : ajouter un label UI « dates en UTC » à côté des champs `from`/`to`, et documenter dans `docs/backtest.md`. **Ne pas changer le code de reconstruction**.
3. **`selectedId` stale** : dans `refreshDetail`, si 404 (run non trouvé), appeler `closeRun()` (nettoie `selectedId` et l'état du détail). ⚠️ **Vérification du format d'erreur** : la fonction `api()` (`api.ts:208-209`) lance `throw new Error(body.error ?? 'request_failed')` où `body.error` pour un 404 est `'not_found'` (d'après `backtest.ts:164` `res.status(404).json({ error: 'not_found' })`). Donc l'exception a `message === 'not_found'`, pas `'404'`. Détection correcte :
   ```typescript
   catch (err) {
     if (err instanceof Error && err.message === 'not_found') {
       closeRun(); // nettoie selectedId
       return;
     }
     setDetailError(err instanceof Error ? err.message : 'Détail indisponible');
   }
   ```

### Tests
- Test frontend : `submit` avec `capital='-100'` → `launchError` set, pas d'appel API.
- Test frontend : `refreshDetail` 404 → `selectedId` devient `null`, on retourne à la liste.

---

## §1.15 — m1/m2/m3/m4/m5/m6 : Mineurs (lot)

**Référence audit** : m1–m6
**Fichiers** : divers

### Patch (optionnel, lot)
- **m5 `stats.ts:17`** : ⚠️ **Bug dans le patch initial** : « retirer la garde `if (peak > 0)` » seul ne suffit pas — la formule `(peak - s.equity) / peak` divise par `peak` qui peut être ≤ 0 → division par zéro ou drawdown négatif. **Patch corrigé** : ne calculer le drawdown que si `peak > 0` (garder la garde), **mais** aussi tracker le drawdown absolu quand `peak <= 0` :
  ```typescript
  export function computeMaxDrawdown(equitySamples: EquitySample[]): number {
    let peak = -Infinity;
    let maxDd = 0;
    for (const s of equitySamples) {
      if (s.equity > peak) peak = s.equity;
      if (peak > 0) {
        const dd = (peak - s.equity) / peak;
        if (dd > maxDd) maxDd = dd;
      } else {
        // peak <= 0 : drawdown absolu (perte sèche), pas relatif
        const dd = peak - s.equity; // positif si s.equity < peak
        if (dd > maxDd) maxDd = dd;
      }
    }
    return maxDd;
  }
  ```
  ⚠️ **Sémantique mixte** : retourne un % quand `peak > 0`, un absolu quand `peak <= 0`. Pas idéal. **Alternative** : toujours retourner un absolu (pas de %) — mais ça change l'unité de `maxDrawdown` et casserait les consommateurs. **Recommandation** : garder la garde `peak > 0` (comportement actuel, documenté), et juste **documenter** que le drawdown n'est pas mesuré si l'equity passe négative. Rértogarder m5 en nit documentation.
- **m6 `stats.ts:46-51`** : `profitFactor` : `null` si `totalTrades === 0`, `Infinity` encodé comme `null` si all-wins, sinon le ratio. Documenter. ⚠️ Le code actuel fait déjà ça (`grossWin > 0 ? null : 0`). Juste documenter la sémantique.
- **m1, m2, m3, m4** : documentation uniquement dans `docs/backtest.md` (limitations de fidélité).

---

# Phase 2 — Nettoyage dead code

## §2.1 — Dead code identifié

**Référence audit** : n1, n2, m15 (dead `hasOpen`), `ClockedWeatherStrategy.evaluate` inutilisé

### Patch
1. **`ledger.ts:51-53`** : supprimer `hasOpen` (doublon de `isDuplicateOpen`). Vérifier qu'aucun appelant n'existe (grep `hasOpen` dans tout le repo). ⚠️ Vérifier aussi `packages/backtest/src` ET `packages/backend`, `packages/frontend`.
2. **`clocked-weather-strategy.ts:41-47`** : ⚠️ **Ne pas supprimer `evaluate`** — l'interface `WeatherStrategy` (`packages/weather-algo/src/strategy/strategy.ts:49`) l'exige. Le garder. C'est du code mort **par usage adapter** mais **vivant par contrat d'interface**. Option : ajouter un commentaire `// Required by WeatherStrategy interface; backtest uses evaluateAt/evaluateGroup only.` pour documenter.
3. **`equityAt(_now)`** (`ledger.ts:192`) : ⚠️ **Ne pas supprimer le paramètre** — `runner.ts:188` appelle `equityAt(clock.now())`. Le paramètre est ignoré dans l'implémentation mais utilisé à l'appel. Soit le supprimer partout (signature + appel), soit le documenter `@param _now unused (marks are kept current separately)`. Recommandé : garder tel quel avec un commentaire.
4. **Casts `as never`** dans les tests (`runner-sim.test.ts:41,62,106`) : remplacer par des factories typées. Non-bloquant, nit.

### Tests
- `npm run build` doit passer (vérifier que les suppressions ne cassent pas l'interface).
- `npm test` doit passer.

---

# Phase 3 — Vérification finale

## §3.1 — Build et tests

1. `npm run build` à la racine — vérifier que tous les packages compilent (`packages/backtest`, `packages/backend`, `packages/frontend`, `packages/core`).
2. `npm test` — tous les tests passent, y compris les nouveaux (§1.8).
3. `npm run lint` (si configuré) — pas de nouveaux warnings.

## §3.2 — Revue croisée des fixes

Pour chaque finding fixé, vérifier :
1. Le code du patch adresse bien le finding (relire le diff).
2. Le test ajouté échoue **sans** le patch (test valide) et passe **avec** (fix correct).
3. Pas de régression : les tests existants passent.
4. Le `engineVersion` est bumpé si la sémantique de replay change (§1.1, §1.9, §1.10).

Checklist de revue (un commit par ligne) :
- [x] §1.1 C1/C2/M6 — marks périmés (warning + doc, pas de changement de PnL)
- [x] §1.2 C3 — warning strategy mode
- [x] §1.3 C4 — userId + IDOR + rétro-compatibilité runs hérités
- [x] §1.4 C5 — contrainte unique DB (cohérente avec userId §1.3)
- [x] §1.5 C6 — cache + pagination DB (cursor LIMIT/OFFSET + getCount)
- [x] §1.6 C7 — boucles bornées (MAX_PAGES)
- [x] §1.7 C8 — garde anti-réentrance + AbortController
- [x] §1.8 C9 — tests + CI
- [x] §1.9 M1/M7 — clamping [0,1] + retrait fallback entryPrice (vérifier tests existants)
- [x] §1.10 M2 — cosmétique uniquement (fees=0 aux extrêmes, pas de changement de PnL)
- [x] §1.11 M3/M4 — garde d'exposition cappedUsdc
- [x] §1.12 M9 — cibles fractionnaires (regex + parseFloat, rétro-compatible)
- [x] §1.13 M11/M12 — warnings (doc)
- [x] §1.14 M14/M15/M16 — validation frontend (timezone UTC préservé, pas de passage en local)
- [x] §1.15 m5/m6 — stats (m5 rétrogradé en doc, m6 doc)
- [x] §2.1 — dead code (hasOpen seulement ; evaluate conservé par contrat interface)
- [x] §3.1 — build + tests verts
- [x] §3.2 — revue croisée
- [x] §3.3 — golden snapshot (vérifier impact §1.9 clamping sur PnL)

## §3.3 — Golden snapshot

1. Lancer le moteur sur un run historique connu (dataset figé dans `packages/backtest/src/__snapshots__/golden-run-2026-08.json`).
2. Comparer `totalPnl`, `winRate`, `maxDrawdown`, `totalTrades`, `byExitReason` avec le snapshot.
3. Si mismatch → investiguer (soit le fix a changé la sémantique intentionnellement → mettre à jour le snapshot avec un commentaire, soit régression).

## §3.4 — Documentation

1. Mettre à jour `docs/backtest.md` :
   - Section "Limitations de fidélité" : lister M11, M12, C1/C2 (marks lag-1), C3 (strategy mode).
   - Section "Engine versioning" : expliquer le bump `0.6.0`.
2. Mettre à jour `docs/code/09-backtest.md` si nécessaire.
3. Lier ce plan et l'audit dans `docs/audits/2026-08-23_audit-weather-backtest-complet.md`.

---

## 📊 Écarts / décisions finales (post-implémentation)

Cette section documente les points où le code livré diverge du plan d'origine. Chaque écart est volontaire ou correspond à une simplification assumée.

| Section | Plan d'origine | Réalité livrée |
|---|---|---|
| §1.3 / §1.4 | Migration nommée `AddBacktestRunUserId1700000000120.ts` | Migration fusionnée **`AddBacktestRunUserIdAndActiveUnique1700000000119.ts`** : ajoute `user_id` + index `idx_btr_user_id` + index partiel unique `backtest_run_active_unique` en un seul fichier. |
| §1.5 | Cache du `total` **et** de la liste complète des marchés | Le cache (`cachedMarketsSeries`, TTL 30 s) ne porte que la **fenêtre [MIN,MAX] + le count `total`**. La **page** est lue en `LIMIT/OFFSET` SQL via le helper `buildMarketsQuery(...).skip().take()` + `countMarketWindow`. Renommage : `loadMarketWindow` initial → `countMarketWindow` (retourne un `number`). |
| §1.5 | Helper de requête dédupliqué côté backend | Un seul helper partagé `buildMarketsQuery(ds, opts)` pour les **deux** endpoints `/markets-series` et `/runs/:id/markets-series` (au lieu de deux requêtes GROUP BY dupliquées). |
| §1.7 | `polling` (détail) passé à **2 s** | Resté à **`POLL_MS = 1000`** (défaut). Seul `livePolling` est passé à 10 s. Écart volontaire : la garde anti-réentrance + AbortController rendent le 1 s sûr, la réactivité est meilleure. |
| §1.8 | `packages/backend/src/routes/backtest.test.ts` (nouveau) | **Non créé**. La couverture IDOR / lock singleton / cascade a été portée dans `packages/core/src/services/backtest-run.service.test.ts` (niveau service, plus stable que les routes). |
| §1.8 | Golden snapshot fichier JSON figé `golden-run-2026-08.json` | Snapshot Vitest généré : `__snapshots__/golden-replay.test.ts.snap` (stats + `engineVersion`), rejoué sur un scénario seedé en mémoire (pas de dépendance à un fichier externe). |
| §1.9 | Warning `fill_price_clamped` | Initialement branché uniquement sur les entrées ; l'implémentation branche aussi la **branche de sortie** (`isEntry=false`) sur les 3 chemins de sortie (kill-switch, SL/TP/trailing, drift/bucket). La branche de sortie du plan était restée morte ; elle est désormais vivante. |
| §1.10 | Fees de résolution — cosmétique | Appliqué : résolution et ghost-close passent par `simulateWeatherExitFill` avec `slippageBps: 0`. PnL inchangé (courbe Polymarket nulle à 0/1). |
| §1.15 | m5 : garde `peak > 0` conservée + doc | Rétrogradé en documentation uniquement (pas de changement de code `stats.ts`). La sémantique `maxDrawdown`/`profitFactor` est documentée dans `docs/backtest.md` §9.1. |
| Bonus | — | **Test backend pré-existant corrigé** : `config.sim-execution.test.ts` référençait des champs inexistants (`cryptoAlgoTrailingActivationPercent`/`cryptoAlgoTrailingStopPercent`) → alignés sur le schéma réel (`...BidPoints`). Sans cette correction, la CI restait rouge. |

---

## 📊 Ordre d'exécution recommandé

| Ordre | Section | Finding | Effort | Risque |
|---|---|---|---|---|
| 1 | §1.1 | C1/C2/M6 (warning + doc) | S | Faible (pas de changement PnL) |
| 2 | §1.9 | M1/M7 | S | Faible (vérifier tests fallback) |
| 3 | §1.10 | M2 (cosmétique) | S | Faible (PnL inchangé) |
| 4 | §1.11 | M3/M4 | S | Faible |
| 5 | §1.12 | M9 | S | Faible (rétro-compatible) |
| 6 | §1.2 | C3 | S | Faible (warning) |
| 7 | §1.3 | C4 | M | Élevé (migration + rétro-compat) |
| 8 | §1.4 | C5 | S | Moyen (migration, cohérent avec §1.3) |
| 9 | §1.5 | C6 | M | Moyen (cursor + cache) |
| 10 | §1.6 | C7 | S | Faible |
| 11 | §1.7 | C8 | S | Faible |
| 12 | §1.14 | M14/M15/M16 | S | Faible (timezone UTC préservé) |
| 13 | §1.8 | C9 | L | Faible (tests) |
| 14 | §1.13/§1.15 | M11/M12/m5/m6 | S | Faible (doc) |
| 15 | §2.1 | dead code (hasOpen seul) | S | Faible |
| 16 | §3 | vérification | M | — |

**Effort** : S = petit (< 1 h), M = moyen (1–4 h), L = large (> 4 h).
**Total estimé** : ~2–3 jours-homme.

---

## 🔗 Références

- Audit : [`docs/audits/2026-08-23_audit-weather-backtest-complet.md`](../audits/2026-08-23_audit-weather-backtest-complet.md)
- Audit précédent résolu : [`docs/audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md`](../audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md)
- Plan précédent appliqué : [`docs/plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md`](applied/2026-08-18_PLAN-fix-weather-backtest-audit.md)
- Doc backtest : [`docs/backtest.md`](../backtest.md)