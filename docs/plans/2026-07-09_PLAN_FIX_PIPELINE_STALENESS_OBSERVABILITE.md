z# Plan — Pipeline crypto-algo : fraîcheur des carnets, observabilité des abstentions, cohérence spread/Gamma

**Date** : 2026-07-09
**Dernière mise à jour** : 2026-07-09
**Version cible** : v1.1
**Statut** : Implémenté (B1–B6 ; B7 reporté Strategy Builder)
**Tags** : `crypto-algo`, `observability`, `price-feed`, `gamma`, `spread`, `staleness`
**Références** :
- Plan prérequis : `2026-07-09_PLAN_FIX_STRATEGY_SPREAD_GAMMA_TOKEN_MIXUP.md` (Plan A — fournit `TopOfBookData.updatedAt` et `ctx.books`)
- Audit BDD marché XRP 5m `0x906dcb…8fc77` (fenêtre 16:15 → 16:20 UTC+2)

---

## 1. Contexte

Problèmes subtils détectés en élargissant l'audit du cas XRP au-delà des trois bugs bloquants du Plan A. Aucun n'a été à lui seul la cause du zéro-position, mais chacun peut produire des décisions fausses ou rendre un incident indiagnosticable. Ordre d'implémentation recommandé : **B3 en premier** (l'observabilité sécurise le diagnostic et la validation de tous les autres correctifs), puis B1/B2 (même zone de code), puis B5, B6, B4. B7 est une décision produit séparée.

---

## 2. B1 — Fraîcheur du top-of-book jamais vérifiée

### Diagnostic

`TopOfBookData` ne porte pas d'horodatage : en mode polling (tick 30 s), `getTopOfBookForCondition` sert le cache sans borne d'âge — la stratégie peut évaluer sur un carnet vieux de plusieurs minutes sans le savoir (WS silencieux, marché peu actif, resubscription en cours).

### Correctif

- Prérequis Plan A : `updatedAt` présent sur chaque `TopOfBookData`.
- Constante `MAX_BOOK_AGE_MS = 15_000` (module stratégie). Dans `naive-momentum` : un carnet plus vieux que la borne est traité comme absent → bascule sur le fallback Gamma, avec raison d'abstention `stale_book` si aucune source utilisable (cf. B3).
- Le worker principal applique déjà un seuil équivalent de 30 s pour les sorties (`position-exit-evaluator`) ; 15 s est plus strict car l'entrée est moins urgente qu'une sortie. Valeur à confirmer à l'implémentation.

---

## 3. B2 — Carnets unilatéraux gelés dans le cache

### Diagnostic

`CryptoAlgoPriceFeed.handleBookUpdate` (`packages/crypto-algo/src/price-feed.ts`, lignes 408–417) fait `return` si `bids` ou `asks` est vide. Pendant un effondrement, le token perdant n'a fréquemment plus de bids : son entrée de cache **cesse d'être mise à jour** et reste figée sur les dernières valeurs bilatérales — précisément le moment où elles deviennent fausses. Combiné à l'absence de contrôle d'âge (B1), le carnet mort passe pour vivant.

### Correctif

- `TopOfBook` du cache : `bid`/`ask` deviennent `number | null` ; un book unilatéral met à jour l'entrée (`bid: null` ou `ask: null`, `updatedAt` rafraîchi) au lieu d'être ignoré.
- `spread`/`midPrice`/`spreadPercent` sont `null` quand un côté manque.
- Consommateurs à adapter : stratégie (un carnet unilatéral n'est pas utilisable comme source de prix → fallback Gamma ; il **est** utilisable comme signal d'illiquidité — **fail-closed** sur le carnet cible, cf. `2026-07-10_PLAN_FIX_AUDIT_POST_TUNABLES.md` C1/C2), `getOutcomePrices`/`getOutcomeBooks` (tick recorder et percent publisher tolèrent déjà les null).
- Un book vide des deux côtés met aussi à jour `updatedAt` (l'information « ce carnet est vide » est une donnée, pas une absence de donnée).

---

## 4. B3 — Abstentions muettes (observabilité) — **à implémenter en premier**

### Diagnostic

Sur le cas XRP, il a fallu reconstituer la cause par inférence : la garde spread retourne `null` sans log, l'absence d'`outcomePrices` Gamma retourne `null` sans log, le runtime-status ne dit que « stratégies en abstention » sans raison, et `algo_price_ticks.last_signal_*` n'est renseigné que sur signal émis (jamais sur abstention).

### Correctif

1. **Contrat stratégie** (`packages/crypto-algo/src/strategy/strategy.ts`) : `evaluate()` retourne `AlgoSignal | AbstainReason | null` — ou plus simplement un type `EvaluationResult = { signal: AlgoSignal } | { abstain: AbstainReasonCode; detail?: string }`. Codes : `neutral_zone`, `spread_gate`, `no_outcome_prices`, `invalid_price_sum`, `stale_book`, `no_price_source`, `invalid_interval`, `unknown_outcomes`.
2. **Runner** (`strategy-runner.ts`) : le log « all strategies abstained » inclut le code et le détail par stratégie ; `runtimeStatus.recordSkip` reçoit `stratégies en abstention (<code>)`.
3. **Persistance** : colonne `last_abstain_reason` (text, nullable) dans `algo_price_ticks` + migration `AddAbstainReasonToAlgoPriceTicks`, alimentée par le même chemin que `last_signal_*` (snapshot du dernier résultat d'évaluation par condition). Purge : héritée du cleanup existant des ticks, rien à faire.
4. **Frontend (optionnel, même patch ou suivant)** : exposer la raison dans le dialogue Cours marché (panneau Debug) — le champ transite déjà par `GET /api/algo/market-chart/:conditionId` si ajouté au mapper de ticks.

---

## 5. B4 — Budget temporel d'entrée trop serré sur 5m

### Diagnostic

Fenêtre d'entrée réelle ≈ 2 min 20 sur un marché de 5 min :
- découverte auto-track ~9 s après l'ouverture (constaté sur le cas XRP) ;
- cache Gamma TTL 30 s (`OUTCOME_PRICES_CACHE_TTL_MS`, `strategy-runner.ts`) = 10 % de la vie du marché ;
- `resolveCryptoAlgoMinTimeToClose` (défauts) = pre-close 120 s + buffer 30 s = **150 s** d'interdiction d'entrée en fin de marché (`packages/core/src/risk/crypto-algo-exit.ts`).

### Correctif

- **TTL Gamma par intervalle** : ~10 s pour les intervalles ≤ 15m, 30 s au-delà (table de constantes dans `strategy-runner.ts`, résolue via l'interval de la sélection). Après le Plan A, Gamma n'est plus que fallback — l'impact API reste borné (cache par condition, ≤ ~6 requêtes/min/marché).
- **Documentation** : ajouter à `docs/crypto-algo.md` le calcul de la fenêtre effective d'entrée par intervalle et la recommandation de config (`cryptoAlgoMinTimeToClose` explicite si l'opérateur veut élargir la fenêtre sur 5m).
- **Pas de changement des défauts pre-close/time-exit** sans décision produit — ils protègent la sortie.

---

## 6. B5 — Mesure de spread incohérente et explosive

### Diagnostic

Deux problèmes distincts :
1. **Formule** : `spreadPercent = spread / ask × 100` explose sur les tokens bon marché (1 ¢ d'écart sur ask 0.02 = 50 %) — c'est le mécanisme du bug A1, qui subsiste même avec la garde sur le bon token (un Down à 0.9 a un spread % faible, mais un marché encore 50/50 avec 2 ¢ d'écart affiche ~4 %… la mesure n'est pas comparable d'un niveau de prix à l'autre).
2. **Divergence** : les ticks classaient Up `liquidity_status = ok` à 16:18 pendant que la stratégie voyait 41–75 % de spread — deux visions de la liquidité qui ne se recoupent pas, ce qui a compliqué l'audit.

### Correctif

- **Garde en points absolus** pour les marchés binaires : `spread ≤ SPREAD_ABS_BY_INTERVAL` (proposition : 5m 0.05, 10m 0.04, 15m/30m 0.03, 1h+ 0.02 — à calibrer sur les ticks historiques avant de figer). Cohérent avec l'approche SL/TP bid-points déjà adoptée (`2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md`).
- `SPREAD_BY_INTERVAL` (%) dans `constants.ts` remplacé par la table absolue ; `getMaxSpreadForInterval` adapté ; l'ajustement de seuil `calculateThreshold` passe aussi en points (`adjustment = spreadAbs × factor`, facteur recalibré pour conserver l'ordre de grandeur actuel : 2 ¢ de spread ≈ +0.01 de seuil).
- **Unification** : extraire la classification de liquidité utilisée par `PriceTickRecorder` vers une fonction partagée de core, consommée aussi par la stratégie, pour qu'un post-mortem sur les ticks reflète ce que la stratégie a réellement vu.

---

## 7. B6 — Cache Gamma : stale-on-error sans borne et `outcomePrices` manquants

### Diagnostic

`fetchGammaMarketCached` (`strategy-runner.ts`, lignes 258–283) retourne `cached?.market` en cas d'erreur réseau **sans borne d'âge** — un marché Gamma d'il y a plusieurs minutes peut être servi comme frais. Et un Gamma sans `outcomePrices` produit `prices.length < 2` → `null` silencieux dans la stratégie (rejoint B3).

### Correctif

- Borner le stale servi sur erreur : `now - fetchedAt ≤ 2 × TTL`, sinon retourner `null` (la stratégie basculera sur WS seul ou abstiendra avec raison `no_outcome_prices`).
- `outcomePrices` absent/malformé → raison d'abstention explicite `no_outcome_prices` (codes B3) au lieu du `null` muet.

---

## 8. B7 (option — décision produit) — Garde de niveau d'entrée

### Diagnostic

`naive-momentum` est un seuil de **niveau**, pas du momentum : elle achète le côté déjà cher après le mouvement (ex. Down à 0.82+), là où le payoff résiduel est le plus faible face au SL (bid-points 5m : SL −0.10 / TP +0.12 plafonné à 0.99) et aux frais. Une fois les bugs A corrigés, l'algo se mettra à prendre ces entrées tardives — il faut décider si on les veut.

### Options (exclusives ou combinables)

1. **Plafond de prix d'entrée** : ne pas acheter un côté au-dessus de `MAX_ENTRY_PRICE` (ex. 0.85). Simple, borne le risque asymétrique, mais renonce aux fins de tendance.
2. **Vrai filtre momentum** : exiger une dérive récente dans le sens du signal (les `up_delta_1s`/`down_delta_1s` sont déjà enregistrés dans `algo_price_ticks` ; le calcul en mémoire dans le price-feed est trivial). Plus fidèle à l'intention « momentum », plus de paramètres à calibrer.
3. **Statu quo documenté** : accepter les entrées tardives, en s'appuyant sur SL bid-points pour couper.

Recommandation : trancher dans le cadre de la spec Strategy Builder (`docs/plans/2026-07-09_SPEC_STRATEGIE_BUILDER.md`), qui prévoit déjà la paramétrisation des stratégies — éviter de coder ici une règle qui y sera reconstruite.

---

## 9. Fichiers modifiés (hors B7)

| Fichier | Items |
|---------|-------|
| `packages/crypto-algo/src/strategy/strategy.ts` | B3 (type `EvaluationResult`), B1 (constante d'âge) |
| `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts` | B1, B3, B5, B6 (raisons) |
| `packages/crypto-algo/src/strategy/strategy-runner.ts` | B3 (propagation raisons), B4 (TTL par intervalle), B6 (borne stale) |
| `packages/crypto-algo/src/strategy/constants.ts` | B5 (table spread absolue) |
| `packages/crypto-algo/src/price-feed.ts` | B2 (carnets unilatéraux) |
| `packages/crypto-algo/src/price-tick-recorder.ts` (ou équivalent) | B3 (`last_abstain_reason`), B5 (classifieur partagé) |
| `packages/core/src/entities/AlgoPriceTick.ts` + migration | B3 (colonne `last_abstain_reason`) |
| `packages/core/src/lib/…liquidity…` (nouveau ou existant) | B5 (classifieur partagé) |
| `docs/crypto-algo.md` | B4 (fenêtre effective d'entrée), mise à jour sections stratégie |

---

## 10. Tests

- **B1** : carnet frais → utilisé ; carnet à 16 s → ignoré (fallback Gamma) ; raison `stale_book` quand aucune source.
- **B2** : book sans bids → cache mis à jour avec `bid: null` + `updatedAt` frais ; stratégie bascule sur Gamma ; book redevenu bilatéral → cache restauré.
- **B3** : chaque code d'abstention couvert par un cas unitaire ; le runner logue le code ; tick recorder persiste `last_abstain_reason` ; rejeu XRP → les ticks porteraient `spread_gate`/`no_price_source` selon la phase (test d'intégration du mapper).
- **B4** : TTL résolu 10 s pour `5m`, 30 s pour `1h`.
- **B5** : spread 0.01 sur ask 0.02 (50 % relatif) → passe la garde absolue 5m (0.05) ; spread 0.06 → bloqué ; classifieur partagé : mêmes verdicts stratégie/ticks sur un même carnet.
- **B6** : erreur Gamma avec cache à 45 s (TTL 30 s) → servi ; à 70 s → `null` ; `outcomePrices` vide → `no_outcome_prices`.

---

## 11. Hors périmètre

- Les trois bugs bloquants (garde mono-token, repli Gamma, mélange de tokens) : Plan A, prérequis de ce plan.
- Toute modification des défauts pre-close / time-exit / SL-TP.
- Implémentation du Strategy Builder.
- **B7** (garde de niveau d'entrée / plafond prix / vrai momentum) : non codé — reporté vers `2026-07-09_SPEC_STRATEGIE_BUILDER.md`.

---

## 12. Implémentation réalisée (2026-07-09)

| Item | Statut | Détail |
|------|--------|--------|
| B1 | ✅ | `MAX_BOOK_AGE_MS`, `isFreshBook`, abstention `stale_book` |
| B2 | ✅ | Carnets unilatéraux (`bid`/`ask` nullables), `updatedAt` toujours rafraîchi |
| B3 | ✅ | `EvaluationResult`, codes abstention, migration `0039` `last_abstain_reason`, frontend Debug |
| B4 | ✅ | TTL Gamma 10 s / 30 s par intervalle dans `strategy-runner` ; doc fenêtre entrée |
| B5 | ✅ | `SPREAD_ABS_BY_INTERVAL`, garde absolue, ajustement seuil en points |
| B6 | ✅ | Stale-on-error borné `2×TTL`, `no_outcome_prices` explicite |
| B7 | ⏸ | Décision produit — hors implémentation |

**Fichiers modifiés** : `strategy.ts`, `naive-momentum.strategy.ts`, `strategy-runner.ts`, `constants.ts`, `price-feed.ts`, `signal-state-registry.ts`, `AlgoPriceTick` + migration `AddAbstainReasonToAlgoPriceTicks1700000000039`, `docs/crypto-algo.md`, tests `naive-momentum.strategy.test.ts` (29 cas au total avec Plan A).

**Complément post-implémentation** : tunables RiskConfig exposés en UI — voir `2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md` (TTL Gamma, debounce, spread abs, etc. désormais configurables via dialog CryptoAlgo).
