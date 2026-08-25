# Audit Run #57 — Backtest Météo `weather-highest-yes` (engine 0.8.0)

> **Date :** 2026-08-25
> **Révision :** contre-audit indépendant (re-extraction BDD + recoupement code). L’audit initial surestimait le churn SL, sous-diagnostiquait les ghost positions, et affirmait F3/F4 sans mesurer les fills contre les ticks.
> **Run audité :** `backtest_runs.id = 57`
> **Statut du run :** `completed`, engine `0.8.0` (comparable)
> **Verdict :** run **intègre** (stats, sizing, F1/F2). **Pas de bug moteur du type zero-holding / fill 40 ¢.** Residual : 3 fills 5–6,5 ¢ hors tick (sous le seuil F3 0,10) ; 7 ghosts dus à l’arrêt des ticks avant résolution, pas à la fin de plage du 25/08.

Horodatages ci-dessous : valeurs stockées en BDD (`timestamp` naive, session UTC pour `::text`).

---

## 1. Contexte du run

| Champ | Valeur |
|-------|--------|
| id | 57 |
| status | `completed` (progress 100%) |
| engine_version | `0.8.0` (comparable) |
| domain / mode | `weather` / `reevaluate` |
| backtestExecutionMode | `runner-sim` |
| strategyId | `weather-highest-yes` |
| capital | 1000 USDC |
| entryUsdc | 10 USDC |
| slippageBps | 50 |
| maxConcurrentPositions | 10 |
| Plage demandée | `2026-08-11T00:00:00.000Z` → `2026-08-25T23:59:59.999Z` |
| Plage d’événements | 2026-08-11 02:24:26 → 2026-08-25 08:35:08 |
| Durée du run | 77,7 s (started 08:36:12 → finished 08:37:30) |
| config_fingerprint | `cfg:rqx4ai` |

La plage `to` (23:59 UTC le 25/08) est **postérieure à l’heure d’exécution** du run (~08:36). Les heures « manquantes » en fin de journée ne sont pas un trou d’ingest : ces ticks n’existaient pas encore.

### Bag stratégie `weather-highest-yes` (stocké)

```json
{
  "minYesPrice": 0.5, "maxYesPrice": 0.61,
  "entryUsdc": 10, "sizingMode": "fixed_shares", "fixedShareCount": 5,
  "slEnabled": true, "tpEnabled": false,
  "slPercent": 30, "trailingPercent": 30, "trailingActivationPercent": 1,
  "signalScoreSizingEnabled": false
}
```

`reentryThrottleMs` est **absent** du bag → défaut catalogue **1 800 000 ms (30 min)**. Le throttle n’est posé que sur bucket/forecast exit, **pas sur SL** (identique au live).

### Résultats globaux (recalculés)

| Métrique | Valeur | Contrôle |
|----------|--------|----------|
| PnL total | **−14,216 USDC (−1,42 %)** | somme des 82 positions = `stats.totalPnl` ✅ |
| finalEquity | 985,78 | = 1000 + PnL ; dernier point d’equity 985,78 ✅ |
| maxDrawdown | 2,31 % | equity min 980,59 / max 1003,74 |
| Win rate | 41,46 % (**34W / 48L / 0 BE**) | = `stats.winRate` ✅ |
| profitFactor | 0,77 | run perdant |
| avgWin / avgLoss | +1,43 / −1,31 | |
| avgHolding | ~32,7 h | min hold **291 s** (~4,9 min), max ~11 j |
| qty | **5 sur 82** | `fixed_shares` respecté ✅ |

### Répartition des sorties

| Sortie | N | PnL | Détail |
|--------|---|-----|--------|
| `SL` | 36 | **−39,85** | 20 SL uniques (−21,34) + 7 premiers SL sur marché répété (−7,80) + **9 ré-entrées SL (−10,71)** |
| `RESOLUTION` | 27 | **+19,31** | 19 gagnantes (+41,84) / 8 perdantes (−22,53) |
| `BACKTEST_INCOMPLETE_DATA` | 10 | +4,66 | 7 marchés déjà échus + 3 encore ouverts à l’exécution |
| `TRAILING` | 9 | +1,66 | avg +0,18 |

---

## 2. Correctifs 0.8.0 — ce qui est vraiment vérifié

| Correctif | Mesure | Verdict |
|-----------|--------|---------|
| **F1** zero-holding `entryAt === exitAt` | 0 / 82 | ✅ |
| **F2** hold &lt; 1 s | 0 / 82 (aucun hold &lt; 60 s non plus) | ✅ |
| **F3** fill stale &gt; 0,10 | warning `entry_skipped_stale_price` présent (Austin, décision 0,51 vs tick 0,29). **Aucun fill avec \|décision − tick\| &gt; 0,10.** | ✅ pour le seuil 0,10 |
| **F3 residual** | **3 fills** avec delta 5,0–6,5 ¢ au tick exact de `entry_at` (sous le seuil) | ⚠️ voir §3 |
| **F4** flush avant gardes | **Non prouvable** à partir des tables persistées. Absence de fill 40 ¢ ≠ preuve que les pending sont droppés. | ⚪ non vérifié |
| **F5** pairing `decidedAt` | Pas de collision visible | ⚪ cohérent, pas une preuve |
| **Sizing run #40** | qty = 5 partout ; 0 entrée à prix &lt; 0,10 ; décisions dans \[0,50 ; 0,61\] | ✅ |

**Gardes d’entrée :** les warnings `entry_skipped_*` passent par `warnOnce` — ils documentent **au moins un** skip, pas le total. Dire « 1 entrée skippée » est une **borne inférieure**, pas un compte.

Holds SL courts (poll 5 min, pas un artefact ms) : 6 SL entre 4,9 et 15 min, dont Ankara #6241 / #6242 à **~5 min**.

---

## 3. Residual F3 — 3 fills 5–6,5 ¢ hors tick

Comparaison fill (prix de décision = `entry_price / 1,005`) vs **l’unique** `weather_bucket_ticks` à `entry_at` exact :

| Position | Ville | Décision | Tick à `entry_at` | Delta | Contexte |
|----------|-------|----------|-------------------|-------|----------|
| #6216 | Ankara | 0,505 | 0,565 | 0,060 | Ré-entrée **à la milliseconde** du TRAILING #6214 |
| #6234 | Austin | 0,505 | 0,555 | 0,050 | Ré-entrée **à la milliseconde** du TRAILING #6233 |
| #6283 | Austin | 0,535 | 0,600 | 0,065 | Première (seule) position sur ce `condition_id` |

Les 79 autres fills : médiane de delta = 0 (alignés).

Ce n’est **pas** le bug Austin #5808 (0,58 vs 0,98). La garde `|current − decision| > 0,10` laisse passer ces 5–6,5 ¢. Les deux premiers cas sont des ré-entrées immédiates sur le tick de sortie TRAILING : le signal a été pricé à l’ancien YES du groupe, le tick courant a déjà bougé.

---

## 4. Ghosts — 7 marchés échus, pas un trou du 25/08

L’audit initial attribuait les 10 `BACKTEST_INCOMPLETE_DATA` à la plage qui s’arrête à 08:35 le 25/08. **7 sur 10** ont un `end_date` les **15–17 août** ; les ticks s’arrêtent des **jours avant** la fin du run, à un YES loin de 0,01 / 0,99. Le moteur ne résout que par prix (`resolution_by_price`) → la position reste ouverte jusqu’à `finish()`.

| # | Ville | Entrée | `end_date` marché | Dernier tick | Dernier YES | `markets.resolved` | Hold |
|---|-------|--------|-------------------|--------------|-------------|-------------------|------|
| 6286 | Austin | 14/08 07:05 | 15/08 14:00 | 15/08 19:55 | 0,73 | false (closed) | 263 h |
| 6287 | Ankara | 14/08 21:25 | 16/08 14:00 | 16/08 09:35 | 0,715 | **true** | 249 h |
| 6288 | Atlanta | 15/08 07:10 | 15/08 14:00 | 15/08 19:55 | 0,565 | false | 239 h |
| 6289 | Austin | 16/08 04:55 | 16/08 14:00 | 16/08 09:35 | 0,52 | **true** | 218 h |
| 6290 | Atlanta | 16/08 05:00 | 16/08 14:00 | 16/08 09:35 | 0,595 | false | 218 h |
| 6291 | Amsterdam | 16/08 06:24 | 16/08 14:00 | 16/08 09:35 | 0,545 | false (closed) | 216 h |
| 6292 | Atlanta | 16/08 06:24 | 17/08 14:00 | 17/08 21:00 | 0,765 | **true** | 216 h |
| 6293 | Ankara | 23/08 15:15 | 25/08 14:00 | 25/08 09:40* | 0,765 | false | 39 h |
| 6294 | Ankara | 24/08 13:00 | 26/08 14:00 | 25/08 09:40* | 0,605 | false | 18 h |
| 6295 | Austin | 24/08 23:00 | 25/08 14:00 | 25/08 09:40* | 0,705 | false | 8 h |

\* ticks **après** `data_range_to` (08:35) : #6293–6295 étaient encore ouverts à l’heure d’exécution — ghosts « de fin de run » légitimes.

**3 marchés** (`#6287`, `#6289`, `#6292`) sont `resolved = true` en table `markets` alors que le flux backtest n’a jamais vu un YES ≤ 0,01 ou ≥ 0,99. Limitation documentée `resolution_by_price` **plus** queue de ticks manquante. `finish()` close au dernier mark (souvent 0,52–0,76), d’où un PnL ghost **mark-to-market**, pas un settlement 0/1.

PnL ghosts type A (échus) ≈ +2,59 ; type B (encore live) ≈ +2,08. Impact limité sur le −14,22, mais le mark 10 jours après `end_date` n’est pas un settlement.

---

## 5. Churn SL — réel, mais pas « la » cause de −39,85

Le throttle 30 min **ne s’applique pas au SL** (`evaluateSlTpTrailing` n’appelle pas `markClosed` ; live : throttle seulement sur `WEATHER_BUCKET_EXIT` / `WEATHER_FORECAST_CHANGE`). Les gaps de **5–15 min** après SL le confirment. C’est de la **parité live**, pas un artefact backtest.

### Marchés avec plusieurs SL (villes **corrigées**)

| Marché | Ville | Séquence | PnL ré-entrées extra |
|--------|-------|----------|----------------------|
| `0x9b5b71…` | **Ankara** | #6238 SL → #6240 SL (gap 45 min, hold 15 min) → #6241 SL (gap 10 min, hold 5 min) → #6242 SL (gap 5 min, hold 5 min) | −4,02 (3 extra) |
| `0x3498dd…` | **Amsterdam** | 4 SL 12–13/08, gaps 85 / 15 / 45 min | −2,74 (3 extra) |
| `0xe32bc4…` | **Amsterdam** | 2 SL puis RESOLUTION +2,25 | −1,61 (1 extra) |
| `0xbabb05…` | **Ankara** (pas Austin) | #6246 SL 14/08 02:10 → **15/08** 02:05 ; #6248 SL (gap 7 h) | −1,44 (1 extra) |
| `0x4f1b9e…` | **Amsterdam** (pas Ankara) | #6249 SL hold 45 min ; #6252 SL hold 5 min (gap 70 min) | −0,92 (1 extra) |

L’audit initial coupait les heures sans la date (`#6246 02:10→02:05`) : ça ressemblait à une sortie avant l’entrée. Ce sont **deux jours différents**.

### Décomposition des 36 SL (−39,85)

| Sous-ensemble | N | PnL |
|---------------|---|-----|
| SL unique (un seul passage) | 20 | **−21,34** |
| Premier SL d’un marché ensuite ré-entré | 7 | −7,80 |
| Ré-entrées SL (churn) | **9** | **−10,71** |

Les 9 ré-entrées expliquent **~27 %** des pertes SL, pas la totalité. La masse vient des **premiers** stops (sizing 5 shares × ~30 % = ~1,1 USDC par SL). Le churn aggrave, il ne crée pas à lui seul le −39,85.

---

## 6. Warnings de fidélité

| Code | Lecture corrigée |
|------|------------------|
| `risk_sl_confirmation_ignored` | Documenté (SL au 1er tick) |
| `risk_sizing_simplified_fixed_usdc` | Sizing fixe ; ici `fixed_shares` **est** honoré |
| `risk_min_time_to_close_ignored` | Documenté |
| `fill_no_book_depth` | Documenté |
| `multi_position_stale_mark` | 4 positions, max **2398 s** vs `pollMs` **300 000 ms (5 min)** |
| `resolution_by_price` | Documenté — cause directe des 7 ghosts échus |
| `entry_skipped_market_resolved` | ≥ 1 skip (Amsterdam, YES=0,0005), total inconnu (`warnOnce`) |
| `entry_skipped_stale_price` | ≥ 1 skip (Austin 0,51 vs 0,29), total inconnu |
| `ghost_positions_forced_resolution` | 10 ouvertes en `finish()` — mix échus / encore live |

0 tick dans `backtest_excluded_ticks` (`market_lifecycle_filtered` absent).

---

## 7. Ce que l’audit initial avait faux

1. **« F3 : 0 fill hors courbe »** — vrai seulement au-delà de 10 ¢. Trois fills restent 5–6,5 ¢ hors tick.
2. **« F4 vérifié »** — inférence, pas une mesure.
3. **« 1 entrée skippée »** — `warnOnce` ≠ compteur.
4. **Ghosts = trou du 25/08 08:35–23:59** — faux pour 7/10 ; ticks arrêtés mi-août sans prix de résolution. 3 marchés déjà `resolved` en `markets`.
5. **Churn = cause principale de −39,85** — les 9 extra SL font −10,71 ; 20 SL uniques font −21,34.
6. **Villes du tableau churn** — `0xbabb05` = Ankara, `0x4f1b9e` = Amsterdam.
7. **Heures tronquées** — `#6246 02:10→02:05` est un hold ~24 h, pas une inversion.

**Toujours justes :** intégrité 0.8.0, PnL, qty=5, F1/F2, bornes min/max YES, parité live du throttle SL, trailing peu lucratif.

---

## 8. Verdict

| Critère | Résultat |
|---------|----------|
| Intégrité | ✅ `completed`, 0.8.0, PnL / equity / winrate cohérents |
| F1 / F2 / sizing | ✅ |
| F3 (seuil 0,10) | ✅ pas de fill &gt; 10 ¢ ; ⚠️ 3 fills 5–6,5 ¢ |
| F4 | ⚪ non mesurable sur cette run |
| Bug moteur type #52 / #40 | **Absent** |
| Ghosts | ⚠️ 7 settlements mark-to-market faute de ticks terminaux ; 3 encore live à l’exécution |
| Churn SL | Comportement stratégie (= live), **amplificateur** (~ −11 USDC), pas toute la perte SL |

**La run #57 est exploitable** pour juger `weather-highest-yes` en 0.8.0. La perte −14,22 USDC vient surtout des **SL (36 × ~1,1 USDC)** ; le churn après SL et l’absence de TP (`tpEnabled: false`) empêchent de compenser. Les ghosts ne faussent le PnL que de quelques USDC, mais leur mark n’est pas un vrai settlement.

---

## 9. Actions recommandées

| # | Priorité | Action |
|---|----------|--------|
| 1 | **Moyenne (stratégie)** | Throttle (ou cap) de ré-entrée **après SL** si on veut casser les boucles 5–15 min. |
| 2 | **Moyenne (données / moteur)** | Clôturer à `end_date` / `markets.resolved` quand le YES ne touche jamais 0,01/0,99 — aujourd’hui 7 positions dérivent 9–11 jours. |
| 3 | **Basse (fidélité)** | Le seuil F3 0,10 laisse 5–6 ¢ de fill stale sur ré-entrée TRAILING ; resserrer ou filler au tick courant. |
| 4 | **Basse (observabilité)** | Compter les skips (`warnOnce` → compteur) pour ne plus lire « 1 skip » comme un total. |
| 5 | **Optionnel** | `trailingPercent: 30` capture peu (+1,66 / 9). |

---

## 10. Méthodologie (contre-audit)

1. Re-lecture `backtest_runs` / `positions` / `equity` / `excluded_ticks` (run 57).
2. Recalcul indépendant : somme PnL, wins/losses, holds, qty, min/max YES pré-slippage.
3. Join `weather_bucket_ticks` à `entry_at` **exact** (pas le plus proche ambigu).
4. Ghosts : dernier tick, `end_date` tick, `markets.closed` / `resolved`.
5. Churn : séquences datées + décomposition premier SL vs extra.
6. Code : `warnOnce`, `STALE_DECISION_PRICE_DELTA = 0.10`, `markClosed` hors SL, `finish()` ghost close.

Outils : `tools/audit-backtest-run.ts`, `tools/analyze-backtest-run.ts`.
