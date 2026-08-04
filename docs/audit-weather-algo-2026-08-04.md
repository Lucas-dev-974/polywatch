# Audit Weather-Algo — 4 août 2026

> Rapport d'audit complet du module de trading algorithmique météo (`@polywatch/weather-algo`).
> Données extraites en BDD PostgreSQL via `tools/weather-algo-audit.ts` le
> **2026-08-04 07:25 UTC**. Toutes les positions `reason = 'WEATHER_OPEN'` ont
> été récupérées avec leurs forecasts, exécutions, marchés et configuration.

---

## 0. Statut post-correctifs (mise à jour 10:20 UTC)

Les correctifs P0/P1/P2 ont été implémentés dans le code ET appliqués en BDD.
Audit re-généré à 08:22 UTC — les 80 positions existantes sont inchangées
(les configs s'appliquent aux futurs signaux ; les sorties se déclencheront
au prochain cycle via l'exit evaluator).

### Correctifs code (déjà fusionnés)

| # | Volet | Fichier | Correction |
|---|---|---|---|
| P0-a | Win 0 % | `WeatherConfig.ts` + migration 0092 | Colonne `weatherAlgoMinForecastProbability` (filtre long-shots) |
| P0-a | Win 0 % | `weather-forecast.strategy.ts` | Check `forecast_probability_below_min` avant le gate d'edge |
| P0-b | Cancellation | `reservation.service.ts` | `release(reason)` + log pino attribuant chaque `reservation_released` |
| P0-b | Cancellation | `execution.service.ts` | Set `closeReason` sur échec BUY (corrige les 20 "no reason") |
| P0-b | Cancellation | `executor.ts`, `entry-enqueue-result.ts`, etc. | `releaseReason` descriptif à tous les callers |

### Configs appliquées en BDD (`tools/apply-weather-algo-fixes.ts`)

| Paramètre | Avant | Après | Volet |
|---|---|---|---|
| `weather_algo_poll_ms` | 10000 | **1800000** (30 min) | P1-a |
| `weather_algo_max_forecast_std` | null | **1.5** | P1-b |
| `weather_algo_min_forecast_probability` | null | **0.30** | P0-a |
| `weather_algo_pre_close_enabled` | false | **true** | P1-c |
| `weather_algo_city_follow_switch_mode` | hold | **close_and_reenter** | P2-a |
| `weather_algo_sl_enabled` | false | **true** (0.2 bid pts) | P2-b |
| `weather_algo_tp_enabled` | false | **true** (1 bid pt) | P2-b |

### Vérifications post-correctifs

- Migration `AddWeatherAlgoMinForecastProbability1700000000092` : **appliquée** ("Database migrated").
- Tests : **44/44 passent** (4 fichiers, dont 3 nouveaux tests `minForecastProbability`).
- TypeScript : `core`, `weather-algo`, `worker` compilent sans erreur.
- Lints : aucun erreur sur les 13 fichiers modifiés.
- Config lue en BDD à 08:22 UTC : `poll_ms=1800000`, `max_forecast_std=1.5`, `switch_mode=close_and_reenter` — confirmés.

### Reste à faire

- **Observation** : laisser tourner l'algo quelques cycles (30 min) puis re-générer l'audit pour vérifier que (1) plus de long-shots, (2) les nouvelles cancellations sont attribuées dans les logs pino, (3) les sorties SL/TP/pre-close/bucket-exit se déclenchent sur les 18 positions ouvertes.
- **P3** : ajouter une métrique Prometheus `weather_open_positions` / `weather_pnl` labellisées (toujours ouvert).
- **P3** : investiguer le slippage 96 % sur pos#29557 (toujours ouvert).

---

## 1. Synthèse exécutive

| Indicateur | Valeur |
|---|---|
| Positions auditées | **80** (toutes `mode = sim`) |
| Règles auto-track (villes) | **49**, toutes `highest_temp`, `look_ahead = 2d`, enabled |
| Positions ouvertes | **18** |
| Positions fermées | **2** (close `MANUAL`) |
| Positions annulées | **60** (`reservation_released` ×37, `reservation_expired` ×3, sans reason ×20) |
| PnL réalisé cumulé (sim) | **−0,48 USDC** |
| PnL non réalisé cumulé (sim) | **−6,60 USDC** |
| Trades gagnants | **0** / trades perdants **20** |
| Exécutions | **42** (22 filled, 20 failed) |
| Slippage moyen | **9,79 %** (27 exécutions) |
| Total fees | **1,00 USDC** |
| Notional ouvert | **18,74 USDC** |

**Verdict immédiat :** l'algorithme est **actif mais n'a généré aucun trade
gagnant** sur la fenêtre observée. 100 % des 20 positions évaluables (ouvertes
+ fermées) sont en PnL négatif. Les 60 positions annulées correspondent à des
réservations relâchées (signal d'entrée émis puis abandonné) — signe d'un
pipeline d'entrée qui tente beaucoup, confirme peu.

---

## 2. Configuration active (`weather_config`)

| Paramètre | Valeur | Observation |
|---|---|---|
| `weather_algo_enabled` | `true` | Algo actif |
| `weather_algo_sim_enabled` | `true` | Mode sim actif |
| `weather_algo_real_enabled` | `false` | Réel désactivé (cohérent : 0 pos real) |
| `weather_algo_min_edge` | `0.1` | Edge YES minimum 10 % |
| `weather_algo_max_forecast_std` | `null` | **Aucun filtre d'incertitude** — voir §6 |
| `weather_algo_poll_ms` | `10000` | **10 s** (défaut doc 30 min) — polling très agressif |
| `weather_algo_sizing_mode` | `fixed_usdc` | Taille fixe |
| `weather_algo_entry_usdc` | `1` | **1 USDC** par entrée (très faible) |
| `weather_algo_selection_mode` | `multi` | Multi-villes |
| `weather_algo_max_signals_per_event` | `20` | Jusqu'à 20 signaux/vague |
| `weather_algo_max_open_positions` | `40` | Plafond 40 positions |
| `weather_algo_max_exposure_usdc` | `1000` | Plafond exposition 1000 USDC |
| `weather_algo_city_follow_switch_mode` | `hold` | **Pas de close sur bucket leave** |
| `weather_algo_bucket_hysteresis_polls` | `2` | 2 polls consécutifs pour bucket-exit |
| `weather_algo_reentry_throttle_ms` | `30000` | 30 s de throttle re-entry |
| `weather_algo_forecast_change_threshold` | `2` | Drift = 2 °C |
| `weather_algo_close_before_resolution_hours` | `1` | Pre-close 1 h avant résolution |
| `weather_algo_pre_close_enabled` | `false` | **Pre-close désactivé** (cohérent avec `hold`) |
| `weather_algo_sl_enabled` | `false` | Stop-loss désactivé |
| `weather_algo_tp_enabled` | `false` | Take-profit désactivé |
| `weather_algo_trailing_enabled` | `false` | Trailing désactivé |
| `weather_algo_kill_switch_action` | `block_entries` | Kill switch bloque entrées seulement |
| `weather_algo_min_time_to_close` | `60` | 60 s avant de pouvoir fermer |

**Anomalies de configuration :**
- `weather_algo_poll_ms = 10000` (10 s) vs **défaut documenté 30 min**. L'algo
  évalue toutes les 10 s → charge inutile et re-signaux fréquents. Probablement
  une valeur de debug laissée en production.
- `weather_algo_max_forecast_std = null` : aucun filtre sur l'incertitude des
  prévisions. Voir §6 — 4 positions ouvertes avec σ > 1,5 °C.
- Aucun SL/TP/trailing/pre-close actif → l'algo ne sort que sur drift forecast,
  bucket-exit (mode `hold` = inactif) ou résolution. Très peu de mécanismes de
  sortie défensive.

---

## 3. Règles auto-track (49 villes)

Toutes les 49 règles sont :
- `metric = highest_temp`
- `look_ahead_days = 2`
- `mode = city_follow`
- `enabled = true`

Villes surveillées (extrait) : Paris, Amsterdam, Ankara, Atlanta, Austin,
Beijing, Buenos Aires, Busan, Cape Town, Chengdu, Chicago, Chongqing, Dallas,
Denver, Guangzhou, Helsinki, Hong Kong, Houston, Istanbul, Jeddah, Karachi,
Kuala Lumpur, London, Los Angeles, Lucknow, Madrid, Manila, Mexico City,
Miami, Milan, Moscow, Munich, New York City, Panama City, Qingdao,
San Francisco, Sao Paulo, Seattle, Seoul (Incheon), Shanghai, Shenzhen,
Singapore, Taipei, Tel Aviv, Tokyo, Toronto, Warsaw, Wellington, Wuhan.

**Observation :** couverture mondiale large, mais aucune règle `lowest_temp`.
Toutes les thèses portent sur les températures maximales uniquement.

---

## 4. Démographie des positions

### 4.1 Par statut

| Statut | Count | % |
|---|---|---|
| `open` | 18 | 22,5 % |
| `closed` | 2 | 2,5 % |
| `cancelled` | 60 | 75,0 % |

**75 % de cancellation** est le signal le plus fort de cet audit. Une position
`cancelled` avec `close_reason = reservation_released` signifie que la
`PositionReservation` a été relâchée (signal d'entrée émis, réservation créée,
puis relâchée sans exécution fill). Les 20 sans `close_reason` sont des
positions créées mais jamais réservées/executées correctement.

### 4.2 PnL

| Mode | Positions | Réalisé | Non réalisé | Gagnants | Perdants |
|---|---|---|---|---|---|
| `sim` | 80 | −0,48 | −6,60 | 0 | 20 |
| `real` | 0 | 0 | 0 | 0 | 0 |

**Taux de win = 0 %.** Les 20 positions évaluables (18 open + 2 closed) sont
toutes négatives. Pire perte non réalisée : Tel Aviv (−0,80), Karachi (−0,72),
Busan (−0,60), Tokyo (−0,57), Buenos Aires (−0,55).

---

## 5. Analyse des 18 positions ouvertes

Notional total : **18,74 USDC** (cohérent avec `entry_usdc = 1` × ~18 pos).
Frais d'entrée cumulés : **0,79 USDC**.

| Ville | Entry price | Qty | μ forecast | σ | Bucket | PnL | End market |
|---|---|---|---|---|---|---|---|
| Helsinki | 0,006 | 28,57 | 19,7 | **2,17** | ≤18 | −0,15 | 14:00 04/08 |
| Tokyo | 0,030 | 19,41 | 29,3 | **1,53** | =30 | −0,57 | 14:00 04/08 |
| Miami | 0,040 | 25,00 | 29,9 | 0,71 | 30–30,6 | −0,30 | 14:00 04/08 |
| Karachi | 0,018 | 55,56 | 31,1 | **1,81** | =31 | −0,72 | 14:00 04/08 |
| Austin | 0,047 | 21,18 | 37,9 | 1,16 | 38,9–39,4 | −0,40 | 14:00 05/08 |
| New York City | 0,060 | 16,67 | 25,8 | 0,68 | 25,6–26,1 | −0,05 | 14:00 05/08 |
| Houston | 0,120 | 8,33 | 35,8 | 0,96 | 36,7–37,2 | −0,21 | 14:00 04/08 |
| Seattle | 0,090 | 11,11 | 26,6 | 0,69 | 26,7–27,2 | −0,27 | 14:00 04/08 |
| Wuhan | 0,350 | 5,00 | 36,0 | 0,39 | =36 | −0,11 | 14:00 05/08 |
| Panama City | 0,095 | 10,00 | 30,6 | 0,98 | =30 | −0,09 | 14:00 04/08 |
| Buenos Aires | 0,040 | 25,00 | 14,1 | **1,70** | =14 | −0,55 | 14:00 04/08 |
| Milan | 0,057 | 17,55 | 36,6 | 1,22 | =37 | −0,51 | 14:00 04/08 |
| Dallas | 0,230 | 5,00 | 39,3 | 0,52 | 38,9–39,4 | −0,09 | 14:00 05/08 |
| Madrid | 0,120 | 8,33 | 33,1 | 0,25 | =33 | −0,46 | 14:00 04/08 |
| Busan | 0,008 | 81,59 | 30,6 | 1,40 | =30 | −0,60 | 14:00 05/08 |
| Istanbul | 0,040 | 25,00 | 30,8 | 1,10 | =31 | −0,40 | 14:00 05/08 |
| London | 0,500 | 5,00 | 29,3 | 0,31 | =29 | −0,31 | 14:00 04/08 |
| Tel Aviv | 0,040 | 25,00 | 31,8 | 0,92 | =31 | −0,80 | 14:00 05/08 |

### 5.1 Edge vs prix d'entrée

Le `entry_price` est le prix payé (probabilité implicite YES). L'edge théorique
est l'écart entre la probabilité forecast-attendue et ce prix. Or, **toutes
les entrées sont à très faible prix** (0,006 à 0,50), c'est-à-dire des paris
sur des buckets peu probables selon le marché.

La stratégie `selectForecastAlignedBucket` sélectionne le bucket aligné au
forecast mean, mais achète YES sur des buckets où le marché évalue la proba
à 0,4 % (Helsinki) à 50 % (London). Le `min_edge = 0.1` (10 %) devrait filtrer
les entrées sans edge suffisant, or on observe des entrées à 0,006 (edge
implicite énorme si la forecast est juste, mais payout faible).

### 5.2 Distribution de l'incertitude (σ forecast)

σ min = 0,25 (Madrid) — σ max = **2,17 (Helsinki)**.

4 positions avec σ > 1,5 °C : Helsinki (2,17), Karachi (1,81), Buenos Aires
(1,70), Tokyo (1,53). Ces 4 positions représentent **−2,94 USDC** de PnL non
réalisé (44 % du total négatif). Une config `max_forecast_std = 1,5` aurait
évité ces 4 positions.

---

## 6. Exécutions (42)

### 6.1 Statut

| Statut | Count |
|---|---|
| `filled` | 22 |
| `failed` | 20 |

**Taux d'échec d'exécution = 48 %.** La moitié des ordres échouent.

### 6.2 Slippage

Slippage moyen : **9,79 %** (27 exécutions avec slippage mesuré). Valeurs
extrêmes observées sur les échecs :
- pos#29557 : slippage **96,74 %**
- pos#29551 : slippage **35,30 %**
- pos#29552 : slippage **8,23 %**

Ces slippages énormes sur des échecs indiquent des ordres placés loin du
carnet (bid trop bas / ask trop haut) ou un carnet illiquide. Les exécutions
filled réussies ont un slippage quasi nul (0 pour la plupart), ce qui
suggère que l'algo place des limites agressives et que les échecs sont des
ordres jamais matchés (réservation expirée).

### 6.3 Reasons d'exécution

| Reason | Count |
|---|---|
| `WEATHER_OPEN` | 40 |
| `MANUAL` | 2 |

Les 2 exécutions `MANUAL` sont les SELL de clôture des positions #29510 et
#29511 (fermées manuellement).

---

## 7. Anomalies et risques identifiés

### R1 — Taux de win = 0 % (critique)
Aucun trade gagnant sur 20 évaluables. L'edge théorique prévu par la stratégie
ne se matérialise pas. Hypothèses :
- Le bucket forecast-aligned n'est pas un edge réel (le marché price déjà
  l'information météo).
- `min_edge = 0.1` ne suffit pas / est mal calculé.
- Acheter YES sur buckets très peu probables (0,4 %–5 %) a une espérance
  négative malgré un edge apparent.

### R2 — 75 % de cancellation (critique)
60 positions sur 80 sont `cancelled`. Le pipeline émet un signal, crée une
`PositionReservation`, puis la relâche. Causes possibles :
- Throttle re-entry (`weather_reentry:{city}:{mode}`) qui déclenche avant
  l'exécution.
- `PositionReservation` expirée avant fill.
- Ordre placé puis annulé par le worker (liquidity_status, bid/ask ratio).
- Conflit avec la règle "1 position par ville" (signal émis pour une ville
  déjà ouverte → reservation relâchée).

### R3 — `weather_algo_poll_ms = 10000` (haut risque)
Polling à 10 s vs défaut 30 min. Charge CPU/DB/API météo ×180 plus élevée
qu'attendu. Probablement une valeur de debug non réinitialisée. À corriger.

### R4 — `weather_algo_max_forecast_std = null` (moyen)
Aucun filtre d'incertitude. 4 positions à σ > 1,5 °C concentrent 44 % des
pertes. Recommandation : `max_forecast_std = 1,5`.

### R5 — Toutes thèses `highest_temp` (moyen)
49 règles, toutes `highest_temp`. Aucune diversification `lowest_temp`. Les
marchés de température minimale ne sont pas exploités.

### R6 — Aucun SL/TP/trailing/pre-close (moyen)
Les seules sorties sont : drift forecast (2 °C), bucket-exit (mode `hold` =
inactif), résolution. En mode `hold`, le bucket-exit ne ferme pas → la
position reste jusqu'à drift ou résolution. PnL négatif non défendu.

### R7 — `city_follow_switch_mode = hold` inactive le bucket-exit
Avec `hold`, `WEATHER_BUCKET_EXIT` ne déclenche pas de close (voir
`docs/weather-algo.md` §3). Donc si le forecast drift hors bucket, la
position reste ouverte. Seul `WEATHER_FORECAST_CHANGE` (drift > 2 °C) peut
sortir. Sur 18 positions ouvertes, aucune n'a de `closing_started_at` →
aucun mécanisme de sortie n'a déclenché.

### R8 — Slippage énorme sur échecs (moyen)
Slippage jusqu'à 96 % sur des ordres échoués. Indique un pricing d'ordre
déconnecté du carnet ou un carnet très illiquide sur ces marchés météo.

### R9 — Positions sans forecast (faible)
Toutes les 80 positions ont un forecast (cohérent), mais vérifier la
couverture forecast sur les positions futures.

---

## 8. Recommandations

| # | Priorité | Action | Impact attendu |
|---|---|---|---|
| 1 | **P0** | Investiguer le taux de win 0 %. Revalider la formule d'edge et `selectForecastAlignedBucket`. Comparer entry_price vs proba forecast réelle. | Cesser l'hémorragie |
| 2 | **P0** | Diagnostiquer les 75 % de cancellation. Logger la raison de chaque `reservation_released` (throttle ? expiry ? 1-par-ville ?). | Réduire le bruit |
| 3 | **P1** | Réinitialiser `weather_algo_poll_ms` à 1 800 000 (30 min) ou justifier 10 s. | Charge ×180 |
| 4 | **P1** | Activer `weather_algo_max_forecast_std = 1.5`. | Éviter 4 positions σ>1,5 |
| 5 | **P1** | Activer `weather_algo_pre_close_enabled = true` (1 h avant résolution). | Sortie défensive |
| 6 | **P2** | Reconsidérer `city_follow_switch_mode = close_and_reenter` pour activer le bucket-exit. | Sorties sur drift bucket |
| 7 | **P2** | Ajouter des règles `lowest_temp` pour diversifier. | Nouvelles thèses |
| 8 | **P2** | Activer SL/TP ou trailing minimal. | Couper les pertes |
| 9 | **P3** | Ajouter une métrique Prometheus `weather_open_positions` et `weather_pnl` labellisées (aujourd'hui fondues dans `positions_*`). | Observabilité |
| 10 | **P3** | Investiguer le slippage 96 % sur pos#29557. | Qualité d'ordre |

---

## 9. Méthodologie

- Script : `tools/weather-algo-audit.ts` (pattern `tools/detect-stale-entry-timestamps.ts`).
- BDD : PostgreSQL `polywatch@localhost:5432/polywatch`, TypeORM entities.
- Requêtes :
  - `copied_positions WHERE reason = 'WEATHER_OPEN'` LEFT JOIN `markets` +
    `weather_position_forecasts`.
  - `executions WHERE copied_position_id IN (...)`.
  - `exit_attempt_events WHERE copied_position_id IN (...)` (0 rows).
  - `weather_auto_track_rules`.
  - `weather_config LIMIT 1`.
- Limites : snapshot ponctuel, pas de série temporelle. Les positions
  ouvertes peuvent évoluer avant résolution.

---

## 10. Données brutes

Le JSON complet (214 KB, 80 positions + 42 exécutions + 49 règles + config)
est disponible : `tools/weather-algo-audit-data.json`. Régénérable via :

```bash
npx tsx tools/weather-algo-audit.ts --json --out tools/weather-algo-audit-data.json
npx tsx tools/weather-algo-audit.ts   # sortie lisible
```

Un canvas interactif accompagne ce rapport :
`weather-algo-audit-2026-08-04.canvas.tsx`.