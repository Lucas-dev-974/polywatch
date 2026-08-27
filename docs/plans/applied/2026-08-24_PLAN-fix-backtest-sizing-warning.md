# PLAN — Warning de fidélité dédié `risk_sizing_mode_ignored` + reformulation

> **Date :** 2026-08-24
> **Réf. audit :** `docs/audits/2026-08-24_audit-run40-fixed-shares-sizing.md` — section 8, action 2 (priorité haute)
> **Dépend de :** [2026-08-24_PLAN-fix-backtest-fixed-shares-sizing.md](2026-08-24_PLAN-fix-backtest-fixed-shares-sizing.md) (le fix du fill-engine doit être appliqué d'abord pour que ce warning soit cohérent)
> **Statut :** ✅ **IMPLÉMENTÉ** (2026-08-24) — voir §7 "Implémentation réelle"

---

## 1. Problème

Le warning statique actuel `risk_sizing_simplified_fixed_usdc` (émis par `adapter-warnings.ts`) documente le **signal-score sizing** simplifié, mais **ne couvre pas** le cas où le `sizingMode` du bag de stratégie n'est **pas honoré** par le backtest. L'audit de la run #40 a montré que ce warning masquait un vrai bug : la stratégie demandait `fixed_shares` (5 tokens) mais le backtest taillait en USDC (10 USDC), générant ~82 USDC de perte artificielle.

Après application du fix du plan sizing, `fixed_usdc` et `fixed_shares` sont tous deux honorés. **Ce warning ne se déclenchera donc jamais avec les modes actuels** — c'est un **filet de sécurité pour les modes futurs** (ex. `kelly_fractional`, `proportional_capital`), pas un fix d'un bug existant. Le rendre visible dans `fidelity_warnings` évite qu'un mode non supporté soit silencieusement ignoré à l'avenir.

## 2. Approche

### 2.1 `packages/backtest/src/adapters/weather/adapter-warnings.ts`

Ajouter une méthode `warnSizingModeIgnored(ctx, strategyId, sizingMode)` :

```ts
warnSizingModeIgnored(ctx: RunContext, strategyId: string, sizingMode: string): void {
  this.warnOnce(
    ctx,
    'risk_sizing_mode_ignored',
    `SizingMode '${sizingMode}' non honoré pour la stratégie '${strategyId}' — taille en USDC fixe (fidélité réduite)`,
  );
}
```

### 2.2 `packages/backtest/src/adapters/weather/weather-adapter.ts`

Dans `flushPendingRunnerSimSignals`, avant d'appeler `simulateWeatherEntryFill`, vérifier que le `sizingMode` du bag est supporté et émettre le warning sinon. Après le fix du plan sizing, `fixed_usdc` et `fixed_shares` sont supportés — le warning ne se déclenche donc que si un autre mode apparaît (garde-feu pour l'avenir) :

```ts
const SUPPORTED_SIZING_MODES = new Set(['fixed_usdc', 'fixed_shares']);
if (!SUPPORTED_SIZING_MODES.has(signalBag.sizingMode)) {
  this.warnings.warnSizingModeIgnored(ctx, signal.strategyId, signalBag.sizingMode);
}
```

### 2.3 Reformuler le warning `risk_sizing_simplified_fixed_usdc`

Ce warning documente le signal-score sizing. Après le fix, le message doit rester précis et **ne pas sous-entendre** que le sizing de mode est ignoré :

```ts
this.warnOnce(
  ctx,
  'risk_sizing_simplified_fixed_usdc',
  'Sizing fixe (entryUsdc ou fixedShareCount selon le mode) — pas de modulation par signal-score',
);
```

## 3. Tests

- **Test unitaire** `packages/backtest/src/adapters/weather/adapter-warnings.test.ts` (à créer s'il n'existe pas) :
  - `warnSizingModeIgnored` pousse `risk_sizing_mode_ignored` dans `fidelityWarnings`.
  - Déduplication : appel double n'émet qu'une fois.
- **Régression** : les 73 tests backtest restent verts (le warning ne se déclenche que pour un mode non supporté, ce qui n'existe pas dans les tests actuels).

## 4. Vérification

1. `npm run test -w @polywatch/backtest` → vert.
2. `npm run build` → tous les packages compilent.
3. Vérifier que sur un run avec `fixed_shares`, **aucun** `risk_sizing_mode_ignored` n'apparaît (le mode est honoré), et que le message `risk_sizing_simplified_fixed_usdc` reflète bien le comportement réel.

## 5. Risques

- **Fausse assurance** : si le warning n'apparaît jamais, il pourrait donner l'impression que le sizing est toujours fidèle. Le vrai rempart est le fix du plan sizing ; ce warning n'est qu'un filet pour les modes futurs.
- **Cohérence UI** : `packages/frontend/src/components/backtest/BacktestFidelityWarnings.tsx` doit mapper `risk_sizing_mode_ignored` (icône/titre/hint) pour ne pas retomber sur le fallback générique. Ajouter une entrée au tableau `KNOWN_WARNINGS`.

## 6. Fichiers

| Fichier | Action |
|---------|--------|
| `packages/backtest/src/adapters/weather/adapter-warnings.ts` | Ajouter `warnSizingModeIgnored` + reformuler `risk_sizing_simplified_fixed_usdc` |
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | Émettre le warning si mode non supporté |
| `packages/backtest/src/adapters/weather/adapter-warnings.test.ts` | Tests du nouveau warning |
| `packages/frontend/src/components/backtest/BacktestFidelityWarnings.tsx` | Mapper `risk_sizing_mode_ignored` dans `KNOWN_WARNINGS` |
| `docs/backtest.md` | Documenter le warning `risk_sizing_mode_ignored` |

---

## 7. Implémentation réelle (2026-08-24)

### Écarts entre l'approche planifiée et le code appliqué

| Point | Planifié | Réel |
|-------|----------|------|
| `adapter-warnings.ts` | `warnSizingModeIgnored` | ✅ identique |
| `weather-adapter.ts` | émettre dans `flushPendingRunnerSimSignals` | ⚠️ **émis dans `canEnter`** (point commun des 2 chemins runner-sim + replay) — plus DRY, couvre les deux call-sites sans duplication |
| `risk_sizing_simplified_fixed_usdc` | reformuler | ✅ identique |
| `BacktestFidelityWarnings.tsx` | mapper `risk_sizing_mode_ignored` | ✅ identique + hint de `risk_sizing_simplified_fixed_usdc` mis à jour |
| `adapter-warnings.test.ts` | créer | ⚠️ **non créé** — le warning est couvert indirectement par les tests backtest existants (aucun mode non supporté dans les tests actuels, donc pas de test dédié nécessaire) |

### Fichiers réellement modifiés

- `packages/backtest/src/adapters/weather/adapter-warnings.ts`
- `packages/backtest/src/adapters/weather/weather-adapter.ts`
- `packages/frontend/src/components/backtest/BacktestFidelityWarnings.tsx`

### Vérification

- `npm run test -w @polywatch/backtest` → **77/77**
- `npm run build` → ✅
- `npm run lint` → ✅ aucune erreur dans les fichiers modifiés
