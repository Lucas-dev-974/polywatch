# Analyse d'optimisation des gains — Polywatch v0.6

**Date :** 2026-06-14
**Version analysée :** Polywatch v0.6 (post-patch 14/06/2026 08:10)
**Périmètre :** `packages/core`, `packages/worker`, `packages/backend`, `packages/frontend`
**Objectif :** Identifier les leviers qui augmentent le PnL net réalisé, sans toucher au code.

---

## 1. Synthèse exécutive

Le projet est un bot de copy-trading sur Polymarket CLOB v2. Les gains nets dépendent de cinq grandes fonctions :

1. **Sélection des signaux** (quels mouvements de traders copier)
2. **Sizing des entrées** (combien de shares acheter)
3. **Exécution des ordres** (prix d'entrée/sortie, slippage, frais)
4. **Gestion des sorties** (SL/TP/trailing, pre-close, redemption)
5. **Récupération du capital** (redemption des marchés résolus, retraits)

L'audit du code et des correctifs récents montre que **beaucoup de fuites de PnL sont déjà colmatées** (race conditions, illiquidité, marchés fermés). Néanmoins, **plusieurs leviers de gains importants restent non exploités**. Les plus puissants, par ordre d'impact attendu :

| Rang | Levier | Impact estimé | État actuel |
|------|--------|--------------|-------------|
| 1 | **Redemption fonctionnelle et validée on-chain** | Très haut : sans cela, les gains résolus sont bloqués | ⚠️ Douteuse ( Safe `execTransaction` non confirmé) |
| 2 | **Optimisation du sizing / Kelly / score de signal** | Haut : +10-30% de CAGR possible | ❌ Non implémenté |
| 3 | **Réduction des frais et slippage à l'exécution** | Moyen-haut : économie directe sur chaque trade | 🟡 Partiel (FAK, frais dynamiques OK) |
| 4 | **Meilleure gestion des sorties gagnantes** | Moyen-haut : évite de couper les winners trop tôt | 🟡 Partiel (trailing existe, mais pas d'analyse de edge) |
| 5 | **Filtrage des marchés et des signaux faibles** | Moyen : réduit le ratio trades perdants | 🟡 Partiel (tags autorisés seulement) |
| 6 | **Analyse post-trade et itération** | Moyen : impossible d'améliorer sans métriques | 🟡 Métriques Prometheus ajoutées, mais pas d'analyse PnL |
| 7 | **Fiabilité opérationnelle** | Moyen : évite les positions coincées | 🟡 Corrigé récemment, reste la double finalisation |

---

## 2. Levier 1 : Récupération des gains résolus (redemption)

### Constats

Le flow de redemption est dans `packages/backend/src/polymarket/clob-redeem.ts` :

```77:111:packages/backend/src/polymarket/clob-redeem.ts
export async function redeemOnChain(
  creds: ClobCredentials,
  depositAddress: string,
  input: RedeemOnChainInput,
): Promise<RedeemOnChainResult> {
  const client = createBuilderRelayClient(creds);
  ...
  const response = await client.executeDepositWalletBatch(
    [{ target, value: '0', data: calldata }],
    depositAddress,
    buildDepositWalletDeadline(false),
  );

  const txHash = await waitForTxHash(response);
  return { txHash };
}
```

Problème : l'appel encode `redeemPositions` directement sur le contrat CTF / NegRiskAdapter. Si le `depositAddress` est un **Gnosis Safe proxy wallet**, le contrat cible doit recevoir un appel `execTransaction` du Safe, pas un appel direct à `redeemPositions`. Le relayer `executeDepositWalletBatch` est censé wrapper cela, mais ce n'est pas vérifié dans le code.

Dans `packages/worker/src/processors/redemption-handler.ts`, le `fillPrice: 1.0` est hardcodé pour toute redemption. C'est correct pour un gagnant (payoff 1), mais faux pour un perdant (payoff 0) et potentiellement faux pour les marchés négatifs risques.

### Impact sur les gains

- Si la redemption est cassée : **100% des gains des marchés résolus sont bloqués** jusqu'à correction manuelle.
- Si le payoff est mal crédité : le PnL comptable est faussé, et les positions perdantes peuvent être comptées comme gagnantes.

### Recommandations (non implémentées)

1. **Vérifier la transaction on-chain** : exécuter une redemption test sur un marché micro-résolu, confirmer que le calldata contient `execTransaction` du Safe et que le pUSD revient bien.
2. **Valider le payoff avant crédit** : utiliser `winningTokenId` vs `position.assetId` pour déterminer 0 ou 1, pas un `fillPrice` constant.
3. **Surveiller les redemptions en échec** : alerte métier si une position `pending_resolution` reste en échec > 1h.

---

## 3. Levier 2 : Sizing des entrées et scoring des signaux

### Constats

Le sizing est dans `packages/core/src/sizing/compute.ts` :

```19:61:packages/core/src/sizing/compute.ts
export function computeTargetQuantity(input: SizingInput): number | null {
  ...
  switch (sizingMode) {
    case 'fixed_usdc':
      targetQuantity = fixedUsdcAmount / executableAskVwap;
    case 'proportional_capital':
      targetQuantity = (capital / traderBalance) * traderDeltaSize;
    default:
      targetQuantity = traderDeltaSize * copyRatio;
  }
  ...
}
```

Les modes existants sont :
- `fixed_usdc` : mise fixe (ex. 10$)
- `copy_ratio` : copie proportionnelle au delta du trader
- `proportional_capital` : mise proportionnelle au capital du copieur vs capital du trader

### Fuites de gains identifiées

1. **Mise fixe inefficace** : une mise de 10$ sur un trade à 0.51 et un trade à 0.95 n'a pas la même espérance. Le sizing ne tient pas compte de l'edge estimé.
2. **Pas de filtrage par qualité de signal** : tous les mouvements `INCREASED`/`DECREASED` d'une watchlist sont traités de la même façon. Il n'y a pas de score historique par trader, par marché, par tag, ou par timing.
3. **Pas de gestion du risque par trade** : SL/TP sont fixes en %. Il n'y a pas de sizing basé sur la distance au SL (position sizing par risque).
4. **Aucune corrélation / concentration** : plusieurs positions sur le même événement (même conditionId, différents assetId) peuvent s'additionner sans limite de corrélation.

### Recommandations (non implémentées)

1. **Introduire un score de signal** :
   - Historique du trader (win rate, profit factor, average return)
   - Edge implicite (écart ask vs probabilité subjective, par exemple via une source externe ou un modèle interne)
   - Liquidité du marché (spread, profondeur)
   - Timing (éviter les entrées juste avant la fin si le pre-close est désactivé)
2. **Kelly fractionné** : utiliser une fraction de Kelly (1/4 ou 1/8) basée sur l'edge estimé et le payoff binaire (0/1).
   - Formule : `f = (p*b - q) / b`, avec `p` probabilité de gain, `b` gain net / perte nette.
   - Application : `targetSpend = f * capitalDisponible`.
3. **Position sizing par risque** : `size = riskBudget / (entryPrice - stopPrice)`, avec un risque budget fixe par trade (ex. 2% du capital).
4. **Limite de corrélation** : empêcher que l'exposition sur un même `conditionId` dépasse un % du capital.

---

## 4. Levier 3 : Réduction des frais et du slippage

### Constats

Les frais Polymarket sont calculés correctement dans `packages/core/src/pricing/fees.ts` :

```27:41:packages/core/src/pricing/fees.ts
export function computeTakerFee(
  shares: number,
  price: number,
  params: PlatformFeeParams,
): number {
  const curve = price * (1 - price);
  const raw = shares * feeRate * curve ** feeExponent;
  const rounded = Math.round(raw * 100_000) / 100_000;
  return rounded < 0.00001 ? 0 : rounded;
}
```

Les ordres passent en `OrderType.FAK` (Fill-And-Kill), ce qui limite le slippage.

### Fuites de gains identifiées

1. **Entrée uniquement via ask live** : `RealExecutor.execute` pour BUY utilise `connectionManager.getExecutablePrices` (mémoire WS uniquement). Si le WS est stale ou illiquide, l'ordre part à un mauvais prix.
2. **Pas de maker orders** : tous les ordres sont des ordres taker (FAK). Sur Polymarket, être maker peut réduire les frais ou améliorer le prix d'entrée.
3. **Slippage guard incomplet** : dans `real-executor.ts` et `executor.ts`, la division par `referenceVwap` peut donner `NaN` si `referenceVwap === 0`, ce qui contourne le garde.
4. **Tick size fetch à chaque trade** : bien que mis en cache LRU, le premier appel par token est synchrone avant l'ordre. En haute fréquence, cela ajoute de la latence.

### Recommandations (non implémentées)

1. **Ajouter un fallback REST pour les entrées** : comme c'est déjà fait pour les SELL (`fetchSellExecutablePrices`), pré-valider le prix avec un snapshot REST si le WS n'a pas de liquidité.
2. **Évaluer les ordres maker** : pour les entrées non urgentes, poster des ordres limites GTC côté book au lieu de FAK. Cela réduit le slippage et peut réduire les frais.
3. **Corriger le slippage guard** : `if (!referenceVwap || referenceVwap <= 0) return failedRealExecution(..., 'no_reference_price')`.
4. **Pré-fetch tick size** : maintenir un cache chaud des tick sizes dès la détection du mouvement, avant la réception du signal d'ordre.

---

## 5. Levier 4 : Gestion des sorties gagnantes

### Constats

La logique SL/TP/trailing est dans `packages/core/src/risk/policy.ts` :

```259:316:packages/core/src/risk/policy.ts
export function evaluateSlTpTrailing(input: {
  slPercent: number | null;
  tpPercent: number | null;
  trailingStopPercent: number | null;
  trailingActivationPercent?: number | null;
  effectiveTrigger: number;
  effectiveClosure: number;
  peakPnlPercent: number;
  peakClosurePnlPercent: number;
}): Extract<OrderReason, 'SL' | 'TP' | 'TRAILING'> | null {
  // SL: Hybrid OR
  if (isActiveExitThreshold(slPercent)) {
    if (effectiveTrigger <= -slPercent || effectiveClosure <= -slPercent) return 'SL';
  }
  // TP: Hybrid AND
  if (isActiveExitThreshold(tpPercent)) {
    if (effectiveTrigger >= tpPercent && effectiveClosure >= tpPercent) return 'TP';
  }
  // Trailing
  if (isActiveExitThreshold(trailingStopPercent) &&
      isTrailingArmed(peakClosurePnlPercent, trailingActivationPercent) &&
      peakClosurePnlPercent - effectiveClosure >= trailingStopPercent) {
    return 'TRAILING';
  }
  return null;
}
```

### Fuites de gains identifiées

1. **TP en AND est conservateur** : il faut que le bid live ET le closure (prix d'entrée net de frais) soient au-dessus du TP. Sur des trades gagnants rapides, le closure peut traîner à cause des frais d'entrée, retardant la prise de gain.
2. **Pas de trailing partiel** : quand le trailing se déclenche, 100% de la position est vendue. Pas de possibilité de vendre une fraction pour sécuriser les gains et laisser courir le reste.
3. **Pre-close sort les winners** : `preCloseHoldIfWinning` peut retenir, mais `evaluateMarketExit` sort aussi en `PRE_CLOSE_WIN` si `preCloseHoldIfWinning` est désactivé. Sur les marchés courts, cela peut forcer la vente d'un gagnant avant résolution.
4. **Pas de take-profit échelonné** : impossible de vendre 50% à +10%, 50% à +20%.

### Recommandations (non implémentées)

1. **Tester TP OR vs AND en backtest** : mesurer l'impact sur le PnL simulé historique.
2. **Trailing partiel** : vendre 30-50% au premier signal de drawdown, laisser le reste avec un trailing plus large.
3. **Take-profit échelonné** : configurer plusieurs niveaux de TP avec des fractions de position.
4. **Pre-close intelligent** : ne pas sortir un winner proche de la résolution si le payoff attendu est supérieur au prix de clôture moins les frais.

---

## 6. Levier 5 : Filtrage des marchés et des signaux

### Constats

Le filtrage actuel se limite aux tags autorisés (`AllowedMarketTags`) et au ratio bid/ask minimum (`MinBidToAskRatio`) dans `policy.ts` :

```119:127:packages/core/src/risk/policy.ts
export function isEntryBidAskRatioAcceptable(
  bidVwap: number,
  askVwap: number,
  minBidToAskRatio: number,
): boolean {
  if (minBidToAskRatio <= 0) return true;
  if (askVwap <= 0 || bidVwap <= 0) return false;
  return bidVwap / askVwap >= minBidToAskRatio;
}
```

### Fuites de gains identifiées

1. **Pas de filtre sur le spread absolu** : un ratio bid/ask de 0.90 peut masquer un spread de 5 cents sur un marché à 0.50$, ce qui est toxique en frais.
2. **Pas de filtre sur la liquidité en dollars** : le `liquidityStatus` est `ok` / `partial` / `illiquid`, mais il n'y a pas de seuil en dollar de profondeur requise.
3. **Pas de filtre sur la volatilité / le type de marché** : les marchés ultra-courts (5 min) ont un comportement très différent des marchés longs. Aucune adaptation automatique.
4. **Pas de blacklisting de traders/marchés perdants** : si un trader ou un tag est systématiquement perdant, le bot continue de copier.

### Recommandations (non implémentées)

1. **Spread minimum en cents** : rejeter les entrées où `ask - bid > X cents`.
2. **Depth minimum** : exiger une profondeur bid/ask d'au moins `2 * targetQuantity` en dollars.
3. **Score par trader/watchlist** : calculer le PnL historique par trader, par tag, par durée de marché, et arrêter automatiquement ceux avec un profit factor < 1 sur N trades.
4. **Blacklists dynamiques** : désactiver temporairement un marché ou un trader après une série de pertes.

---

## 7. Levier 6 : Analyse post-trade et itération

### Constats

Les métriques Prometheus ont été ajoutées (OPT-8, OPT-10). C'est un progrès important. Cependant, il n'existe pas dans le code de :
- Tableau de bord de performance par stratégie / trader / tag
- Calcul de win rate, profit factor, expectancy, drawdown maximal
- Analyse des slippages réels vs attendus
- Analyse des redemptions manquées

### Impact sur les gains

Sans retour d'expérience quantitatif, **tous les leviers 2-5 restent au stade empirique**. On ne peut pas savoir si un changement de SL/TP ou de sizing améliore ou dégrade le PnL.

### Recommandations (non implémentées)

1. **Rapport de performance quotidien** : win rate, profit factor, expectancy, CAGR, max drawdown.
2. **Analyse de contribution** : PnL par trader, par tag, par durée de marché, par heure de détection.
3. **A/B test des paramètres** : faire tourner une fraction du capital en sim avec des paramètres alternatifs.
4. **Alertes de dérive** : si le win rate sur 50 trades tombe sous 45%, ou si le profit factor tombe sous 1.2, alerter.

---

## 8. Levier 7 : Fiabilité opérationnelle

### Constats

La double finalisation est un risque connu :

```85:93:packages/core/src/services/execution.service.ts
if (exec.status === 'filled' && input.status === 'filled') {
  return pos;
}
```

Ce garde n'est pas atomique avec SQLite. Si REST et WebSocket finalisent en même temps, le PnL et les frais peuvent être crédités deux fois.

Les correctifs récents ont aussi réglé :
- Positions bloquées sur marchés fermés (MF-1/2, FL-1/2)
- Reconnexion WS infinie (OPT-5)
- Circuit breaker API (OPT-4)
- Cache compteurs (OPT-2)

### Impact sur les gains

- Double finalisation : sur-estimation du PnL en sim, et potentiellement des erreurs de trésorerie en réel.
- Positions bloquées : capital inutilisable, gas gaspillé en boucles de vente.

### Recommandations (non implémentées)

1. **Rendre la finalisation idempotente** : utiliser un `INSERT OR IGNORE` ou un `UPDATE ... WHERE status != 'filled'`.
2. **Audit des positions `failed`** : FL-2 les ramasse pour redemption, mais il faut s'assurer qu'aucune n'est oubliée.
3. **Surveillance des compteurs** : vérifier que le cache `activeCountCache` ne sous-estime pas l'exposition en période de stress.

---

## 9. Matrice d'impact / effort

| Recommandation | Impact sur PnL | Effort de mise en œuvre | Priorité |
|----------------|---------------|------------------------|----------|
| Corriger / valider la redemption | Très haut | Moyen | P0 |
| Introduire un score de signal et sizing Kelly | Haut | Élevé | P1 |
| Filtrage spread/depth et score trader | Moyen-haut | Moyen | P1 |
| TP échelonné / trailing partiel | Moyen-haut | Moyen | P2 |
| Fallback REST pour entrées et correction slippage guard | Moyen | Faible | P2 |
| Tableau de bord de performance | Moyen | Moyen | P2 |
| Idempotence finalisation | Moyen | Faible | P2 |
| Maker orders | Moyen | Élevé | P3 |

---

## 10. Hypothèses et données manquantes

Pour affiner les recommandations, il faudrait disposer de :

1. **Données historiques de trades sim/réel** : win rate actuel, taille moyenne des trades, durée de détention, PnL moyen par trade.
2. **Paramètres actuels de `RiskConfig`** : SL/TP/trailing, sizing mode, capital initial.
3. **Logs d'exécution réelle** : taux de slippage, taux d'ordres non matchés, raisons d'échec.
4. **Résultats de redemption** : hash de transaction, succès/échec, montants récupérés.

Sans ces données, les estimations d'impact restent qualitatives.

---

## 11. Conclusion

Les gains de Polywatch v0.6 peuvent être significativement améliorés, mais **la première condition est que la redemption fonctionne**. Tant que les gains des marchés résolus ne sont pas récupérables de façon fiable, tous les autres leviers sont secondaires.

Une fois la redemption validée, les leviers les plus rentables sont :

1. **Un sizing intelligent basé sur l'edge** (Kelly fractionné, score de signal)
2. **Un filtrage plus strict des entrées** (spread, depth, score historique)
3. **Une gestion des sorties plus nuancée** (TP échelonné, trailing partiel)
4. **Une boucle d'analyse post-trade** pour itérer

Le code est maintenant assez solide sur l'exécution technique (CLOB v2, WS, approbations, cache). Le prochain palier de performance vient de la **qualité des décisions de trading**, pas de la fiabilité du plumbing.

---

*Document généré par analyse de code source. Aucune modification n'a été apportée au projet.*
