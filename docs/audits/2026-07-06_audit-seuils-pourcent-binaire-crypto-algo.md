# Audit : Adùquation des seuils SL/TP % aux marchùs binaires crypto-algo 5m

**Date** : 2026-07-06
**Auteur** : Cursor Agent
**Portùe** : Positions sim `reason = 'ALGO_OPEN'`, marchùs Polymarket `*-updown-5m` (binaires Up/Down 5 minutes)
**Mùthodologie** : Revue statique du code (`packages/core/src/risk/policy.ts`, `packages/core/src/pricing/vwap.ts`, `packages/core/src/risk/crypto-algo-exit.ts`, `packages/core/src/services/execution.service.ts`, `packages/worker/src/processors/strategy/position-exit-evaluator.ts`) + vùrification croisùe des audits antùrieurs (`2026-07-03_audit-close-reasons-sim-crypto-algo.md`, `2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md`) et de leurs outils de gùnùration (`tools/audit-crypto-algo-exits.ts`, `tools/audit-crypto-algo-exits-detail.ts`, `tools/audit-redemption-sl-miss.ts`).

**Documents liùs** :
- Audit antùrieur : `2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md`
- Patch antùrieur implùmentù : `../patchs/2026-07-05_PATCH_SORTIES_BINAIRE_CRYPTO_ALGO.md` (P0 + P1 faits, P2 en attente)
- Patch implùmentù : `../patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md` (P3 ù SL/TP en bid absolu)
- Audit post-P3 : `2026-07-06_audit-vwap-quantite-declenchement-sl-tp-crypto-algo.md` (SL/TP absolu non dùclenchù ù ùcart VWAP)
- Patch proposù : `../patchs/2026-07-06_PATCH_VWAP_DECLENCHEMENT_PROFONDEUR.md` (P4)

---

## 1. Rùsumù exùcutif

| Verdict | Dùtail |
|---|---|
| Formules de calcul (trigger/closure/SL/TP) | **Correctes** ù vùrifiùes contre le code |
| Logique hybride SL OR / TP AND / trailing | **Cohùrente** ù vùrifiùe contre le code |
| Bugs structurels des audits prùcùdents | **Corrigùs** (suppressSlTp, settled early-return) |
| Adùquation seuils % aux marchùs binaires [0,1] | **Sous-optimale** ù 4 consùquences concrùtes confirmùes |
| Action recommandùe | Patch P3 : SL/TP en bid absolu (points de probabilitù) |

Les formules et la logique sont mathùmatiquement correctes. Le problùme restant est **sùmantique** : exprimer SL/TP en pourcentage relatif sur un token dont le prix est une probabilitù bornùe [0,1] produit 4 consùquences concrùtes observùes en session sim.

---

## 2. Vùrification des formules et de la logique

### 2.1 Formules de PnL ù confirmùes

```106:117:packages/core/src/pricing/vwap.ts
export function triggerPnlPercent(
  executableBidVwap: number,
  entryBidVwap: number,
): number {
  if (entryBidVwap === 0) { return 0; }
  return ((executableBidVwap - entryBidVwap) / entryBidVwap) * 100;
}
```

```140:152:packages/core/src/pricing/vwap.ts
export function closurePnlPercent(
  executableBidVwap: number,
  entryPrice: number,
  entryFeesRemaining = 0,
  entryQuantityRemaining = 0,
): number {
  if (entryPrice === 0) return 0;
  const costBasisPerShare =
    entryQuantityRemaining > 0
      ? entryPrice + entryFeesRemaining / entryQuantityRemaining
      : entryPrice;
  return ((executableBidVwap - costBasisPerShare) / costBasisPerShare) * 100;
}
```

### 2.2 Logique SL/TP/trailing ù confirmùe

```414:435:packages/core/src/risk/policy.ts
  // SL: Hybrid OR ù fires if market OR closure breaches threshold
  if (isActiveExitThreshold(slPercent)) {
    if (effectiveTrigger <= -slPercent || effectiveClosure <= -slPercent) {
      return 'SL';
    }
  }
  // TP: Hybrid AND ù only fires if BOTH market AND closure confirm gain
  if (isActiveExitThreshold(tpPercent)) {
    if (effectiveTrigger >= tpPercent && effectiveClosure >= tpPercent) {
      return 'TP';
    }
  }
  // Trailing: Uses closure-based peak and drawdown
  if (
    isActiveExitThreshold(trailingStopPercent) &&
    isTrailingArmed(peakClosurePnlPercent, trailingActivationPercent) &&
    peakClosurePnlPercent - effectiveClosure >= trailingStopPercent
  ) {
    return 'TRAILING';
  }
```

`isActiveExitThreshold(pct) = pct != null && pct > 0` ? `0` = dùsactivù, `null` = hùriter. Prioritù fixe : SL ? TP ? trailing.

### 2.3 Bugs des audits prùcùdents ù corrigùs

**Bug A (03/07 ù3.2)** : `suppressSlTp` dùsactivait le SL dùs `endDate`. Corrigù :

```46:53:packages/core/src/positions/redemption-wait.ts
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;
  return false;
}
```

**Bug B (05/07 ù6.5)** : `if (settled) return tick` coupait toute ùvaluation. Corrigù :

```330:336:packages/worker/src/processors/strategy/position-branches.ts
  if (
    settled &&
    (pos.status !== 'open' ||
      !canStillExitViaClob(pos, bookPrices, wsBestBid, lastTradePrice))
  ) {
    return tick;
  }
```

### 2.4 Conformitù aux seuils (audit 05/07)

Sur **7 364 ticks** analysùs : **0 violation SL** (trigger OU closure ? ?15 % sans `close_reason = SL`). Quand le worker voit le bon mark, le SL respecte les seuils configurùs. Les anomalies viennent de non-ùvaluation ou de seuils inadaptùs, pas d'une mauvaise formule.

---

## 3. Le problùme : seuils % relatifs sur un token bornù [0,1]

### 3.1 Modùle Polymarket

Chaque position dùtient un token (Up/Yes ou Down/No), prix ? [0, 1] USDC (probabilitù implicite). Rùsolution : token gagnant ? 1, perdant ? 0 (`getRedemptionPayoff` dans `packages/core/src/market/lifecycle.ts:71-74`).

L'algo entre via `naive-momentum` sur le token YES ou NO ; SL/TP s'appliquent au **bid VWAP de ce token**, pas au spot crypto.

### 3.2 Les seuils sont en % relatif du bid

```typescript
// triggerPnlPercent : variation relative du bid vs entryBidVwap
((executableBidVwap - entryBidVwap) / entryBidVwap) * 100

// evaluateSlTpTrailing : compare des % relatifs
SL : trigger <= -slPercent OR closure <= -slPercent
TP : trigger >= tpPercent AND closure >= tpPercent
```

Un SL de 15 % signifie ù le bid a chutù de 15 % par rapport ù l'entry bid ù. Mais sur un token ù 0,40 vs 0,85, ù 15 % ù ne reprùsente pas le mùme risque absolu.

---

## 4. Consùquences concrùtes confirmùes

### 4.1 SL inùgal selon le prix d'entrùe ù confirmù

Le mùme ù SL 15 % ù ne couvre pas le mùme risque absolu :

| Entry | SL 15 % ? bid dùclenchement | Points de proba perdus avant coupe |
|-------|------------------------------|-------------------------------------|
| 0,40 | 0,34 | **?6 pts** |
| 0,55 | 0,47 | ?8 pts |
| 0,85 | 0,72 | **?13 pts** |

? Quand l'entrùe est chùre (cas frùquent : le momentum entre du cùtù dùjù favorisù, entrùes observùes 0,53ù0,88), le SL laisse perdre **2ù plus** en absolu avant de couper. La protection est la plus faible lù où le token peut le plus s'effondrer vers 0.

**Source** : `2026-07-05_audit...md` ù5.4 (table chiffrùe) + ù5.3 line 121. Entrùes 0,53ù0,88 confirmùes ù5.4 derniùre ligne.

### 4.2 Whipsaw : SL dùclenchù sur du bruit ù confirmù

Sur un marchù 5m, le bid oscille de plusieurs points par bruit + spread. Un SL 15 % relatif sur un token ù 0,55 = ~8 pts. Un aller-retour de bruit suffit ù franchir le seuil.

**Cas vùrifiù ù Position 16041** (`2026-07-05_audit...md` ù6.3) :

```163:167:docs/audits/2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md
### 6.3 SL avec PnL positif (id 16041)

- Entry 0,72, fill SL **0,999**, PnL **+1,15 USDC**.
- Signal SL ùmis sur dip trigger ; fill simulù au prix de marchù gagnant en fin de vie.
- Label `SL` correct cùtù signal ; rùsultat ùconomique contre-intuitif.
```

Le label `SL` est ùmis sur une oscillation transitoire alors que la position ùtait en rùalitù gagnante (fill final 0,999, PnL +1,15 USDC). Le SL se dùclenche ù un mauvais moment sur du bruit, pas sur une vraie dùgradation.

### 4.3 SL trop tard ? REDEMPTION perte totale ù confirmù (avec nuance)

Sur un binaire, ù l'approche de `endDate`, le cùtù perdant s'effondre en quelques secondes. Le prix saute les paliers trop vite pour qu'un fill SL parte au niveau configurù, ou le marchù est dùjù `settled`/illiquide ? aucune contrepartie ? REDEMPTION `no_payout` = perte totale.

**Cas vùrifiù ù Position 16029** (`2026-07-05_audit...md` ù6.4) :

```169:186:docs/audits/2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md
### 6.4 REDEMPTION ù 3 cas (dont 2 en perte)

| ID | PnL | Exùcution | Sec aprùs `endDate` |
|---|---|---|---|
| 16029 | -2,06 | `no_payout` | 392 |
| 16036 | -1,96 | `no_payout` | 353 |
| 16039 | +0,39 | fill 1,00 | 469 |

#### Position 16029 ù SL aurait dù partir

Ticks T-120s ù T-90s :

| Moment | Bid | PnL trigger |
|---|---|---|
| 09:18:00 | 0,42 | **-27,6 %** |
| 09:18:16 | 0,29 | **-50,3 %** |

Seuil SL : -15 %. **Aucun SELL** tentù avant REDEMPTION.
```

**Nuance importante** : la position **16036** (?1,96 USDC, `no_payout`) n'a **pas** franchi le SL (drawdown max ?12,8 % < ?15 %). Sa perte vient d'un **TIME_EXIT manquù sur mark stale**, pas d'un SL tardif (`2026-07-05_audit...md` ù6.4 second sous-bloc). Le symptùme (REDEMPTION en perte totale) est le mùme, mais le mùcanisme diffùre. Ne pas regrouper 16036 avec 16029 sous ù SL trop tard ù.

### 4.4 TP mathùmatiquement impossible ù confirmù

Le plafond du prix est 1,0. Un TP +50 % depuis une entrùe > 0,667 exigerait un bid > 1,0 :

| Entry | TP 50 % ? bid requis | Atteignable ? |
|-------|----------------------|----------------|
| 0,55 | 0,83 | oui |
| 0,70 | 1,05 | **non** |
| 0,85 | 1,28 | **non** |

**Source** : `2026-07-05_audit...md` ù5.4 + ù5.3 line 122 (ù Inatteignable si entry > ~0,67 ù).

**Cas vùrifiù ù 4 positions au pic > 50 % sorties en TIME_EXIT** (`2026-07-05_audit...md` ù6.2) :

```152:160:docs/audits/2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md
### 6.2 Peak >= 50 % fermùes en TIME_EXIT (4 cas)

| ID | Peak closure % | Close | PnL |
|---|---|---|---|
| 16042 | 68,6 | TIME_EXIT | +1,41 |
| 16040 | 67,3 | TIME_EXIT | +1,35 |
| 16043 | 65,8 | TIME_EXIT | +1,35 |
| 16028 | 52,3 | TIME_EXIT | +1,04 |
```

Le pic a dùpassù le seuil TP, mais au moment TIME_EXIT les conditions TP hybrides (AND) ou le plafond [0, 1] ne sont plus rùunies. Les positions gagnantes ne sùcurisent jamais via TP ; elles dùpendent du TIME_EXIT ou retombent. Le TP est quasi dùcoratif (1 dùclenchement sur 19, soit 5,3 %).

---

## 5. Distribution des sorties (session sim 05/07)

```43:50:docs/audits/2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md
| `TIME_EXIT` | 10 | 52,6 % |
| `SL` | 5 | 26,3 % |
| `REDEMPTION` | 3 | 15,8 % |
| `TP` | 1 | 5,3 % |
| `PRE_CLOSE_LOSS` / `PRE_CLOSE_WIN` | 0 | 0 % |
| `TRAILING` | 0 | 0 % |
```

TIME_EXIT domine (52,6 %) ù signe que le SL/TP % ne fait pas son travail de gestion intermùdiaire. REDEMPTION encore 15,8 % dont 2 pertes totales.

---

## 6. Pourquoi le % relatif est inadùquat sur un binaire [0,1]

| Aspect | % relatif | Points absolus (proposù) |
|---|---|---|
| Sens du seuil | Dùpend de l'entry | Uniforme |
| SL ù entry 0,40 | bid 0,34 (?6 pts) | bid 0,30 (?10 pts) |
| SL ù entry 0,85 | bid 0,72 (?13 pts) | bid 0,75 (?10 pts) |
| TP ù entry 0,70 | bid 1,05 (impossible) | bid 0,82 (+12 pts) |
| Plafond 1,0 | Non gùrù (TP unreachable) | Cap naturel via `min(entry+pts, 0,99)` |
| Whipsaw | Seuil trop fin en bas | Seuil uniforme |
| Convergence 0/1 | SL saute paliers | Mùme problùme (vitesse), mais seuil plus prùvisible |

Le % relatif signifie ù quelque chose de diffùrent ù chaque prix d'entrùe ù : trop serrù en bas (whipsaw), trop lùche en haut (protùge mal), et le TP symùtrique en % est carrùment inatteignable dans la moitiù haute de [0,1].

---

## 7. Vùrification infrastructure (rien n'existe dùjù)

| Item | Statut | Localisation |
|---|---|---|
| Fonction `gainMax` / `payoffCap` / `binaryCap` | **NOT FOUND** | ù |
| `min(1, entry+gain)` / TP cap dans le code risk | **NOT FOUND** | ù |
| Champ SL/TP absolu dans `RiskConfig` | **NOT FOUND** (only `*_percent`) | `packages/core/src/entities/RiskConfig.ts:312-326` |
| Mode ù points absolus ù / ù price delta ù | **NOT FOUND** | ù |
| Modùle binaire 0/1 ù la rùsolution | **EXISTS** | `packages/core/src/positions/mark.ts:58-61`, `packages/core/src/market/lifecycle.ts:71-74` |
| TP-cap P2 (plafonnù vers 1,0) | PROPOSED, **non implùmentù** | `2026-07-05_PATCH...md` |
| Points absolus P3 | **Diffùrù** (ù Hors scope ù) | `2026-07-05_PATCH...md` |
| Tests TP unreachable / entry near 1,0 | **NOT FOUND** | `policy.test.ts`, `crypto-algo-exit.test.ts` |
| UI mode absolu / points | **NOT FOUND** (champs % only) | `CryptoAlgoSettingsExitTab.tsx:26-69` |

? Un patch implùmentant les points absolus **ne dupliquerait pas** de code existant.

---

## 8. Synthùse

| Mùcanisme | ùtat | Action |
|---|---|---|
| Formules trigger/closure/PnL | ? Correct | Aucune |
| Logique SL OR / TP AND / trailing | ? Cohùrente | Aucune |
| Bugs structurels (suppressSlTp, settled) | ? Corrigùs (P0/P1) | Aucune |
| SL % inùgal selon entry | ?? Design | P3 : seuils absolus |
| SL whipsaw sur bruit | ?? Design | P3 : seuils absolus |
| SL tardif ? REDEMPTION perte | ?? Partiellement attùnuù (P1a) | P3 + durcir mark fin de vie |
| TP impossible > 0,667 | ?? Design | P3 : cap `min(entry+pts, 0,99)` |

**Verdict** : les calculs et la logique sont corrects. Le problùme restant est l'**adùquation sùmantique** des seuils % aux marchùs binaires. La correction de fond est le patch **P3 : SL/TP en bid absolu (points de probabilitù)**, qui subsume le P2 (TP plafonnù) encore en attente.

---

## 9. Recommandation

Implùmenter le patch **P3** dùcrit dans `../patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md` :

- Config en points de probabilitù (delta depuis `entryBidVwap`)
- Calcul du seuil absolu au **fill** (pas ù la rùservation, car `entryBidVwap = 0` ù ce stade)
- Cap TP ù **0,99** (pas 1,0 ù sinon unreachable)
- Garde binaire : seuils absolus uniquement si `byInterval != null`
- Garde frais sur TP absolu (`closurePnl >= 0`) pour ùviter de vendre ù un gain comptable ùvaporù par les frais
- Coexistence avec le mode % (fallback si `slBidAbsolute = null`)

**Critùres de validation post-patch** :
- `npx tsx tools/audit-crypto-algo-exits.ts` : TP > 5 %, REDEMPTION en perte = 0
- `npm run test -w @polywatch/core -- policy crypto-algo-exit execution.service`
- Aucune position non-binaire (sans interval) ne reùoit `slBidAbsolute` non-null

---

## 10. Outils d'audit

| Script | Rùle |
|---|---|
| `tools/audit-crypto-algo-exits.ts` | Distribution sorties, conformitù SL/TP ticks, config |
| `tools/audit-crypto-algo-exits-detail.ts` | REDEMPTION, peak vs TP, SL-with-positive-PnL |
| `tools/audit-redemption-sl-miss.ts` | Analyse tick-level des REDEMPTION en perte |

---

## 11. Rùfùrences

- Audit 03/07 : `2026-07-03_audit-close-reasons-sim-crypto-algo.md` (100 % REDEMPTION, prù-corrections)
- Audit 05/07 : `2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md` (post P0/P1, 4 consùquences identifiùes)
- Patch 05/07 : `../patchs/2026-07-05_PATCH_SORTIES_BINAIRE_CRYPTO_ALGO.md` (P0 + P1 implùmentùs, P2 en attente)
- Patch 06/07 : `../patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md` (P3 implùmentù)
- Audit post-P3 : `2026-07-06_audit-vwap-quantite-declenchement-sl-tp-crypto-algo.md` (ùcart VWAP dùclenchement)
- Patch P4 : `../patchs/2026-07-06_PATCH_VWAP_DECLENCHEMENT_PROFONDEUR.md` (proposù)
- Code : `packages/core/src/risk/policy.ts` (`evaluateSlTpTrailing`), `packages/core/src/pricing/vwap.ts` (`triggerPnlPercent`, `closurePnlPercent`), `packages/core/src/risk/crypto-algo-exit.ts` (`CRYPTO_INTERVAL_EXIT_DEFAULTS`, `resolveAlgoEntryExitParams`)