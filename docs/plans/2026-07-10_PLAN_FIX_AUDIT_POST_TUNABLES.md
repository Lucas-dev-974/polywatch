# Plan — Correctifs post-audit (spread gate, tunable fantôme, concurrence, debounce)

**Date** : 2026-07-10  
**Dernière mise à jour** : 2026-07-10  
**Version cible** : v1.1  
**Statut** : Implémenté (C1–C6 ; C7 reporté)  
**Tags** : `crypto-algo`, `spread`, `price-feed`, `tunables`, `concurrency`, `observability`  
**Références** :
- Audit verify-implementation (conversation 2026-07-10) — Plan A/B + tunables UI
- Prérequis : `2026-07-09_PLAN_FIX_STRATEGY_SPREAD_GAMMA_TOKEN_MIXUP.md` (Plan A)
- Prérequis : `2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md` (Plan B, B2 illiquidité)
- Prérequis : `2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md`

---

## 1. Contexte

L’audit post-implémentation (Plan A/B + tunables RiskConfig/UI) confirme que le chemin nominal est correct (spread sur token cible, WS primaire, Gamma fallback, hot-reload stratégie). En revanche, plusieurs défauts restent :

| ID | Sévérité | Sympton | Statut |
|----|----------|---------|--------|
| C1 | Critique | Spread gate **fail-open** si carnet cible null/unilatéral | ✅ |
| C2 | Critique | Spread gate **sans fraîcheur** (carnet périmé encore bilatéral) | ✅ |
| C3 | Haute | Tunable UI `cryptoAlgoLastCloseableBidMaxAgeMs` **non branché** | ✅ |
| C4 | Haute | Évaluations **concurrentes** WS + polling → double entrée possible | ✅ |
| C5 | Moyenne | Timers debounce **orphelins** après `unsubscribeStale` | ✅ |
| C6 | Moyenne | Observabilité : re-entry / détail abstention incomplets | ✅ |
| C7 | Basse | Dette : defaults quadruplés, `null`/`{}` API, parse JSON silencieux | ✅ cf. `2026-07-10_PLAN_PATCH_C7_TUNABLES_DEBT.md` |

Ordre d’implémentation recommandé : **C1+C2** (même zone stratégie) → **C3** (exit/tunable) → **C4+C5** (runtime) → **C6** (observabilité) → **C7** (dette, optionnel même PR ou suivant) → **doc + tests**.

---

## 2. C1 — Spread gate fail-open (illiquidité)

### Diagnostic

`naive-momentum.strategy.ts` : `spreadAbs(targetBook)` retourne `null` si le carnet n’est pas bilatéral ; le gate ne bloque que si `spreadAbs !== null && spreadAbs > maxSpread`. Un carnet Down absent ou unilatéral laisse passer un signal NO.

Contradiction avec Plan B2 : *« un carnet unilatéral […] **est** utilisable comme signal d’illiquidité »*.

### Correctif

1. Après résolution du `candidate` et du `targetBook` :
   - Si `!isBilateralBook(targetBook)` → abstain `illiquid_book` (nouveau code) ou réutiliser `spread_gate` avec `detail: 'unilateral_or_missing'`.
   - Préférer un code dédié `illiquid_book` pour distinguer « spread trop large » vs « pas de carnet bilatéral ».
2. Ne pas fail-open sur path Gamma non plus : même sans mid WS, le gate illiquidité s’applique au carnet cible s’il existe en cache ; s’il est absent → abstain `illiquid_book` (pas d’entrée à l’aveugle).
3. Étendre `AbstainReasonCode` dans `strategy.ts` + mapper ticks / UI debug si besoin.

### Tests

- Candidat NO + `downBook` null → `illiquid_book`
- Candidat NO + Down unilatéral (bid null) → `illiquid_book`
- Candidat YES + Up bilatéral frais, spread OK → signal (régression)

### Doc

- Mettre à jour `docs/crypto-algo.md` : règle « pas d’entrée sans carnet cible bilatéral ».
- Marquer Plan B2 comme clarifié (fail-closed explicite).

---

## 3. C2 — Spread gate sans contrôle de fraîcheur

### Diagnostic

`selectPrice` exige `isFreshBook(upBook)` pour la source WS ; le gate lit `targetBook.spread` **sans** `isFreshBook`. Un Down périmé mais encore bilatéral peut faire passer/bloquer à tort.

### Correctif

1. Pour le gate (et l’ajustement de seuil) : n’utiliser `spreadAbs` que si `isBilateralBook(targetBook) && isFreshBook(targetBook, nowMs, maxBookAgeMs)`.
2. Si bilatéral mais **stale** → abstain `stale_book` (ou `illiquid_book` avec detail `stale_target_book`) — ne pas utiliser le spread figé.
3. Aligner éventuellement sur `computeSpreadAbs` (core) pour une seule formule abs (dette B5 partielle).

### Tests

- Up frais + Down bilatéral **stale** + candidat NO → abstain (pas de signal)
- Up frais + Down frais, spread > max → `spread_gate`

### Doc

- Documenter dans `docs/crypto-algo.md` : fraîcheur requise pour **prix** (Up) et pour **gate** (token cible).

---

## 4. C3 — Brancher `cryptoAlgoLastCloseableBidMaxAgeMs`

### Diagnostic

- Colonne + validation + UI Hard Exit + `resolveLastCloseableBidMaxAgeMs` existent.
- `crypto-algo-exit.ts` **importe** le resolver mais ne l’utilise pas ; `isLastCloseableBidFresh` et `resolveExitDecisionMarkPrice` utilisent `LAST_CLOSEABLE_BID_MAX_AGE_MS = 60_000`.
- Worker `close-bid.ts` appelle `isLastCloseableBidFresh(lastCloseableBidAt)` sans `maxAgeMs` ni `risk`.

### Correctif

1. `isLastCloseableBidFresh` : conserver le 3ᵉ arg `maxAgeMs` ; tous les call sites runtime passent `resolveLastCloseableBidMaxAgeMs(risk)`.
2. `resolveExitDecisionMarkPrice` / chemins pre-close : injecter `risk` (ou `maxAgeMs` déjà résolu).
3. `close-bid.ts` / `buildPositionExitContext` : propager le max age depuis RiskConfig (cache worker déjà invalidé sur `config-changed`).
4. Supprimer l’import mort ou l’utiliser ; garder `LAST_CLOSEABLE_BID_MAX_AGE_MS` comme **default** uniquement (alias du default tunables).
5. Test unitaire : avec risk override `30_000`, un bid âgé de 45 s n’est plus fresh.

### Doc

- `docs/crypto-algo.md` + hint UI Hard Exit : « appliqué aux décisions de sortie / close bid (hot-reload via Redis) ».
- Cocher dans `2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md` que ce champ est branché runtime.

---

## 5. C4 — Mutex d’évaluation par `conditionId`

### Diagnostic

`handlePriceUpdate` (WS debounce) et `tick()` (polling) appellent `evaluateSelection` sans exclusion mutuelle → deux `onSignal` quasi simultanés peuvent contourner le re-entry throttle (incrémenté seulement après enqueue réussi).

### Correctif

1. Map `evaluating = Map<conditionId, Promise<void>>` (ou chaîne de promesses) dans `StrategyRunner`.
2. `evaluateSelection` : si une éval est en cours pour ce `conditionId`, **await** la précédente puis réévaluer (ou skip si trop récent via debounce existant) — préférer **serialiser** (await puis run) pour ne pas perdre un tick WS pertinent.
3. Ne pas bloquer les autres `conditionId` (mutex par marché, pas global).

### Tests

- Test unitaire / intégration légère : deux appels parallèles `evaluateSelection` → un seul enqueue (mock `onSignal` / pipeline).

### Doc

- Note courte dans `docs/crypto-algo.md` (section runner) : « une évaluation à la fois par condition ».

---

## 6. C5 — Annuler les debounces à l’unsubscribe

### Diagnostic

`unsubscribeStale` / `clearTopOfBook` nettoient mappings et `lastEval` mais pas `pendingEvals` → `setTimeout` peut encore appeler `handlePriceUpdate` pour un marché retiré.

### Correctif

1. Helper `cancelPendingEval(conditionId)` : `clearTimeout` + `pendingEvals.delete`.
2. Appeler depuis `unsubscribeStale`, `clearTopOfBook`, et éventuellement `resolve`/disable sélection.
3. Au shutdown du price-feed : clear tous les timers (déjà partiel — vérifier `stop`/`disconnect`).

### Tests

- Test price-feed : schedule debounce → unsubscribe → timer ne doit pas invoquer le callback (fake timers).

### Doc

- Optionnel (détail d’implémentation) ; mention dans le plan comme fait.

---

## 7. C6 — Observabilité (re-entry + détail)

### Diagnostic

- Skip re-entry : `recordSkip` seulement, pas `onAbstain` → ticks gardent une vieille raison.
- `detail` d’abstention logué mais non persisté (`last_abstain_reason` = code seul).

### Correctif (minimal)

1. Nouveau code `re_entry_limit` dans `AbstainReasonCode` ; appeler `onAbstain(conditionId, 're_entry_limit')` lors du suppress.
2. Option A (simple) : concaténer detail dans la colonne existante, ex. `spread_gate:spreadAbs=0.06` (longueur bornée).  
   Option B : colonne `last_abstain_detail` (migration) — plus propre, plus de surface.
3. Recommandation : **Option A** pour ce patch (pas de migration) ; Option B si le debug UI en a besoin.

### Tests

- Runner : après suppress re-entry, registry expose `re_entry_limit`.
- Snapshot tick : raison avec suffixe detail si Option A.

### Doc

- Mettre à jour Plan B3 / `docs/crypto-algo.md` : liste des codes d’abstention incluant `illiquid_book`, `re_entry_limit`.

---

## 8. C7 — Dette (optionnel, PR séparée possible)

| Item | Action |
|------|--------|
| Defaults ×4 | Extraire table unique dans `@polywatch/core` ; frontend importe les defaults (ou les reçoit via GET config) |
| API `null` vs `{}` | `presentRiskConfigForApi` : maps vides → `null` |
| Parse JSON silencieux | Log `warn` si JSON DB invalide ; tests parse/merge exit maps |
| Secondes flottantes | Validation entière pour pre-close / time-exit maps |
| UI draft JSON | Bloquer save si `parseError` actif sur un `JsonIntervalMapField` |

Hors scope critique du présent plan si le temps presse — tracker en suivi.

---

## 9. Documentation (livrable transverse)

| Document | Mise à jour |
|----------|-------------|
| `docs/crypto-algo.md` | Règles gate (bilatéral + frais), codes abstention, mutex runner, tunable lastCloseableBid branché, fenêtre d’entrée (rappel B4) |
| `docs/plans/2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md` | Clarifier B2 = fail-closed ; pointer vers ce plan pour C1/C2 |
| `docs/plans/2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md` | Marquer lastCloseableBid comme branché après C3 |
| **Ce fichier** | Statut → Implémenté + checklist cochée en fin de PR |

Pas de nouveau brainstorm long : ce plan **est** la doc d’incident/correctif.

---

## 10. Fichiers touchés (estimé)

| Zone | Fichiers |
|------|----------|
| Stratégie C1/C2 | `naive-momentum.strategy.ts`, `strategy.ts`, `naive-momentum.strategy.test.ts` |
| Exit C3 | `crypto-algo-exit.ts`, `close-bid.ts` (+ callers exit context), tests exit/close-bid |
| Runner C4/C6 | `strategy-runner.ts`, `signal-state-registry.ts` (si besoin) |
| Feed C5 | `price-feed.ts` (+ test nouveau ou existant) |
| Types ticks C6 | `algo-price-tick-*` si format raison change |
| Doc | `docs/crypto-algo.md`, plans cités |

---

## 11. Ordre d’exécution & critères de done

1. **C1 + C2** + tests stratégie → build crypto-algo vert  
2. **C3** + tests exit/close-bid → build core + worker vert  
3. **C4 + C5** + tests runner/feed → pas de double enqueue en test parallèle  
4. **C6** (codes + detail minimal)  
5. **Doc** sections ci-dessus  
6. **C7** seulement si capacité restante  

**Done quand** :
- [x] Aucune entrée si carnet cible manquant / unilatéral / stale  
- [x] Changer `cryptoAlgoLastCloseableBidMaxAgeMs` en UI change le comportement exit (vérif test)  
- [x] Deux évals parallèles même condition → sérialisées (mutex par conditionId)  
- [x] Unsubscribe annule le debounce  
- [x] `docs/crypto-algo.md` à jour ; ce plan passé **Implémenté**

---

## 12. Hors scope

- Cause « worker mort / file Redis » (ops / démarrage) — déjà diagnostiquée ; pas un bug du patch tunables. Suivi éventuel : healthcheck worker / alerte file `order-signals` non drainée.
- Strategy Builder / B7 (cap prix d’entrée).
- Unification complète ticks VWAP vs gate abs (B5) au-delà de `computeSpreadAbs` optionnel.
