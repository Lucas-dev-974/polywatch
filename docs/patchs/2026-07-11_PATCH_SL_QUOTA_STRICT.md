# PATCH : Quota SL strict — crypto-algo

**Date** : 2026-07-11  
**Contexte** : Marché BTC 5m — quota SL à 1, mais 2 positions SL (YES + NO) sur le même `conditionId` car la 2ᵉ entrée passait avant la clôture SL de la 1ʳᵉ.

## Comportement avant

- Compteur SL basé surtout sur `close_reason = 'SL'` (clôture finale).
- Pas de limite cross-outcome : YES et NO pouvaient coexister.
- Une entrée NO pouvait passer tant que le SL de YES n'était pas encore comptabilisé.

## Comportement après

Quand `cryptoAlgoSlQuotaEnabled = true` :

1. **Slot consommé dès `beginClose(SL)`** — colonne `copied_positions.closing_reason`.
2. **Max 1 position algo `open`/`closing` par marché** — blocage cross-outcome.
3. Abstention `sl_quota_reached` avec détail :
   - `open_position_on_market`
   - `sl_slots_consumed`

## Fichiers modifiés

| Package | Fichiers |
|---------|----------|
| core | Migration `0048`, `CopiedPosition`, `copied-position.service`, `execution.service`, `RiskConfig` JSDoc |
| crypto-algo | `sl-quota.ts`, `strategy-runner.ts`, tests |
| frontend | `CryptoAlgoSettingsGeneralTab.tsx` |
| docs | `crypto-algo.md`, `configuration.md`, `modele-donnees.md` |

## Migration

```sql
ALTER TABLE copied_positions
  ADD COLUMN IF NOT EXISTS closing_reason text NULL;
```

## Breaking change

Les marchés Up/Down ne peuvent plus avoir YES + NO simultanément quand le quota SL est activé.
