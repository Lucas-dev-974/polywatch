# Audit — stratégie `naive-momentum` : logique, config et sur-paramétrisation

**Date** : 2026-08-05  
**Périmètre** : `packages/crypto-algo` (stratégie + runner + registry), `CryptoConfig`, pipeline entrée.  
**Conclusion** : sur-paramétrisation **confirmée** — la stratégie n'est pas du momentum sous sa config par défaut, et `crypto_config` mélange entrée, risque, sortie et infra avec des paramètres morts.

---

## 1. Verdict exécutif

Sous la config **par défaut** (`entryPriceBandEnabled = true`), `naive-momentum` n'est **pas du momentum** :

> Entrée = acheter le token dont le mid est dans une **bande de prix** `(entryPriceMin, entryPriceMax)` ; le seuil de momentum `baseThreshold` est **inerte** pour l'entrée tant que la bande est ON.

Conséquences :
1. **Dérive sémantique** : le nom, la doc et la UI décrivent du momentum alors que l'entrée est un filtre de prix.
2. **Sur-paramétrisation** : `crypto_config` ~50 colonnes ; la stratégie en consomme ~13. Le reste est risque / sortie / sizing / infra sur la même table.
3. **Config morte** : au moins 3 champs n'ont aucun effet (`minBidToAskRatio`, `allowedMarketTags`, `signalScoreSizingEnabled`).

La dernière session auditée (#106) confirme le symptôme : 100 % des entrées en 0,50–0,65, **WR 36–50 %** sous le seuil de rentabilité → P&L négatif sur chaque bucket.

---

## 2. Ce que fait réellement l'entrée (ordre d'évaluation)

Décision dans `naive-momentum.strategy.ts` (L237–322) :

1. **Direction** = bande de prix (défaut) **ou** seuil legacy.
2. Livre **bilateral frais** requis sur le token acheté (`illiquid_book` / `stale_book` sinon abstention).
3. **Filtre courbe descendante** (optionnel) sur l'historique du mid acheté.
4. **Spread** ≤ max par intervalle.
5. *(legacy only)* seuil relevé par `base + spreadAbs × factor`.

```237:322:packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts
    if (this.config.entryPriceBandEnabled) {
      candidate = resolveEntryCandidateFromBand(price, this.config.entryPriceMin, this.config.entryPriceMax);
      if (!candidate) return { kind: 'abstain', reason: 'price_band', ... };
    } else {
      const base = this.config.baseThreshold;
      if (price > base) candidate = 'YES';
      else if (price < 1 - base) candidate = 'NO';
      else return { kind: 'abstain', reason: 'neutral_zone' };
    }
```

---

## 3. Les paramètres que la stratégie lit réellement

| Champ | Rôle | Entrée ? | Sens pour « naive momentum » |
|---|---|---|---|
| `entryPriceBandEnabled` | bascule bande vs seuil | **Y** | **Orthogonal / nom trompeur** — ON = entrée par bande, pas momentum |
| `entryPriceMin / Max` | bornes exclusives | **Y** | bande : Y / momentum : N |
| `baseThreshold` | YES si `>base`, NO si `<1−base` | **Y si bande OFF** | Y legacy ; **inerte sous défaut** |
| `spreadAdjustmentFactor` | `threshold = base + spread × factor` | **Y si bande OFF** | Y legacy ; inerte sous défaut |
| `minSpreadAbsForAdjustment` | seuil spread avant ajustement (+ confiance) | bande OFF (+ soft) | mixte |
| `maxSpreadAbs` / `spreadAbsByInterval` | gate liquidité | **Y** | orthogonal, utile |
| `curveFilterEnabled` / `curveLookbackMs` / `curveMinDelta` | blocage mid descendant | **Y si ON** | orthogonal (anti-chase) |
| `priceSumTolerance` | YES+NO ≈ 1 (Gamma) | **Y** (Gamma) | orthogonal qualité donnée |
| `warnPriceDeviation` | log écart WS/Gamma | N (warn) | orthogonal observabilité |
| `maxBookAgeMs` | fraîcheur prix/book | **Y** | orthogonal infra |

**Minimum réellement utile** selon le mode retenu : bande → `min/max` ; legacy → `baseThreshold` (+ option spread). Le reste est qualité / add-on.

---

## 4. Cartographie complète de `crypto_config`

**A. Entrée / stratégie** (~13 champs, table §3).

**B. Post-signal — risque / sortie / infra sur la même table** (non stratégie) : re-entry throttle, SL quota, `minTimeToClose`, sizing, `maxOpenPositions` / `maxExposureUsdc` / `maxPositionSizeUsdc`, `maxDailyLossUsdc` + kill-switch, SL/TP/trailing (+ par intervalle), pre-close, `slConfirmationTicks`, `slCloseMaxRetries`, entry depth retries, Gamma/WS/poll/tick infra, cleanup, `simInitialCapitalCrypto`.

**C. Config morte ou décorative** :

| Champ | Preuve |
|---|---|
| `minBidToAskRatio` | `getCryptoMinBidToAskRatio` défini, **jamais appelé** |
| `signalScoreSizingEnabled` | hardcodé `false` dans `getCryptoAlgoSizingParams` |
| `allowedMarketTags` | sérialisé dans l'API seulement, aucun filtre |
| `baseThreshold` + `spreadAdjustmentFactor` (sous bande ON) | chargés mais **skipped** pour l'entrée |

---

## 5. Sur-paramétrisation — évaluation

**Oui.** Indices :
- ~50 colonnes ; la stratégie en consomme ~13.
- Le mode par défaut rend le **nom faux** (bande ≠ momentum).
- **Deux modes d'entrée** (bande + legacy + seuil ajusté) → boutons sans effet silencieux.
- 3 champs **morts** qui polluent UI/API.
- `config-fingerprint` mélange stratégie + sortie + sizing → impossible d'A/B tester la stratégie seule.

---

## 6. Constat complémentaire

6.1 **Filtre courbe fail-open** quand l'historique est insuffisant (stratégie L290–297) — « enabled » mais ne bloque pas juste après subscribe.  
6.2 **Tie bande → YES préféré** si les deux mids tombent dans la bande.  
6.3 **Confidence inutilisée** pour le sizing (signal score décoratif).  
6.4 **Registry single-tenant** : `cryptoAlgoStrategies` suggère le plug-in, une seule implémentation existe.  
6.5 **First-wins** sur les stratégies — dangereux si une 2ᵉ est ajoutée sans priorité explicite.  
6.6 **Sortie co-localisée avec l'entrée** — modifier la « stratégie » change aussi SL/TP/trailing.

---

## 7. Todolist (actions proposées)

Priorité **P0** (cohérence / stop bleed) :

- [ ] **P0-1** Renommer ou clarifier le mode d'entrée : soit afficher « Price-band entry » quand `entryPriceBandEnabled`, soit remettre la bande OFF par défaut si on veut du vrai momentum. *(décision produit)*
- [ ] **P0-2** Documenter/griser les knobs legacy (`baseThreshold`, `spreadAdjustmentFactor`) quand la bande est ON — sinon l'opérateur croit régler le momentum alors que c'est sans effet.
- [ ] **P0-3** Figer les sorties par stratégie : séparer explicitement config d'entrée et config de sortie (prépare le support multi-stratégies).

Priorité **P1** (hygiène config) :

- [ ] **P1-1** Supprimer ou implémenter `minBidToAskRatio` (actuellement mort).
- [ ] **P1-2** Supprimer ou implémenter `allowedMarketTags` (mort).
- [ ] **P1-3** Supprimer ou câbler `signalScoreSizingEnabled` (hardcodé false).
- [ ] **P1-4** Rendre le filtre courbe **fail-closed** (ou explicite) quand l'historique est insuffisant.
- [ ] **P1-5** Documenter le tie-band (YES préféré) ou le rendre déterministe neutre.

Priorité **P2** (architecture) :

- [ ] **P2-1** Introduire un bag JSON par stratégie (`strategy_params`) pour éviter l'ajout de colonnes plates à chaque nouvelle stratégie.
- [ ] **P2-2** Rendre `applyRiskTunables` générique (registry-driven) au lieu du hardcode `NaiveMomentumStrategy`.
- [ ] **P2-3** Définir la politique de priorité quand plusieurs stratégies sont actives (first-wins actuel).

---

## 8. Références

- Stratégie : `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`
- Gate courbe : `packages/crypto-algo/src/curve-descending-gate.ts`
- Mapping config : `packages/core/src/risk/crypto-algo-tunables.ts` (`resolveNaiveMomentumConfig`)
- Runner / registry : `packages/crypto-algo/src/strategy/strategy-runner.ts`, `registry.ts`
- Entité : `packages/core/src/entities/CryptoConfig.ts`
- Session de référence : `docs/audits/2026-08-04_audit-crypto-algo-session-sim-active.md` (#106)
