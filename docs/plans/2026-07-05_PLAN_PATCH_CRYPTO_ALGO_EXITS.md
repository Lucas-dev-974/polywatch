# Patch crypto-algo — sorties et config binaire

**Date** : 2026-07-05  
**Statut** : implémenté

## Résumé

- `resolveAlgoEntryExitParams` : cascade override ? table intervalle ? mode sim/real
- `preCloseHoldIfWinning` algo : défaut `false` (plus d'héritage sim)
- UI `NullableNumberField` : vide = auto, `0` = désactivé
- Retries close : propagation `lastTradePrice`

## Config recommandée (exécution manuelle)

```sql
UPDATE risk_config SET
  crypto_algo_sl_percent = NULL,
  crypto_algo_tp_percent = NULL,
  crypto_algo_trailing_stop_percent = NULL,
  crypto_algo_trailing_activation_percent = NULL,
  crypto_algo_pre_close_hold_if_winning = false,
  crypto_algo_time_exit_enabled = true;
```

`NULL` sur SL/TP = defaults table (ex. 5m : SL 12 %, TP 45 %).

## Validation post-déploiement

```bash
npm run test -w @polywatch/core -- crypto-algo-exit
npm run test -w @polywatch/worker -- position-exit-evaluator
```

Re-audit DB : `close_reason` distribué (SL / TIME_EXIT / PRE_CLOSE filled), baisse des `PRE_CLOSE_LOSS failed`.
