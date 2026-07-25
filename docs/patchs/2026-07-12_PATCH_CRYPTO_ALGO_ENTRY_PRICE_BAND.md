# PATCH : Bande d'entrée crypto-algo (0,50 – 0,80)

**Date** : 2026-07-12  
**Contexte** : Entrées algo sur marchés Up/Down trop chères (ex. YES > 0,80) avec faible marge résiduelle face au SL/TP bid-points. Besoin d'une règle explicite : n'entrer que si le prix du token acheté est dans une zone R:R acceptable.

## Comportement avant

- Direction via **seuil momentum** `cryptoAlgoBaseThreshold` (défaut 0,55) : YES si prix Up > 0,55, NO si prix Up < 0,45.
- **Pas de plafond** : entrées YES possibles à 0,85+.
- Zone 0,50–0,55 : abstention `neutral_zone`.

## Comportement après

Quand `cryptoAlgoEntryPriceBandEnabled = true` (défaut) :

1. **Bande sur le token acheté** (prix Up pour YES, `1 − prix Up` pour NO) :
   - Entrée si `entryPriceMin < prix < entryPriceMax` (défaut **0,50 < prix < 0,80**).
   - Abstention `price_band` hors bande (bornes strictes).
2. Le **threshold momentum est ignoré** pour la direction (spread gate inchangé).
3. **Rollback** : `cryptoAlgoEntryPriceBandEnabled = false` → comportement legacy threshold + ajustement spread.

## Matrice (defaults)

| Prix Up | Résultat |
|---------|----------|
| 0,15 | `price_band` (Down > 0,80) |
| 0,35 | Entrée **NO** |
| 0,52 | Entrée **YES** |
| 0,65 | Entrée **YES** |
| 0,85 | `price_band` |

## Fichiers modifiés

| Package | Fichiers |
|---------|----------|
| core | `RiskConfig`, migration `0056`, `crypto-algo-tunables.ts`, `config-fingerprint.ts` |
| crypto-algo | `naive-momentum.strategy.ts`, `strategy.ts`, `strategy-runner.ts`, tests |
| backend | `routes/config.ts` (Zod) |
| frontend | `CryptoAlgoSettingsGeneralTab.tsx`, `crypto-algo-settings-types.ts` |
| docs | `crypto-algo.md`, `code/07-crypto-algo.md`, `configuration.md` |

## Migration

```sql
ALTER TABLE risk_config ADD COLUMN IF NOT EXISTS crypto_algo_entry_price_min real;
ALTER TABLE risk_config ADD COLUMN IF NOT EXISTS crypto_algo_entry_price_max real;
ALTER TABLE risk_config ADD COLUMN IF NOT EXISTS crypto_algo_entry_price_band_enabled boolean;
```

Commande : `npm run migration:run -w packages/core`

## Breaking change (comportement)

- Les entrées YES **> 0,80** sont bloquées (voulu).
- La zone **0,50–0,55** devient tradable en YES (auparavant `neutral_zone`).
- Le fingerprint `cryptoAlgoConfigFingerprint` inclut les trois nouveaux champs.

## Non inclus (v1)

- Pas de gate pipeline sur `entryAskVwap` (évite signaux émis puis rejetés sans trace dans les ticks).
- `cryptoAlgoBaseThreshold` conservé en config pour le mode legacy et l'UI.
