# Audit : Dette Technique et Risques d'Instabilité dans la Pipeline SL/TP

**Date** : 2026-07-06  
**Auteur** : Antigravity Agent  
**Portée** : Pipeline d'évaluation et de gestion des risques Stop-Loss (SL) / Take-Profit (TP) / Trailing Stop  
**Méthodologie** : Analyse statique de la codebase (`packages/core/src/risk` et `packages/worker/src/processors`) et tests de non-régression via Vitest.

---

## 1. Résumé Exécutif

Cet audit a évalué la qualité du code lié à la gestion des Stop-Loss (SL) et Take-Profit (TP) afin de repérer les points de dette technique et d'identifier des failles silencieuses ("silent failures") qui perturbaient les opérations de trading en conditions réelles (marchés binaires 5min volatiles).

Quatres anomalies majeures ont été identifiées. **Toutes ont été corrigées avec succès et validées par la suite de tests unitaires (91 tests au total avec 100% de succès dans la v1.1).**

---

## 2. Analyse des Points de Dette Technique et Risques (RÉSOLUS)

### 2.1 Masquage des pertes par fallback sur le prix d'entrée (Copy Increase Gate)
* **Statut** : 🟢 **RÉSOLU & VALIDÉ**
* **Localisation** : [`packages/worker/src/processors/copy/copy-risk-gate.ts` (L183-L206)](file:///c:/Users/lcsystem/Desktop/TradeInterface/Polytwatch%20versioning/Polywatch-v1.1/packages/worker/src/processors/copy/copy-risk-gate.ts#L183-L206)
* **Code corrigé** :
  ```typescript
  const rawBid = openPos.executableBidVwap ?? openPos.lastCloseableBidVwap ?? null;
  if (rawBid === null) {
    log.warn(
      { moveId: move.id, mode, copiedPositionId: openPos.id },
      'increase blocked — no reliable exit bid (book illiquid, no lastCloseableBidVwap)',
    );
    return {
      ok: false,
      reason: 'Augmentation bloquée — prix de sortie indisponible (marché illiquide)',
    };
  }
  ```
* **Validation** : Le fallback naïf sur `entryPrice` a été supprimé. Désormais, si le carnet est vide sur Polymarket en fin de vie, le système vérifie le dernier bid closeable connu `lastCloseableBidVwap`. Si aucune donnée n'est disponible, l'augmentation (`COPY_INCREASE`) est bloquée par mesure de sécurité pour éviter de s'exposer davantage sur une position perdante.

---

### 2.2 Perte de typage statique dans la résolution des configurations par mode
* **Statut** : 🟢 **RÉSOLU & VALIDÉ**
* **Localisation** : [`packages/core/src/risk/policy.ts`](file:///c:/Users/lcsystem/Desktop/TradeInterface/Polytwatch%20versioning/Polywatch-v1.1/packages/core/src/risk/policy.ts)
* **Code corrigé** :
  ```typescript
  export function getModeMaxOpenPositions(risk: RiskConfig, mode: TradingMode): number {
    return mode === 'sim' ? risk.simMaxOpenPositions : risk.realMaxOpenPositions;
  }
  export function getModeKillSwitchAction(risk: RiskConfig, mode: TradingMode): string {
    return mode === 'sim' ? risk.simKillSwitchAction : risk.realKillSwitchAction;
  }
  export function getModeMinTimeToClose(risk: RiskConfig, mode: TradingMode): number {
    return mode === 'sim' ? risk.simMinTimeToClose : risk.realMinTimeToClose;
  }
  export function getModeSlCloseMaxRetries(risk: RiskConfig, mode: TradingMode): number {
    return mode === 'sim' ? risk.simSlCloseMaxRetries : risk.realSlCloseMaxRetries;
  }
  ```
* **Validation** : Les fonctions d'accès dynamiques basées sur des chaînes de caractères (`pickModeValue`) ont été remplacées par des structures de contrôle explicites basées sur le type `TradingMode` pour tout le chemin SL/TP. TypeScript garantit désormais la sécurité du typage lors de la compilation.

---

### 2.3 Trailing Stop : interprétation erronée du seuil d'activation `0`
* **Statut** : 🟢 **RÉSOLU & VALIDÉ**
* **Localisation** : [`packages/core/src/risk/policy.ts`](file:///c:/Users/lcsystem/Desktop/TradeInterface/Polytwatch%20versioning/Polywatch-v1.1/packages/core/src/risk/policy.ts)
* **Code corrigé** :
  ```typescript
  export function isTrailingArmed(
    peakClosurePnlPercent: number,
    trailingActivationPercent?: number | null,
  ): boolean {
    if (trailingActivationPercent === null || trailingActivationPercent === undefined) return true;
    return peakClosurePnlPercent >= trailingActivationPercent;
  }
  ```
* **Validation** : Remplacement du test falsy (`!trailingActivationPercent`) par un test strict d'absence de valeur (`null` ou `undefined`). Ainsi, configurer un seuil d'activation de `0%` (pour armer le trailing au break-even) fonctionne correctement et n'arme plus la protection dès l'ouverture si la position débute en perte à cause des frais.

---

### 2.4 Risque de désactivation silencieuse lors de la configuration de valeurs négatives
* **Statut** : 🟢 **RÉSOLU & VALIDÉ**
* **Localisation** : [`packages/core/src/risk/policy.ts`](file:///c:/Users/lcsystem/Desktop/TradeInterface/Polytwatch%20versioning/Polywatch-v1.1/packages/core/src/risk/policy.ts)
* **Code corrigé** :
  ```typescript
  function isActiveExitThreshold(pct: number | null | undefined): pct is number {
    return pct != null && Math.abs(pct) > 0;
  }
  ```
  Et normalisation dans `evaluateSlTpTrailing` :
  ```typescript
  const sl = Math.abs(slPercent);
  const tp = Math.abs(tpPercent);
  const trailingStop = Math.abs(trailingStopPercent);
  ```
* **Validation** : Les valeurs négatives fournies par erreur par les utilisateurs (ex: `-10%` au lieu de `10%`) sont désormais détectées comme actives et converties en valeurs positives absolues à l'aide de `Math.abs()`. Cela évite la désactivation silencieuse du SL/TP.
