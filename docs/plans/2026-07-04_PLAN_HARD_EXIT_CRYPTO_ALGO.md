# PLAN : Sortie forcée (Hard Exit / TIME_EXIT) — Crypto-Algo

**Date** : 2026-07-04
**Contexte** : Investigation SL crypto-algo — positions 5m fermées bien au-delà du SL de 15 % (fills à 0,01 ou redemption à -100 %).
**Objectif** : Sortir les positions incertaines ou perdantes avant que le carnet ne se vide, tout en conservant l'upside des gagnantes quasi certaines. Le tout **configurable depuis l'UI** (onglet dédié).
**Option retenue** : A (sortie temporelle forcée), avec seuil de confiance et **fidélité sim → réel**.

---

## 0. Décisions actées

| Sujet | Décision |
|---|---|
| Motif de sortie | Nouveau motif dédié **`TIME_EXIT`** (ne pas réutiliser `PRE_CLOSE_LOSS`) |
| Sous `mos` en phase HARD | **Garder le gate** (sim = réel) → redemption gère les positions invendables |
| Seuil de confiance (source prix) | Mark de sortie résolu (book → WS → lastTrade frais). **Aucun prix frais → VENDRE** |
| Après `endDate` | **Continuer à tenter** tant que `acceptingOrders = true` et non résolu ; sinon redemption |
| Fallback exécution sim | **Fidèle au réel** : vente seulement si `lastTradePrice` frais existe ; sinon échec → redemption |
| Trailing stop | Activé (défaut recommandé 20 % / activation 10 %) pour sécuriser les pics |

---

## 1. Comportement cible

### Phases de vie d'une position (exemple 5m)

```
Ouverture →→→→→→→→→→→ T-120s →→→→→→ T-90s →→→→→→→→ endDate →→→→→→ résolution
              →           →            →                →              →
        SL/TP/trailing  phase SOFT   phase HARD      (retry HARD     redemption
        (carnet         (pre-close   (vente          si acceptingOrders  (si tenue :
         liquide)        perdantes)   obligatoire     = true)          bid→seuil)
                                      si bid<seuil)
```

### Règles de décision — phase HARD (à partir de `timeExitSeconds` avant `endDate`)

| Situation | Mark résolu | Action |
|---|---|---|
| Gagnante quasi certaine | → `confidenceBid` (0,95) **et frais** | **Tenir** → redemption (payoff 1,00) |
| Gagnante incertaine | < `confidenceBid` | **Vendre** (`TIME_EXIT`) |
| Perdante | quelconque | **Vendre** (`TIME_EXIT`) — hold_if_winning ignoré |
| Prix périmé / absent | non vérifiable | **Vendre** (`TIME_EXIT`) par sécurité |

### Règles — phase SOFT (`preCloseSeconds` > `timeExitSeconds`)

- SL / TP / trailing restent actifs (phase liquide).
- `PRE_CLOSE_LOSS` pour les perdantes claires (comportement existant, guard hold-if-winning conservé).
- Pas de vente forcée des gagnantes.

### Impact attendu sur les cas du 04/07

| Position | Aujourd'hui | Avec le plan |
|---|---|---|
| BTC 9:40 (bid 0,99) | REDEMPTION +48 % | **Identique** — tenue jusqu'à 1,00 |
| ETH 9:50 (perdante) | REDEMPTION -100 % | `TIME_EXIT` ~T-90s (perte partielle) |
| ETH 9:40 (pic +54 %→-98 %) | SL tardif à 0,01 | Trailing ou `TIME_EXIT` avant effondrement |
| Position sous `mos` | REDEMPTION | REDEMPTION (limitation assumée) |

---

## 2. Configuration (DB + UI)

### Nouvelles colonnes `risk_config`

```sql
crypto_algo_time_exit_enabled                    BOOLEAN NULL,
crypto_algo_time_exit_seconds                    INTEGER NULL,
crypto_algo_time_exit_win_confidence_bid         REAL    NULL,
crypto_algo_time_exit_max_retries                INTEGER NULL,
crypto_algo_time_exit_last_trade_max_age_seconds INTEGER NULL
```

### Table par intervalle (nouveau, `crypto-algo-exit.ts`)

```typescript
export const CRYPTO_INTERVAL_TIME_EXIT_SECONDS: Readonly<Record<string, number>> = {
  '5m': 90, '10m': 90, '15m': 120, '30m': 180, '1h': 240, '4h': 300, '1d': 300,
};
```

### Résolution effective (worker)

```
timeExitEnabled = cryptoAlgoTimeExitEnabled →→ cryptoAlgoPreCloseEnabled →→ simPreCloseEnabled
timeExitSeconds = cryptoAlgoTimeExitSeconds →→ CRYPTO_INTERVAL_TIME_EXIT_SECONDS[interval] →→ 90
softSeconds     = cryptoAlgoPreCloseSeconds →→ CRYPTO_INTERVAL_PRE_CLOSE_SECONDS[interval] →→ 120
confidenceBid   = cryptoAlgoTimeExitWinConfidenceBid →→ 0.95
maxRetries      = cryptoAlgoTimeExitMaxRetries →→ simSlCloseMaxRetries
lastTradeMaxAge = cryptoAlgoTimeExitLastTradeMaxAgeSeconds →→ 120
```

L'UI affiche les valeurs **brutes** (null = héritage/table) ; le worker consomme les valeurs **résolues**.

### Migration initiale recommandée

```sql
UPDATE risk_config SET
  crypto_algo_time_exit_enabled = true,
  crypto_algo_time_exit_seconds = NULL,                    -- table 90s pour 5m
  crypto_algo_time_exit_win_confidence_bid = 0.95,
  crypto_algo_pre_close_seconds = NULL,                    -- table 120s pour 5m
  crypto_algo_pre_close_hold_if_winning = false,
  crypto_algo_trailing_stop_percent = 20,
  crypto_algo_trailing_activation_percent = 10;
-- Reprise de l'ancien seuil pre-close si présent :
UPDATE risk_config SET crypto_algo_time_exit_win_confidence_bid = crypto_algo_pre_close_win_confidence_bid
  WHERE crypto_algo_pre_close_win_confidence_bid IS NOT NULL;
```

---

## 3. Changements code — par phase

### PR1 — Core : décision

**Fichiers** : `crypto-algo-exit.ts`, `crypto-algo-helpers.ts`, `exit-decision.ts`, `policy.ts`, `orders/close-signal.ts`, `types/index.ts`

1. `CRYPTO_INTERVAL_TIME_EXIT_SECONDS` + `resolveCryptoAlgoTimeExitSeconds(risk, interval)`.
2. `getCryptoAlgoTimeExitParams(risk)` (lecture des nouvelles colonnes).
3. `isTimeExitScope({ timeExitSeconds, timeToEndMs, acceptingOrders })` :
   - actif si `timeToEndMs <= timeExitSeconds * 1000` **et**
   - (`timeToEndMs > 0` **ou** `acceptingOrders === true`) — gère la continuation après `endDate`.
4. `evaluateTimeExit(input)` :
   ```
   if (marketSettled) return null;
   if (!timeExitEnabled) return null;
   if (!isTimeExitScope(...)) return null;
   const losing = effectiveTrigger < 0 || effectiveClosure < 0;
   if (losing) return 'TIME_EXIT';
   // gagnante :
   const freshMark = markIsFresh → markBid : null;   // périmé/absent => null
   if (freshMark == null) return 'TIME_EXIT';        // décision fresh_or_sell
   if (freshMark < confidenceBid) return 'TIME_EXIT';
   return null;                                        // tenir jusqu'à redemption
   ```
5. `evaluatePositionExit` — ordre : **SL/TP/trailing (gat— par `suppressSlTp`) → TIME_EXIT (NON gat— par `suppressSlTp`, court-circuit— par `marketSettled`) → pre-close soft**.
6. `TIME_EXIT` ajout— — `OrderReason` et `TOTAL_CLOSE_REASONS`.

**Tests** : `exit-decision.test.ts`, `crypto-algo-exit.test.ts`
- bid 0,99 frais — T-60s → `null` (tenir)
- bid 0,75 — T-60s, gagnante → `TIME_EXIT`
- perdante — T-60s → `TIME_EXIT` m—me si hold_if_winning = true
- mark périmé, gagnante → `TIME_EXIT`
- après endDate, acceptingOrders=true → scope actif ; acceptingOrders=false → inactif
- marketSettled → `null`

### PR2 — Worker : émission + exécution (fidélité réel)

**Fichiers** : `position-exit-evaluator.ts`, `close-bid.ts`, `executor.ts`, `sl-close-retry.ts`, `results-consumer.ts`

1. **Fraîcheur du mark** : passer — `evaluateTimeExit` l'info de fraîcheur (déjà calcul—e : `bookUpdatedAt`, `lastTradeTimestamp` vs `lastTradeMaxAge`).
2. **`referenceVwap` unifié** : pour `TIME_EXIT`, utiliser le m—me mark de décision (`resolveExitDecisionMarkPrice`) comme référence, pas le `executableBidVwap` persisté.
3. **émission sans bid en phase HARD** : quand `closeReason === 'TIME_EXIT'` et `closeBid === 0` mais `lastTradePrice` frais → émettre (log `warn`). Sinon log `warn` — TIME_EXIT bloqué — pas de bid — (retombera en redemption, fid—le au réel).
4. **Gate mos conservé** : ajouter `TIME_EXIT` — `totalCloseReasons` du gate → une position sous `mos` est **différée** (redemption gère). Décision keep_gate.
5. **Fallback exécution sim FIDÈLE** (`executor.ts` / `resolveLastTradeFallback`) :
   - vente autorisée **uniquement** si `lastTradePrice` existe **et** frais (< `lastTradeMaxAge`) ;
   - **pas** de fallback `referenceVwap` sur carnet totalement vide (sinon échec → redemption, comme en réel) ;
   - staleness alignée sur `cryptoAlgoTimeExitLastTradeMaxAgeSeconds`.
6. **Retry forcé** : `TIME_EXIT` ajout— — `FORCED_EXIT_REASONS` (`sl-close-retry.ts`) → retenté par `results-consumer`. Le skip existant sur `isMarketAwaitingRedemptionExit` reste (cohérent avec after_enddate : on ne retente plus une fois terminal/résolu).

**Tests** : `position-exit-evaluator.test.ts`, `executor.test.ts`, `sl-close-retry.test.ts`
- émission TIME_EXIT avec bid=0 + lastTradePrice frais
- pas d'émission si aucun prix frais
- fallback sim refuse la vente sans lastTradePrice frais
- position sous mos → différée

### PR3 — Persistance + API + seed

**Fichiers** : `entities/RiskConfig.ts`, migration TypeORM, `backend/src/routes/config.ts` (Zod), `env-settings-types.ts`, seed/backfill.

- Colonnes + migration nullable.
- Zod :
  ```
  cryptoAlgoTimeExitEnabled: z.boolean().nullable(),
  cryptoAlgoTimeExitSeconds: z.union([z.number().int().min(0), z.null()]),
  cryptoAlgoTimeExitWinConfidenceBid: z.number().min(0).max(1).nullable(),
  cryptoAlgoTimeExitMaxRetries: z.union([z.number().int().min(0), z.null()]),
  cryptoAlgoTimeExitLastTradeMaxAgeSeconds: z.union([z.number().int().min(1), z.null()]),
  ```
- Validation serveur (warning, pas 400) si `timeExitSeconds > preCloseSeconds`.
- **Tests — mettre à jour** : `risk-config-backfill.test.ts`, `crypto-algo-helpers.test.ts`, seed defaults.
- Note : colonnes `crypto_algo_*` **hors** `SIM_RISK_CONFIG_KEYS`/`REAL_RISK_CONFIG_KEYS` (pas d'impact `pickModeFields`).

### PR4 — UI : onglets + onglet — Sortie forcée —

**Fichier** : `CryptoAlgoSettingsDialog.tsx` (+ sous-composants), pattern d'onglets de `EnvSettingsDialog.tsx` (`settings-tabs`).

**4 onglets** : Général | Sortie (SL/TP/trailing) | **Sortie forcée** | Suivi auto.

Sous-composants sugg—r—s :
- `CryptoAlgoSettingsGeneralTab.tsx`
- `CryptoAlgoSettingsExitTab.tsx`
- `CryptoAlgoSettingsHardExitTab.tsx`
- `CryptoAlgoSettingsAutotrackTab.tsx`

**Onglet Sortie forcée — champs** :

| Champ UI | Clé | Contrôle | Défaut affiché |
|---|---|---|---|
| Activer la sortie forcée | `cryptoAlgoTimeExitEnabled` | select 3 états (Hériter/Activée/Désactivée) | Activée |
| Délai phase SOFT (s) | `cryptoAlgoPreCloseSeconds` | NumberField | vide (120/5m) |
| Délai phase HARD (s) | `cryptoAlgoTimeExitSeconds` | NumberField | vide (90/5m) |
| Seuil de confiance (bid) | `cryptoAlgoTimeExitWinConfidenceBid` | NumberField 0—1 step 0,01 | 0,95 |
| Conserver si gagnante (SOFT) | `cryptoAlgoPreCloseHoldIfWinning` | select (Hériter/Conserver/Cléturer) | Toujours clôturer |
| *(avanc—)* Retries max | `cryptoAlgoTimeExitMaxRetries` | NumberField dans `<details>` | vide (hérite sim) |
| *(avanc—)* Âge max last trade (s) | `cryptoAlgoTimeExitLastTradeMaxAgeSeconds` | NumberField dans `<details>` | 120 |
| Entrée min. avant fin (s) | `cryptoAlgoMinTimeToClose` | NumberField | vide (auto) |

**UX** :
- Bloc d'intro explicatif + sch—ma des phases + exemple chiffré (— HARD 90s, seuil 0,95, 5m → vente forcée — 1 min 30 de la fin si bid < 0,95 —).
- Résumé des délais effectifs par intervalle (5m/15m) toujours visible.
- Validations client : `confidenceBid` → ]0,1[ (bloquant) ; `hardSeconds < softSeconds` (warning) ; `hardSeconds < 30` (warning).
- Un seul bouton — Enregistrer — (tous onglets), state `config()` partag— (pas de perte en changeant d'onglet).
- `pickCryptoAlgoFields` étendu aux nouveaux champs.

### PR5 — Trailing stop (config)

- Défaut via migration : `crypto_algo_trailing_stop_percent = 20`, `crypto_algo_trailing_activation_percent = 10`.
- Aucun code worker requis (déjà implémenté). R—glable dans l'onglet Sortie.

### PR6 — Analytics + E2E + validation

**Analytics** (motif `TIME_EXIT` visible) :
- `simulation/trader-analytics.ts` (switch motifs)
- `SimMarketYesNoBreakdown.tsx` (buckets `closeReasons`)
- `SimAnalyticsTable.tsx` / `SimMarketAnalyticsTable.tsx` (`formatCloseReasonBreakdown`)
- `lib/position.ts` (label — Sortie forcée —) + `position-tooltips.ts` + `closeReasonBadgeClass`

**E2E** (`crypto-algo.e2e.test.ts`) :
- perdante → `TIME_EXIT` avant redemption
- gagnante bid 0,99 → pas de `TIME_EXIT` → redemption 1,00
- gagnante incertaine bid 0,75 → `TIME_EXIT`

**Critères d'acceptation** :
- Aucune perdante 5m ouverte → 90s avant `endDate` ne finit en REDEMPTION payoff 0 (**hors** positions sous `mos`).
- Positions — mark → 0,95 frais — T-90s → REDEMPTION filled 1,00.
- échecs `no_liquidity` en phase HARD nettement réduits (fidélité : un carnet réellement vide reste un échec légitime → redemption).

---

## 4. Ordre d'implémentation

```
PR1 Core décision (TIME_EXIT + scope + tables + tests)
PR2 Worker exécution (mark unifié + émission + fallback fid—le + retries)
PR3 Persistance + API + seed/backfill
PR4 UI onglets + onglet Sortie forcée
PR5 Trailing stop (config défaut)
PR6 Analytics + E2E + validation données réelles
```
PR1/PR2 peuvent utiliser des defaults codés avant PR3/PR4. PR4 démarre après PR3 (champs API disponibles).

---

## 5. Risques résiduels / limitations assumées

| Risque | Statut |
|---|---|
| Positions sous `mos` → toujours REDEMPTION | **Assum—** (fidélité réel). Levier = sizing d'entr—e (hors scope) |
| Carnet réellement vide en phase HARD → échec → redemption | **Assum—** (fidélité réel : pas de fill fictif) |
| Position — bid 0,96 qui se retourne dans les 90 derni—res s | Accept— ; seuil réglable (0,95 → 0,98 = plus prudent) |
| Vente — ~0,75 au lieu de tenir jusqu'à 1,00 (cas incertain) | Voulu : on encaisse la valeur probabilisée, pas la loterie |
| Fenêtre de trade courte (5m : ~1 min utile après entr—e min. 150s) | Structurel, non bloquant |

## 6. Hors scope

- Stop garanti — -15 % (option B).
- Mark pilot— par le spot crypto (am—lioration future).
- Overrides par intervalle/symbole dans l'UI (v1 = valeur globale + table fallback).
- Correctif du sizing d'entr—e pour garantir qty → mos.
