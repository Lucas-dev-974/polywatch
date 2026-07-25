# Audit : Sorties SL/TP/Trailing � march�s binaires Up/Down crypto-algo (sim)

**Date** : 2026-07-05  
**Auteur** : Cursor Agent  
**Port�e** : Positions sim `reason = 'ALGO_OPEN'`, march�s Polymarket `*-updown-5m`  
**M�thodologie** : Audit PostgreSQL (`copied_positions`, `executions`, `market_position_ticks`, `risk_config`, `markets`) via `tools/audit-crypto-algo-exits.ts`, `tools/audit-crypto-algo-exits-detail.ts`, `tools/audit-redemption-sl-miss.ts` + revue statique (`policy.ts`, `vwap.ts`, `position-branches.ts`, `exit-decision.ts`, `mark.ts`)

**Documents li�s** :
- Audit ant�rieur : `2026-07-03_audit-close-reasons-sim-crypto-algo.md` (100 % REDEMPTION)
- Patch ant�rieur impl�ment� : `../plans/2026-07-05_PLAN_PATCH_CRYPTO_ALGO_EXITS.md`
- Patch propos� : `../patchs/2026-07-05_PATCH_SORTIES_BINAIRE_CRYPTO_ALGO.md`

---

## 1. R�sum� ex�cutif

| Verdict | D�tail |
|---|---|
| Pipeline de sortie | **Am�lior�e** vs audit 03/07 (SL/TIME_EXIT actifs) |
| Conformit� SL (ticks) | **0 violation** d�tect�e sur positions avec ticks exploitables |
| Compatibilit� march�s binaires | **Architecture OK**, seuils **% relatifs sous-optimaux** pour tokens [0, 1] |
| Risque r�siduel principal | **REDEMPTION en perte** (2 cas) + **TIME_EXIT � la place du TP** (4 cas peak ? 50 %) |
| Action recommand�e | Patch cibl� P0 (config) + P1 (settled + mark stale) + P2 (TP plafonn�) � voir patch associ� |

**PnL session sim** : capital 1 000 pUSD ? solde **993,80 pUSD** (?0,62 %), PnL moyen / position ferm�e **?0,22 USDC**.

---

## 2. Volume et r�partition des sorties

### 2.1 Inventaire

| M�trique | Valeur |
|---|---|
| Positions sim `ALGO_OPEN` | 22 |
| Ferm�es | 19 |
| Ouvertes (snapshot audit) | 1 (id 16049) |
| Annul�es (buy failed) | 2 |
| Ticks `market_position_ticks` | 7 364 sur 20 positions |

### 2.2 Close reason (19 ferm�es)

| Close reason | Count | % |
|---|---|---|
| `TIME_EXIT` | 10 | 52,6 % |
| `SL` | 5 | 26,3 % |
| `REDEMPTION` | 3 | 15,8 % |
| `TP` | 1 | 5,3 % |
| `PRE_CLOSE_LOSS` / `PRE_CLOSE_WIN` | 0 | 0 % |
| `TRAILING` | 0 | 0 % |

### 2.3 Ex�cutions SELL filled

| Reason | Count | PnL moyen |
|---|---|---|
| `TIME_EXIT` | 10 | +0,29 USDC |
| `SL` | 5 | ?0,98 USDC |
| `TP` | 1 | +1,44 USDC |
| `REDEMPTION` | 1 | +0,39 USDC |

**�checs de sortie** (SL/TP/PRE_CLOSE/TIME_EXIT) : **0** (vs 948 `PRE_CLOSE_LOSS failed` avant correctifs du 03�05/07).

---

## 3. Configuration active (`risk_config`)

| Param�tre | Valeur audit | Effet |
|---|---|---|
| `crypto_algo_sl_percent` | 15 | Override global (masque default 5m : 12 %) |
| `crypto_algo_tp_percent` | 50 | Override global (masque default 5m : 45 %) |
| `crypto_algo_trailing_stop_percent` | 15 | Actif mais 0 cl�ture TRAILING |
| `crypto_algo_pre_close_enabled` | true | Pre-close activ� |
| `crypto_algo_pre_close_seconds` | null | ? 120 s pour 5m (table intervalle) |
| `crypto_algo_pre_close_hold_if_winning` | **true** | Retient positions dont la vente projet�e serait ? 0 |
| `sim_pre_close_seconds` | 40 | Ignor� si override algo actif |
| TIME_EXIT 5m (code) | 90 s avant `endDate` | Phase HARD � m�canisme dominant |

**�cart vs patch 05/07 recommand�** : les overrides SL/TP ne sont pas � `NULL` et `pre_close_hold_if_winning` reste `true`.

---

## 4. Conformit� SL / TP (audit ticks)

Analyse sur **7 364 ticks** : min/max PnL trigger et closure pendant la vie de chaque position (logique hybride du code).

| R�gle | R�sultat |
|---|---|
| SL breach (trigger **OU** closure ? ?15 %) mais `close_reason ? SL` | **0 violation** |
| TP breach (trigger **ET** closure ? +50 %) mais `close_reason ? TP` | **0 violation stricte** |

**Interpr�tation** : quand le worker voit le bon mark et �value, le SL respecte les seuils configur�s. Les anomalies observ�es viennent surtout de **non-�valuation** (settled, mark stale) ou de **seuils inadapt�s** (TP math�matiquement inaccessible), pas d'une mauvaise formule SL.

---

## 5. Compatibilit� SL/TP/Trailing � march�s binaires Up/Down

### 5.1 Mod�le Polymarket

- Chaque position d�tient **un token** (Up/Yes ou Down/No), prix ? **[0, 1]** USDC (probabilit� implicite).
- R�solution : token gagnant ? **1**, perdant ? **0** (`getRedemptionPayoff` dans `mark.ts`).
- L'algo entre via `naive-momentum` sur le token YES ou NO ; SL/TP s'appliquent au **bid VWAP de ce token**, pas au spot crypto.

### 5.2 Formules utilis�es

```typescript
// triggerPnlPercent � variation relative du bid vs entryBidVwap
((executableBidVwap - entryBidVwap) / entryBidVwap) * 100

// evaluateSlTpTrailing � hybrid
// SL  : trigger ? ?X% OR closure ? ?X%
// TP  : trigger ? +X% AND closure ? +X%
// Trail : drawdown depuis peakClosurePnlPercent
```

### 5.3 Matrice de compatibilit�

| Aspect | Compatible ? | Commentaire |
|---|---|---|
| Token et carnet CLOB | ? | Bon `assetId`, bid ex�cutable |
| R�solution 0/1 dans le mark | ? | `getPositionMarkPrice` ? payoff binaire |
| SL en % relatif | ?? | Fonctionne mais ?15 % ? ?15 points de probabilit� |
| TP en % relatif | ?? | **Inatteignable** si entry > ~0,67 (plafond prix = 1,0) |
| Trailing 18 % (default 5m) | ?? | Amplitude typique 5m born�e ; 0 cl�ture TRAILING observ�e |
| Fin de vie binaire | ? hors SL/TP | Convergence 0/1 g�r�e par TIME_EXIT / REDEMPTION |

### 5.4 Exemples chiffr�s (SL 15 %, TP 50 %)

| Entry | SL (bid ?) | TP (bid ?) | Gain max possible (? 1,0) |
|---|---|---|---|
| 0,40 | 0,34 | 0,60 | +150 % |
| 0,55 | 0,47 | 0,83 | +82 % |
| 0,70 | 0,60 | 1,05 | +43 % ? **TP 50 % impossible** |
| 0,85 | 0,72 | 1,28 | +18 % ? **TP 50 % impossible** |

Entr�es observ�es en session : **0,53 � 0,88** (momentum = c�t� d�j� favoris�) ? TP +50 % souvent hors port�e.

---

## 6. Anomalies d�taill�es

### 6.1 Pre-close � 0 signal en base

**Priorit� code** : SL/TP ? TIME_EXIT (T?90s) ? PRE_CLOSE (fen�tre effective T?120s ? T?90s = **30 s**).

Cons�quences :
- D�s T?90s, `timeExitInScope = true` ? pre-close **d�sactiv�**.
- `pre_close_hold_if_winning = true` ? positions non perdantes ignor�es en pre-close.
- Les sorties perdantes tardives passent par **TIME_EXIT**, pas `PRE_CLOSE_LOSS`.

**Verdict** : comportement architectural attendu avec la config actuelle, pas un bug d'ex�cution.

### 6.2 Peak ? 50 % ferm�es en TIME_EXIT (4 cas)

| ID | Peak closure % | Close | PnL |
|---|---|---|---|
| 16042 | 68,6 | TIME_EXIT | +1,41 |
| 16040 | 67,3 | TIME_EXIT | +1,35 |
| 16043 | 65,8 | TIME_EXIT | +1,35 |
| 16028 | 52,3 | TIME_EXIT | +1,04 |

Le peak a d�pass� le seuil TP, mais au moment TIME_EXIT les conditions TP hybrides (AND) ou le plafond [0, 1] ne sont plus r�unies. **Optimisation produit possible** : TP effectif plafonn� ou r��valuation TP avant TIME_EXIT.

### 6.3 SL avec PnL positif (id 16041)

- Entry 0,72, fill SL **0,999**, PnL **+1,15 USDC**.
- Signal SL �mis sur dip trigger ; fill simul� au prix de march� gagnant en fin de vie.
- Label `SL` correct c�t� signal ; r�sultat �conomique contre-intuitif.

### 6.4 REDEMPTION � 3 cas (dont 2 en perte)

| ID | PnL | Ex�cution | Sec apr�s `endDate` |
|---|---|---|---|
| 16029 | ?2,06 | `no_payout` | 392 |
| 16036 | ?1,96 | `no_payout` | 353 |
| 16039 | +0,39 | fill 1,00 | 469 |

#### Position 16029 � SL aurait d� partir

Ticks T?120s ? T?90s :

| Moment | Bid | PnL trigger |
|---|---|---|
| 09:18:00 | 0,42 | **?27,6 %** |
| 09:18:16 | 0,29 | **?50,3 %** |

Seuil SL : ?15 %. **Aucun SELL** tent� avant REDEMPTION.

**Causes identifi�es** :
1. Fen�tre critique avant corrections pipeline fiable (~09:16�09:20).
2. Apr�s `endDate`, march� `settled` (`acceptingOrders = false`) ? `evaluateLiquidPosition` **stoppe** l'�valuation SL/TIME_EXIT (`if (settled) return tick`).

#### Position 16036 � SL non franchi, TIME_EXIT manqu�

- Drawdown max ticks : **?12,8 %** (< SL ?15 %) ? SL **non applicable**.
- Peak mid-vie : **+16,6 %** ; fin : bid ~0,48 (?11 % trigger).
- TIME_EXIT aurait d� sortir (trigger < 0) mais mark probablement **stale** (`lastCloseableBid` du pic encore �lev�).

### 6.5 Coupure post-`settled` (root cause structurelle)

```typescript
// position-branches.ts � evaluateLiquidPosition
if (settled) return tick;  // plus d'appel evaluateCloseLogic
```

Quand `closed && !acceptingOrders`, seule la voie **REDEMPTION** reste pour les positions encore `open`. Perte totale possible (`no_payout`) au lieu d'une sortie CLOB partielle.

---

## 7. Statistiques session

| M�trique | Valeur |
|---|---|
| Dur�e moyenne open ? close | 404 s (~6,7 min) |
| PnL min / max (ferm�es) | ?2,13 / +1,44 USDC |
| Peak closure moyen | +31,1 % |
| Positions peak ? TP 50 % non ferm�es en TP | 4 |

---

## 8. Synth�se par m�canisme

| M�canisme | �tat | Action |
|---|---|---|
| SL | ? Fonctionne (5 cl�tures, 0 violation tick) | Config : default 12 % via `NULL` |
| TP | ?? Sous-utilis� (1/19) | Plafonner au gain max [0,1] |
| Trailing | ? Non observ� | Pas de patch urgent |
| Pre-close | ? Contourn� par TIME_EXIT | `hold_if_winning = false` |
| TIME_EXIT | ? Dominant (52 %) | Conserver |
| REDEMPTION | ?? 15,8 % dont 2 pertes totales | Patch settled + mark stale |

---

## 9. Recommandations

| Priorit� | Action | Effort |
|---|---|---|
| **P0** | Config DB : overrides `NULL`, `pre_close_hold_if_winning = false` | SQL seul |
| **P1** | Continuer SL/TIME_EXIT quand position `open` + mark vendable malgr� `settled` | Code worker |
| **P1** | Renforcer mark fin de march� (�viter `lastCloseableBid` stale) | Code core/worker |
| **P2** | TP effectif = `min(tpConfig, gainMaxVers1)` | Code core |
| **P3** | Seuils en points de probabilit� absolus | Refonte � diff�rer |

**Validation post-patch** :

```bash
npx tsx tools/audit-crypto-algo-exits.ts
npx tsx tools/audit-redemption-sl-miss.ts
npm run test -w @polywatch/core -- crypto-algo-exit policy
npm run test -w @polywatch/worker -- position-exit-evaluator
```

**Crit�res de succ�s** :
- REDEMPTION en perte : **0** sur une session 5m compl�te
- `PRE_CLOSE_LOSS failed` : **0**
- Distribution `close_reason` : SL + TIME_EXIT + TP > 90 %, REDEMPTION < 5 %

---

## 10. Outils d'audit

| Script | R�le |
|---|---|
| `tools/audit-crypto-algo-exits.ts` | Distribution sorties, conformit� SL/TP ticks, config |
| `tools/audit-crypto-algo-exits-detail.ts` | REDEMPTION, peak vs TP, couverture ticks |
| `tools/audit-redemption-sl-miss.ts` | Analyse tick-level des REDEMPTION en perte |
