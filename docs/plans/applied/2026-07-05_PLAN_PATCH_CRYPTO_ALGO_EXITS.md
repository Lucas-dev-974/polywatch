# Sorties fin de marché — pre-close unique (plus de phase SOFT / HARD)

**Date** : 2026-07-05 (réécrit 2026-08-07)  
**Statut** : **appliqué** (naming + purge `TIME_EXIT`)

## Objectif

Retirer le modèle à deux phases (SOFT + HARD / `TIME_EXIT`) et ne garder que le
**pre-close** configurable par algo (crypto, copy, weather).

**SL / TP / trailing restent** (phase liquide).

## Livré 2026-08-07

- [x] UI crypto : plus de « phase SOFT » ; Activée / Désactivée
- [x] UI weather : « Pré-clôture (heures avant fin) » + labels `WEATHER_PRE_CLOSE`
- [x] Docs actives (`crypto-algo.md`, `weather-algo.md`, `docs/code/*`, `metrics.md`)
- [x] Purge tests `it.skip` TIME_EXIT (worker + e2e)
- [x] Purge références TIME_EXIT dans tests actifs, outils audit, commentaires
- [x] `OrderReason` sans `TIME_EXIT` (déjà le cas)
- [x] Fix null?false : fenêtre d'entrée / refresh indépendante du flag vente
- [x] Badges surveillance weather + métrique `WEATHER_PRE_CLOSE`
- [x] Hygiène : retrait param `mode` mort de `resolveAlgoEntryExitParams`

## Conservé volontairement

- Migrations historiques `AddCryptoAlgoTimeExit*` / mentions dans
  `AlignRiskConfig*` — ne pas réécrire l'historique TypeORM
- Audits / patchs datés sous `docs/audits`, `docs/v1`, `docs/patchs`,
  `docs/plans/archived` (historique)

## UI par algo

| Algo | UI | Motif(s) |
|---|---|---|
| Copy | `PreCloseSection` | `PRE_CLOSE_LOSS` / `PRE_CLOSE_WIN` |
| Crypto | `CryptoAlgoSettingsExitTab` | `PRE_CLOSE_LOSS` / `PRE_CLOSE_WIN` |
| Weather | Settings weather | `WEATHER_PRE_CLOSE` |

## Validation

```bash
npm run test -w @polywatch/core -- exit-decision
npm run test -w @polywatch/worker -- position-exit-evaluator
npm run test -w @polywatch/worker -- strategy-cycle-metrics
npm run test -w @polywatch/worker -- execution-result
```
