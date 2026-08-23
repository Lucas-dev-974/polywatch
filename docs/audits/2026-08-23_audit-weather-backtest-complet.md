# Audit complet du Weather Backtest — vérification point par point

**Date** : 2026-08-23
**Auteur** : Assistant IA (audit en 5 couches + vérification manuelle de chaque finding contre le code)
**Statut** : 🔴 **Audit de découverte** — findings priorisés, corrections non appliquées
**Périmètre** : `packages/backtest/src/**`, `packages/backend/src/routes/backtest.ts`, `packages/frontend/src/components/backtest/**` + `WeatherAlgoBacktestTab.tsx`, tests associés, et dépendances `packages/core`, `packages/weather-algo` nécessaires à la compréhension.

---

## 📋 Méthodologie

Cet audit a été produit en deux temps :

1. **Découverte en parallèle** — 5 sous-agents d'exploration ont audité indépendamment chaque couche (moteur, adaptateur weather, routes backend, frontend, tests).
2. **Vérification manuelle** — chaque finding a été re-vrit contre le code source réel. Plusieurs findings initiaux ont été **réfutés** ou **nuancés** (notamment M5, M10, E5, M8). Les corrections sont signalées par ✅ CORRIGÉ / ⚠️ NUANCÉ / ❌ RÉFUTÉ dans le texte.

Les file:line sont absolus et 1-indexés.

---

## 🏗️ Architecture (vérifiée)

Le backtest weather est un moteur événementiel de replay historique en 5 couches :

1. **Moteur** (`packages/backtest/src/engine/`) — `virtual-clock.ts` (horloge déterministe), `events.ts` (union discriminée `book_tick|forecast|signal`), `merge-event-streams.ts` (fusion k-way par tas binaire, tie-break `streamId` puis `seq`), `fill-engine.ts` (simulation de fill + slippage + fees constants), `ledger.ts` (cash + positions + mark-to-market), `exit-manager.ts` (drift/bucket + SL/TP/trailing + throttle ré-entrée), `stats.ts`, `runner.ts` (boucle principale, flush périodique, abort), `engine-version.ts` (`0.5.0`).
2. **Adaptateur weather** (`packages/backtest/src/adapters/weather/`) — `WeatherBacktestAdapter` pont moteur↔stratégies live. Deux modes d'exécution : `strategy` (legacy, mono-bucket par tick) et `runner-sim` (groupe city/date, fidèle au live). Deux modes de replay : `reevaluate` (re-déclenche la stratégie) et `replay` (rejoue les `WeatherEvaluationLog`).
3. **Routes backend** (`packages/backend/src/routes/backtest.ts`, 633 lignes) — 11 endpoints HTTP, lock singleton global, exécution fire-and-forget.
4. **Frontend** (`packages/frontend/src/components/backtest/` + `WeatherAlgoBacktestTab.tsx`) — onglet SolidJS, 2 pollers 1 s, ridge plot live, formulaire, liste/détail.
5. **Tests** — `index.test.ts` (intégration pgmem), `exit-manager.test.ts`, `weather-adapter.test.ts`, `runner-sim.test.ts`, 2 e2e, 2 outils CLI.

**Flux** : `POST /runs` → row `queued` + `tracker.track` → `runBacktest` fire-and-forget → parse params + overrides config → `data-loader` stream `WeatherForecastHistory`/`WeatherBucketTick`/`WeatherEvaluationLog` → `mergeEventStreams` (tri timestamp + tie-break) → `BacktestRunner.run` consomme les events, délègue à `adapter.handle` → adapter évalue entrées/sorties via stratégies live + `Ledger` + `WeatherExitManager` → flush périodique equity/progress → persistance finale (positions, excluded ticks, stats).

---

## 🔴 Findings critiques

### C1 — Exits et marks évalués sur des ticks périmés pour les positions non-courantes

**Vérification** : ✅ **Confirmé**
**Localisation** : `packages/backtest/src/adapters/weather/weather-adapter.ts:697-719`, `packages/backtest/src/engine/ledger.ts:138-152`

`evaluateExits` itère toutes les positions ouvertes et lit le tick depuis `lastTickByCondition` (map `conditionId → {tick, at}`). Pour la position dont le tick vient d'arriver (le `book_tick` courant), la map a été rafraîchie à la ligne 455. Mais pour **toutes les autres positions ouvertes**, le tick lu est le dernier observé pour ce `conditionId` — potentiellement vieux de plusieurs polls. Le clock a avancé à l'heure de l'événement courant, mais l'exit est booked à `ctx.clock.now()` (lignes 741, 795) sur un prix périmé.

Conséquences observées :
- SL/TP/drift peuvent se déclencher sur un prix observé bien plus tôt, à l'heure virtuelle courante → **durée de holding et datation des trades incorrectes**.
- `updateMark` (ligne 708) n'est appelé que pour la position dont le tick arrive (via le `cached` lu à la ligne 699) ; le mark des autres positions n'est pas rafraichi.
- Le trailing stop (`peakClosurePnl`, `ledger.ts:147-149`) n'avance que sur le tick propre à chaque position → **trailing raté systématique en multi-position**.
- Le warning `exit_stale_tick` (lignes 685-695) est émis mais n'empêche pas la clôture sur prix périmé.

**Impact** : distorsion du PnL, du drawdown, du timing de sortie pour tout run multi-position. C'est le problème de fidélité le plus structurel.

### C2 — Marks gelés pour les positions sans tick ultérieur ; résolution fantôme sur mark périmé

**Vérification** : ✅ **Confirmé**
**Localisation** : `weather-adapter.ts:109-118` (ghost-close), `:616-683` (`tryResolveByPrice`)

- `markPrice` d'une position n'est mis à jour que via `updateMark`, appelé uniquement sur réception d'un `book_tick` pour ce `conditionId` (ligne 708, conditionnel à `yesPrice != null`). Pour un marché qui ne tick plus, le mark est gelé à la dernière valeur.
- `equityAt` (`ledger.ts:192-202`) valorise les positions ouvertes à `markPrice` gelé → equity curve trompeuse entre ticks.
- La résolution ne se fait que par seuil de prix (`yesPrice >= 0.99 → YES`, `<= 0.01 → NO`), jamais par observation météo. Un marché résolu YES dans la réalité mais dont le dernier tick est 0.95 devient un "ghost" force-close à la fin du run à `markPrice > 0 ? markPrice : entryPrice` (ligne 110).
- `tryResolveByPrice` fallback `tick.yesPrice ?? pos.markPrice ?? pos.entryPrice` (ligne 628) → si l'entryPrice est proche de 0.01 (entry NO-side, ou slippage qui pousse le prix sous 0.01 côté sortie), résolution à tort.

**Impact** : le backtest **sous-estime** systématiquement les résolutions gagnantes (marchés résolus mais ticks finaux < 0.99) et peut sur/sous-estimer les perdantes selon le mark final.

### C3 — `strategy` mode contourne la sélection de groupe live (`pickBestEdgeBucket`)

**Vérification** : ✅ **Confirmé**
**Localisation** : `weather-adapter.ts:519`, `clocked-weather-strategy.ts:37-39`

En mode `strategy`, `onBookTick` appelle `this.strategy.evaluateAt(market, ctxWeather, ctx.clock.now())` (ligne 519), qui route vers `inner.evaluate` (`clocked-weather-strategy.ts:38`), **jamais `evaluateGroup`**. Le live utilise `evaluateCityFollowDateGroup` (`strategy-runner.ts`) qui choisit le **meilleur bucket d'edge** pour la ville/date. Le backtest `strategy` évalue chaque bucket isolément au fil de l'eau → peut entrer sur un bucket que le live n'aurait jamais choisi (frère à meilleure edge).

**Impact** : **sur-entrées systématiques vs live**. Aucun avertissement de fidélité ne distingue `strategy` de `runner-sim` sur cet axe (les warnings statiques de `adapter-warnings.ts:40-63` ne le mentionnent pas).

⚠️ **NUANCÉ** : `runner-sim` mode appelle bien `evaluateRunnerSimGroup` (`weather-adapter.ts:437`) qui route vers `evaluateGroup` (`runner-sim.ts:110`) — ce mode est fidèle. Le problème est spécifique à `strategy` mode.

### C4 — Pas d'isolation par utilisateur / IDOR (single-tenant implicite)

**Vérification** : ✅ **Confirmé**
**Localisation** : `packages/backend/src/routes/backtest.ts` (zéro référence à `req.user`), `packages/backend/src/middleware/auth.ts:5-7`

Le middleware `requireJwt` peuple bien `req.user = { userId, username }` (`auth.ts:20`), mais **aucun** endpoint de `backtest.ts` ne filtre par `req.user.userId`. Tous les utilisateurs authentifiés voient, lancent, annulent et suppriment les runs de tout le monde. Le lock singleton est global (`hasActiveRun('weather')`, ligne 100), pas par utilisateur.

**Impact** : en multi-utilisateur, faille d'isolation critique (IDOR). En single-tenant (usage actuel présumé), c'est un risque latent.

### C5 — Lock singleton non-atomique (TOCTOU) sur le lancement

**Vérification** : ✅ **Confirmé**
**Localisation** : `backtest.ts:100-115`

```typescript
const active = await service.hasActiveRun('weather');  // SELECT ... status IN (running, queued)
if (active) { res.status(409)... return; }
const config = await weatherConfigService.getConfig();
const run = await service.create({ ... });             // INSERT
```

`hasActiveRun` (`backtest-run.service.ts:309-314`) fait un `findOne` puis `create` est un INSERT séparé, avec **deux `await` entre les deux** (config fetch + create). Deux POST `/runs` simultanés peuvent tous les deux voir "pas de run actif" et insérer/lancer deux runs en parallèle. Pas de contrainte unique DB sur `(domain, status)`, pas de transaction, pas de `SELECT ... FOR UPDATE`.

**Impact** : deux runs concurrents contre la même DB → corruption d'état (le `tracker` est par-runId donc ne se collisionne pas, mais le `Ledger`/équity est par-process et les écritures DB se mélangent).

### C6 — Endpoint `/markets-series` non cachable, full-scan + pagination en mémoire

**Vérification** : ✅ **Confirmé**
**Localisation** : `backtest.ts:262-428`

Le endpoint "live" `/markets-series` :
- fait un `MIN/MAX` sur `weather_bucket_tick` (ligne 272-280),
- puis un `GROUP BY conditionId` sur toute la fenêtre sans `LIMIT` SQL — **le `allMarkets` est chargé en entier** (ligne 323), puis slicé en mémoire `allMarkets.slice(offset, offset+limit)` (ligne 336),
- puis re-fetch les ticks par batch de 200 `conditionId` (ligne 374).

`MAX_MARKETS_SERIES` (ligne 31) borne la **page** retournée, pas le `allMarkets` chargé. Avec des milliers de marchés, le `allMarkets` et la boucle de batches peuvent coûter cher. Aucun cache. La frontend le re-fetch intégralement chaque seconde via `livePolling`.

**Impact** : risque de DoS + tempête de requêtes. Le dev log (terminal) montre des réponses de 5–8 s.

### C7 — Boucles de pagination frontend non bornées (boucle infinie possible)

**Vérification** : ✅ **Confirmé**
**Localisation** : `WeatherAlgoBacktestTab.tsx:126-137` (`refreshLiveSeries`), `:202-211` (`refreshDetail` market series)

```typescript
for (;;) {
  const res = await fetchLiveMarketSeries({ offset, limit: MARKETS_PAGE_SIZE });
  items.push(...res.items);
  total = res.total;
  offset += res.items.length;
  if (offset >= total || res.items.length === 0) break;
}
```

- Si le backend renvoie un `total` qui croît entre pages (données live en cours d'ingestion), `offset >= total` peut ne jamais devenir vrai → **boucle infinie**.
- `res.items.length === 0` break sur une page vide transitoire → **troncature silencieuse** (le frontend affiche moins que le total réel).
- `items.push(...)` sur des centaines de pages de 500 → croissance mémoire potentiellement dans les centaines de MB.

### C8 — Pollers 1 s sans garde anti-réentrance ni AbortController

**Vérification** : ✅ **Confirmé**
**Localisation** : `WeatherAlgoBacktestTab.tsx:107-115`, `useBacktestPolling.ts`

`polling` (détail) et `livePolling` (ridge live) tournent à 1 s (`POLL_MS = 1000`, `useBacktestPolling.ts:3`). `tick()` (ligne 21) appelle `onTick()` sans vérifier si un fetch précédent est en vol. Avec des réponses de 5–8 s (C6), les requêtes s'empilent → **storm + races** où une réponse périmée écrase l'état courant.

Pas d'`AbortController` : un run fermé puis réouvert peut récupérer des données d'un fetch précédent (cross-run data bleed). `onCleanup(stop)` (`useBacktestPolling.ts:45`) nettoie bien le timer au démontage, mais n'annule pas les fetchs en vol.

### C9 — Tests critiques manquants sur le cœur mathématique

**Vérification** : ✅ **Confirmé**
**Localisation** : `packages/backtest/src/engine/fill-engine.ts` (0 test direct), `data-loader.ts` (0 test pagination), `runner.ts` (0 test direct), `backtest.ts` (633 lignes, 0 test)

- `fill-engine.ts` : **zéro test** avec `slippageBps` non-nul. Le clamping [0,1] et les fees avec `feeExponent≠1` ne sont jamais testés.
- `data-loader.ts` : pagination keyset (offset/limit, bornes, fidélité) non testée.
- `runner.ts` : event loop, abort, cancel, `setImmediate` yield — aucun test direct.
- `backtest.ts` : validation Zod, lock, cancel, delete — **zéro test**.
- Pas de snapshot/golden test → dérive silencieuse possible sans échec.
- Aucun pipeline CI dans le repo (pas de `.github/workflows/`).
- E2E couvrent le pipeline d'entrée live, pas le moteur de backtest.

---

## 🟠 Findings majeurs

### M1 — `tryResolveByPrice` peut se déclencher sur un prix périmé/fallback

**Vérification** : ✅ **Confirmé**
**Localisation** : `weather-adapter.ts:623-683`

`yesPrice = tick.yesPrice ?? pos.markPrice ?? pos.entryPrice` (ligne 628). Quand `evaluateExits` itère une position dont le tick courant n'est pas le sien (voir C1), `tick` est le tick périmé de cette position. Un marché vu à 0.99 il y a 30 min peut être résolu maintenant. Le fallback `entryPrice` peut produire une résolution à tort si l'entryPrice était ≤ 0.01.

### M2 — Résolutions et ghost-closes à `fees: 0`, asymétrie vs autres exits

**Vérification** : ✅ **Confirmé**
**Localisation** : `weather-adapter.ts:670` (résolution), `:116` (ghost-close)

`tryResolveByPrice` ferme à `fees: 0` (ligne 670). `finish` ghost-close à `fees: 0` (ligne 116). Les exits SL/TP/drift/bucket/kill-switch appliquent `simulateWeatherExitFill` avec fees (lignes 278, 738, 791). **Asymétrie** : un exit par résolution est plus favorable qu'un exit par TP au même prix (0.99 résolu → exitPrice=1, fees=0 ; 0.99 en TP → exitPrice=0.99×(1-slippage), fees>0).

### M3 — Garde d'exposition `canEnter` utilise le notionnel non plafonné

**Vérification** : ✅ **Confirmé**
**Localisation** : `weather-adapter.ts:184-214` (canEnter), `fill-engine.ts:31-34`

`canEnter` estime `entryPrice = yesPrice*(1+slippage)`, `qty = entryUsdc/entryPrice`, et compare `openExposure(strategyId) + entryUsdc > maxExposure` (ligne 205) avec `entryUsdc` **non plafonné**. Mais `simulateWeatherEntryFill` plafonne `cappedUsdc = min(entryUsdc, maxPositionSizeUsdc ?? Infinity)` (ligne 31). Si `maxPositionSizeUsdc < entryUsdc`, la garde rejette des entrées valides (conservateur) ou laisse passer des expositions qui dépassent l'intention. Sémantique de garde incohérente.

### M4 — `openExposure` en cost basis (slippage inclus) comparé à `entryUsdc` pré-slippage

**Vérification** : ✅ **Confirmé**
**Localisation** : `ledger.ts:72-82`, `weather-adapter.ts:205`

`openExposure` somme `qty * entryPrice` (ligne 79), où `entryPrice` inclut le slippage. `canEnter` compare à `entryUsdc` (pré-slippage). Mélange des deux baselines → limites d'exposition faussées de quelques bps systématiquement.

### M5 — SL fee-aware, TP trigger gross-of-fees (asymétrie)

**Vérification** : ⚠️ **NUANCÉ — comportement intentionnel, aligné live**
**Localisation** : `exit-manager.ts:173-204`

- SL : `closurePnl <= -slPercent + eps` où `closurePnl = ((bid-costBasis)/costBasis)*100` (fee-aware, ligne 184).
- TP : `triggerPnl >= 0 && closurePnl >= tpPercent - eps` où `triggerPnl = ((bid-entry)/entry)*100` (gross-of-fees, ligne 186).
- Le commentaire ligne 185 indique explicitement : `// Market-move PnL without fees — mirrors live effectiveTrigger guard on TP.`

**Conclusion** : l'asymétrie **est intentionnelle** et reproduit le live (`effectiveTrigger` guard). Ce n'est pas un bug. À documenter mais pas à corriger. **Rétrogradé en mineur/documentation.**

### M6 — Trailing peak n'avance que sur le tick de la position courante

**Vérification** : ✅ **Confirmé** (conséquence de C1)
**Localisation** : `ledger.ts:138-152`, `weather-adapter.ts:708`

`peakClosurePnl` n'est mis à jour que dans `updateMark`, appelé uniquement pour la position dont le tick arrive (ligne 708). Les autres positions ouvertes ne voient pas leur peak avancer même si le marché a bougé favorablement. Un trailing qui devrait s'armer/déclencher sur un pic atteint via un autre tick est manqué.

### M7 — Slippage peut pousser le prix hors [0,1], fees mis à 0

**Vérification** : ✅ **Confirmé**
**Localisation** : `fill-engine.ts:30` (entry), `:49` (exit), `packages/core/src/pricing/fees.ts:33-36`

`price = yesPrice * (1 + slippageBps/10_000)` (ligne 30). Si `yesPrice = 0.999` et `slippageBps = 200`, `price ≈ 1.019` — **hors [0,1]**. Côté exit (ligne 49), `yesPrice * (1 - slippage/10_000)` peut devenir < 0. `computeTakerFee` (lignes 33-36) : `curve = price*(1-price)` ; si `curve <= 0` (price >1 ou <0), retourne 0. Donc une position entrée au-dessus de 1 paie **zéro fees** et est instantanément sous l'eau.

### M8 — Delete non transactionnel, FK cascade supposé

**Vérification** : ⚠️ **NUANCÉ — cascade explicite en code, pas de bug immédiat mais pas transactionnel**
**Localisation** : `backtest-run.service.ts:301-307`

```typescript
async delete(runId: number): Promise<void> {
  await this.excludedRepo.delete({ runId });
  await this.equityRepo.delete({ runId });
  await this.positionRepo.delete({ runId });
  await this.runRepo.delete(runId);
}
```

Le commentaire ligne 302 indique "Positions/equity/excluded cascade on FK; explicit delete is a safety net." Les deletes sont **explicites et séquentiels**, en safety net du cascade FK. **Pas de bug immédiat** : même si le cascade FK existe, le code nettoie explicitement. En revanche, **pas de transaction** : un crash entre `positionRepo.delete` et `runRepo.delete` laisse le run row sans positions (orphelin inverse). Risque faible mais réel. **Rétrogradé en mineur.**

### M9 — Cibles de bucket fractionnaires arrondies à l'entier

**Vérification** : ✅ **Confirmé**
**Localisation** : `question-builder.ts:37-40`

`Math.round(bucketTarget)` car `parseWeatherQuestion` (regex `-?\d+`) n'accepte que des entiers. Pour une question synthétisée (tick sans `question`), une cible 12.5°C devient 13°C → **seuil de bucket décalé jusqu'à 0.5°C**, change la prob/edge du forecast sans avertissement. Mitigé quand le tick porte une vraie `question` (utilisée verbatim, ligne 27).

### M10 — Dedup `city|date` pourrait dropper `highest-yes`

**Vérification** : ❌ **RÉFUTÉ**
**Localisation** : `packages/weather-algo/src/strategy/strategy-runner-selection.ts:17-29`

La clé de dedup est `${cityKey}|${dateIso}::${signal.strategyId}` (ligne 22) — **elle inclut `strategyId`**. Le commentaire ligne 9-15 le documente explicitement : "a forecast-less strategy (e.g. highest-yes, edge=0) is never silently discarded by a higher-edge forecast strategy on the same city+date." La capacité côté adapter (`weather-adapter.ts:340-354`) vérifie par `city|date|strategyId` — **cohérent**. **Pas de bug.**

### M11 — `weatherAlgoSlConfirmationTicks` ignoré → backtest plus stopout-prone

**Vérification** : ✅ **Confirmé** (documenté)
**Localisation** : `adapter-warnings.ts:43-47`

Warning statique émis. Le backtest trigger le SL sur le premier tick qualifiant, le live attend N confirmations. **PnL backtest pessimiste côté SL** (documenté mais biaise les résultats).

### M12 — Pas de plafond de liquidité : fills non bornés par le carnet

**Vérification** : ✅ **Confirmé** (documenté)
**Localisation** : `fill-engine.ts:29-38`, `adapter-warnings.ts:58-62`

Warning `fill_no_book_depth`. Un backtest peut filler 10 000 $ sur un carnet live à 200 $ de liquidité. **Overfitting majeur** pour buckets peu liquides.

### M13 — Pas d'exit par timeout/durée de holding

**Vérification** : ⚠️ **NUANCÉ — pas d'exit timeout côté live non plus**
**Localisation** : `exit-manager.ts`, `adapter-warnings.ts:53-57`

L'audit initial listait E5 comme un gap majeur. Vérification : `minTimeToClose` est explicitement ignoré (`adapter-warnings.ts:53-57`), et il n'y a **pas de `maxHoldingMs` côté live non plus** (grep sur `maxHolding|holdingMs|maxHold` ne trouve rien dans `packages/weather-algo` ni `packages/core` à part `avgHoldingMs` qui est une métrique de sortie, pas un trigger). Donc **pas de divergence** — le backtest reproduit fidèlement l'absence d'exit timeout du live. **Rétrogradé en documentation/nit.**

### M14 — Validation numérique côté client absente

**Vérification** : ✅ **Confirmé**
**Localisation** : `WeatherAlgoBacktestTab.tsx:261-301`

`Number(capital()) || 1000`, `Number(entryUsdc()) || 10`, etc. (lignes 277-280). Négatifs, NaN, notation scientifique (`1e3`), strings vides sont silencieusement coercés vers le défaut. Aucune validation de bornes (capital > 0, slippage ≥ 0, maxPos ≥ 1).

### M15 — Timezone off-by-one dans la reconstruction des dates

**Vérification** : ✅ **Confirmé**
**Localisation** : `WeatherAlgoBacktestTab.tsx:272-273`

`new Date(`${from()}T00:00:00.000Z`)` et `new Date(`${to()}T23:59:59.999Z`)` construisent des instants UTC à partir d'une date saisie dans le timezone local de l'utilisateur. Si l'utilisateur est UTC+2 et saisit `2026-08-23`, le `from` devient `2026-08-23T00:00:00Z` = `2026-08-22T22:00:00+02:00` → **off-by-one** potentiel selon l'interprétation attendue.

### M16 — `selectedId` persisté peut pointer vers un run supprimé

**Vérification** : ✅ **Confirmé**
**Localisation** : `WeatherAlgoBacktestTab.tsx:82-87`, `:303-314`

`selectedId` est persisté via `usePersistedSignal`. Si le run est supprimé (côté serveur ou par un autre utilisateur en multi-tenant), au prochain mount `openRun(restoredId)` → `refreshDetail` → 404 → `setDetailError` mais `selectedId` n'est pas nettoyé. L'onglet reste bloqué sur un run inexistant.

### M17 — Tests manquants : runner-sim e2e, kill-switch force_close_all, SL/TP/trailing au niveau adapter

**Vérification** : ✅ **Confirmé**
**Localisation** : `weather-adapter.test.ts`

- Pas de test d'intégration `backtestExecutionMode: 'runner-sim'` end-to-end via `runBacktest`.
- Pas de test du kill-switch `force_close_all` (le config de test utilise `block_entries`, `weather-adapter.test.ts:32`).
- Pas de test SL/TP/trailing au niveau adapter (seulement résolution et ghost).
- Pas de test `strategy` vs `runner-sim` consistence (C3 non attrapé).

### M18 — Pas de borne supérieure stricte sur `limit` market-series

**Vérification** : ✅ **Confirmé**
**Localisation** : `backtest.ts:269, 457`

`parseLimit(req.query.limit, MAX_MARKETS_SERIES, MAX_MARKETS_SERIES)` — le default et le max sont tous les deux `MAX_MARKETS_SERIES` (500). C'est en fait **correctement borné** (le max est appliqué). ⚠️ **NUANCÉ** : la borne existe, mais le `allMarkets` chargé avant slice n'est **pas** borné (voir C6). Le risque de DoS vient du full-scan, pas du `limit`. **Rétrogradé en mineur** (le `limit` est bien clamped).

---

## 🟡 Findings mineurs (vérifiés)

- **m1** — `data-loader.ts:30-35` : signals replay non filtrés par `fidelityMinutes` (colonne absente de `weather_evaluation_log`). Documenté inline. Un replay peut rejouer des signaux à fidélité différente des ticks sélectionnés.
- **m2** — `weather-adapter.ts:707-719` : pas de détection de période silencieuse pour les positions ouvertes. Les exits ne sont ré-évalués que quand un tick arrive.
- **m3** — `weather-adapter.ts:177` : `isDailyLossBreached` utilise `<=`. Frontière à confirmer vs live (`policy.ts`).
- **m4** — `ledger.ts:86` : `dailyRealizedPnl` borne sur jour UTC. Diverge du live si le live utilise un jour d'échange local.
- **m5** — `stats.ts:17` : `computeMaxDrawdown` skip si `peak <= 0` → sous-estime le drawdown en run catastrophique.
- **m6** — `stats.ts:46-51` : `profitFactor` `null` (all wins) vs `0` (no trades/all breakeven) → sémantiquement ambigu.
- **m7** — `index.ts:69-98` : `runner-sim` + `replay` non interdit explicitement ; `onBookTick` return early en replay (`weather-adapter.ts:467-469`) avant `onBookTickRunnerSim` → runner-sim silencieusement no-op. Pas d'avertissement.
- **m8** — `engine-version.ts` : version purement cosmétique, jamais lue pour invalider/rejeter un replay sur version mismatch. Pas de test/garde CI.
- **m9** — `BacktestRunTracker` (`backtest-run-tracker.ts`) in-process : pas de lock cross-process (multi-instance non safe).
- **m10** — `context-builder.ts:61` : `marketType: 'standard' as never` contourne le type union (smell).
- **m11** — Frontend : erreurs de liste routées vers `launchError` (`WeatherAlgoBacktestTab.tsx:172`) ; erreurs coverage/cancel swallowées (`:157`, `:334`).
- **m12** — Frontend : positions tronquées à 200 silencieusement (`fetchBacktestPositions(id, { limit: 200 })`, ligne 192).
- **m13** — Frontend : binary-search hover (`useRidgeHover.ts`) suppose les points triés côté backend (non garanti formellement, mais backend trie bien par `recordedAt ASC, id ASC` — `backtest.ts:385-386`).
- **m14** — Frontend : `confirm()` natif bloquant pour delete (ligne 340).
- **m15** — 3 chemins d'entrée dupliqués (`onBookTick` strategy / `onBookTickRunnerSim` / `onSignal`) avec `meta` subtilement différents → risque de dérive.
- **m16** — `markOrphanedRunningAsFailed` au boot (`backtest-run.service.ts:181-191`) marque les zombies failed, mais `markCompleted`/`markCancelled` check le statut et no-op si déjà failed → un late `markCompleted` silencieusement droppé.
- **m17** — `runner.ts:311` : `setImmediate` yield toutes les 5000 events — magic number non documenté.
- **m18** — `weather-adapter.ts:728` : `WEATHER_HIGHEST_YES_STRATEGY_ID` skip `tryExitByDecision` (drift/bucket) — intentionnel mais non documenté dans le code.

---

## 🟢 Findings nit (vérifiés)

- `BACKTEST_ENGINE_VERSION` non validée semver (`engine-version.ts:2`).
- `hasOpen` (`ledger.ts:51-53`) mort — doublon de `isDuplicateOpen` (`:67-69`).
- `openPositions()` (`ledger.ts:63-65`) alloue un tableau par appel (O(n) par tick, acceptable mais smell).
- Casts `as never` / `as unknown as` dans les tests (`exit-manager.test.ts:18`, `stats.test.ts:104`, `index.test.ts:12`, `runner-sim.test.ts:41,62,106`) — contournent la sécurité de types.
- `ClockedWeatherStrategy.evaluate` (`clocked-weather-strategy.ts:41-47`) jamais appelé par l'adapter (conformité interface seulement).
- `equityAt(_now)` (`ledger.ts:192`) ignore son paramètre `now` — signature trompeuse.
- Label anglais "Yes/No" dans une UI française.
- Magic numbers non documentés (`5000` events yield, `10_000`/`5` progress formula `runner.ts:208`).

---

## 🔬 Synthèse des corrections apportées à l'audit initial

| Finding | Statut final | Note |
|---|---|---|
| C1–C9 | ✅ Confirmés | Tous vérifiés contre le code |
| M1, M2, M3, M4, M6, M7, M9, M11, M12, M14, M15, M16, M17 | ✅ Confirmés | — |
| **M5** | ⚠️ **Rétrogradé mineur** | Asymétrie SL/TP **intentionnelle**, alignée live (`effectiveTrigger` guard). Commentaire ligne 185 le documente. Pas un bug. |
| **M8** | ⚠️ **Rétrogradé mineur** | Delete explicite séquentiel en safety net du cascade FK. Pas transactionnel (orphelin partiel possible sur crash) mais pas de bug immédiat. |
| **M10** | ❌ **Réfuté** | `dedupSignalsByCityDate` inclut `strategyId` dans la clé (`strategy-runner-selection.ts:22`). Highest-yes n'est jamais droppé. Cohérent avec la capacité par `city|date|strategyId`. |
| **M13** (ex-E5) | ⚠️ **Rétrogradé nit** | Pas d'exit timeout côté live non plus. Pas de divergence. Documenté. |
| **M18** | ⚠️ **Rétrogradé mineur** | `parseLimit` borne bien le `limit` retourné (default=max=500). Le risque de DoS vient du `allMarkets` full-scan (C6), pas du `limit`. |

---

## 📊 Tests — couverture (vérifiée)

**Solide** :
- `index.test.ts` — 16 tests intégration pgmem (parse params, overrides, runners reevaluate/replay/highest-yes, multi-stratégie).
- `exit-manager.test.ts` — 9 tests unitaires avec conditions aux bornes SL/TP/trailing (dont la boundary `>=`/`<=` avec epsilon).
- `weather-adapter.test.ts` — 13 tests : replay, résolution (0.99→YES, fallbacks), `maxConcurrentPositions`, métriques non supportées, ghost-close, highest-yes, per-strategy ledger.
- `runner-sim.test.ts` — 3 tests : first-winner, dedup highest-edge, aligned targeting.

**Trous critiques** :
- `fill-engine.ts` : slippage ≠ 0 non testé, clamping [0,1] non testé, fees exponent ≠ 1 non testé.
- `data-loader.ts` : pagination keyset non testée.
- `runner.ts` : boucle/abort/cancel/yield — aucun test direct.
- `backtest.ts` : 633 lignes de routes, 0 test (validation, lock, cancel, delete cascade).
- `question-builder.ts` : arrondi fractionnaire (M9) non testé.
- `context-builder.ts` : pas de test.
- `virtual-clock.ts` : pas de test.
- `params` (Zod) : pas de test dédié.
- `backtest-run-tracker.ts` : pas de test.
- Branche NO de résolution (`yesPrice <= 0.01`) : pas de test explicite (seulement YES à 0.99).
- Pas de snapshot/golden test.
- Pas de CI.

**Top 10 tests à ajouter** :
1. `fill-engine` avec slippage non-nul + clamping [0,1] + fees exponent ≠ 1.
2. Snapshot/golden replay d'un run historique connu (régression moteur).
3. `data-loader` pagination keyset (bornes, fidélité, offset total).
4. `runner` abort/cancel/timeout mid-event.
5. Routes `backtest.ts` : validation, lock race, cancel, delete cascade.
6. `strategy` vs `runner-sim` consistence (C3) — test qui échoue si divergence.
7. `question-builder` cibles fractionnaires (M9).
8. SL/TP/trailing au niveau adapter (sorties réelles, pas juste résolution).
9. kill-switch `force_close_all`.
10. Multi-position avec marks périmés (C1) — test qui documente le comportement attendu.

---

## 🎯 Plan d'action priorisé

1. **Fix C1/C2 (marks périmés)** — re-mark toutes les positions ouvertes sur chaque tick entrant (ou au minimum sur un tick de référence par condition), ou accepter et **documenter** la fidélité. Plus haut impact sur la justesse des résultats.
2. **Isolation multi-utilisateur (C4)** — filtrer tous les endpoints par `req.user.id` ; lock singleton par utilisateur.
3. **Lock atomique (C5)** — contrainte unique DB sur `(domain, status)` ou `INSERT ... WHERE NOT EXISTS` dans une transaction.
4. **Cache + pagination DB sur `/markets-series` (C6/M18)** — cursor DB, cache court-terme, cache côté frontend, AbortController.
5. **Frontend : AbortController + garde anti-réentrance (C8) + validation numérique (M14) + borne pagination (C7)**.
6. **Tests CI** — pipeline `.github/workflows`, tests fill-engine/data-loader/runner/routes, golden snapshot.
7. **Fidélité `strategy` mode (C3)** — soit déprécier `strategy` au profit de `runner-sim`, soit émettre un avertissement explicite ; documenter la divergence.
8. **Clamping prix [0,1] + fees de résolution (M2/M7)**.
9. **Cibles fractionnaires (M9)** — ne pas arrondir, étendre le regex du parser.
10. **Documenter M5, M13** (alignement live intentionnel).

---

## 🔗 Liens

- Audit précédent (correctitude/fidélité, résolu 0.3.0) : [`docs/audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md`](2026-08-18_audit-weather-backtest-fidelite-correctude.md)
- Audit highest-yes edge cases : [`docs/audits/2026-08-15_audit-weather-algo-highest-yes-edge-cases.md`](2026-08-15_audit-weather-algo-highest-yes-edge-cases.md)
- Audit per-strategy risk : [`docs/audits/2026-08-21_audit-weather-backtest-per-strategy-risk.md`](2026-08-21_audit-weather-backtest-per-strategy-risk.md)
- Audit moteur : [`docs/audits/2026-08-19_audit-weather-backtest-moteur.md`](2026-08-19_audit-weather-backtest-moteur.md)
- Plan backtest appliqué : [`docs/plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md`](../plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md)