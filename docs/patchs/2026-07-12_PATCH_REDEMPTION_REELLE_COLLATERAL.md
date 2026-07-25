# Patch : Rédemption réelle — collatéral dynamique, payout 0, boucle Rachat

**Date** : 2026-07-12  
**Statut** : **MVP implémenté (Lots 0–5 + garde anti-boucle + auto-wrap)**  
**Plan** : [`../plans/2026-07-12_PLAN_REDEMPTION_PHASE2.md`](../plans/2026-07-12_PLAN_REDEMPTION_PHASE2.md)  
**Recovery ops** : [`../../tools/recover-stranded-redemption/README.md`](../../tools/recover-stranded-redemption/README.md)

---

## 1. Incidents

| Position | Symptôme | Cause racine | Recovery |
|----------|----------|--------------|----------|
| **#22441** | Rachat 0 $, perte apparente ~4 $ malgré YES gagnant | `redeemPositions` encodé avec **pUSD** alors que parts indexées sur **USDC.e** ; `verifyRedemptionReceipt` fallback `quantityRaw` → faux succès | Scripts `04` + `05` : redeem USDC.e puis wrap → pUSD. **BDD** : `realized_pnl` non corrigé (ops différé) |
| **#22539** | UI « Attente rédemption », boucle **Rachat 0,00 USDC** (14:47–14:54) | Redeem on-chain déjà passé (CTF = 0, USDC.e sur deposit) mais BDD désync ; retry toutes les 15 s | Script `06` : wrap USDC.e + fix PnL. Prod : garde `no_ctf_balance` |

---

## 2. Résumé des correctifs

| # | Correctif | Package | Fichiers clés |
|---|-----------|---------|---------------|
| 0 | Adresse `USDC_NATIVE_ADDRESS` complète (Circle) | core | `collateral-tokens.ts` |
| 1 | Détection collatéral via `assetId` (RPC payout vector + positionId CTF) | backend | `collateral-detection.ts` (nouveau) |
| 2 | `clob-redeem` : collatéral dynamique, `assetId` requis, verify `PayoutRedemption`, garde `no_ctf_balance`, auto-wrap USDC.e→pUSD | backend | `clob-redeem.ts`, `collateral-ramp.ts` |
| 3 | API `POST /api/internal/redeem` : `assetId` obligatoire (hors neg-risk) | backend | `clob-ops-routes.ts` |
| 4 | Worker : envoie `assetId`, refuse `amountRedeemedRaw === '0'`, traite `no_ctf_balance` → `filled` | worker | `redemption-handler.ts` |
| 5 | Timeout REDEMPTION `placing` > 5 min → reset `failed` puis retry | core | `execution.service.ts` |
| 6 | Historique wallet : pas de prix dérivé si `usdcSize === 0` | backend | `wallet-history.ts` |

---

## 3. Comportement prod (post-fix)

### Rédemption CTF standard

1. Worker appelle `POST /api/internal/redeem` avec `conditionId`, `outcome`, `quantity`, **`assetId`**.
2. Backend détecte le collatéral du marché (`detectCollateralForAsset`) — typiquement **USDC.e** ou **pUSD**.
3. Si solde CTF = 0 sur le deposit wallet → réponse `no_ctf_balance` (pas de tx) ; worker clôture en `filled` (déjà racheté).
4. Sinon : tx `redeemPositions` avec le **bon** collatéral.
5. Receipt : parsing `PayoutRedemption` ; `payout = 0` → `success: false`, `amountRedeemedRaw: '0'`.
6. Worker : `zero_payout` → exec `failed`, position reste `pending_resolution` / `failed` (retry possible).
7. Si redeem USDC.e réussi → **wrap automatique** vers pUSD sur le deposit wallet (`buildWrapDepositWalletCalls`).

### Exec REDEMPTION bloquée

- `claimUnlessFilled` : si exec REDEMPTION en `placing` depuis > **5 min** (`REDEMPTION_PLACING_TIMEOUT_MS`), reset en `failed` pour permettre un nouveau claim.

### Historique wallet

- Entrée REDEEM Data API avec `usdcSize = 0` : affichage sans prix unitaire dérivé (évite un faux « Rachat 1,00 $ »).

---

## 4. Fichiers modifiés

### Core

- `packages/core/src/polymarket/collateral-tokens.ts`
- `packages/core/src/services/execution.service.ts`
- `packages/core/src/services/execution.service.test.ts`

### Backend

- `packages/backend/src/polymarket/collateral-detection.ts` (**nouveau**)
- `packages/backend/src/polymarket/collateral-detection.test.ts` (**nouveau**)
- `packages/backend/src/polymarket/clob-redeem.ts`
- `packages/backend/src/polymarket/clob-redeem.test.ts`
- `packages/backend/src/polymarket/collateral-ramp.ts` (`buildWrapTransactions`, `buildWrapDepositWalletCalls`)
- `packages/backend/src/routes/internal/clob-ops-routes.ts`
- `packages/backend/src/polymarket/wallet-history.ts`
- `packages/backend/src/polymarket/wallet-history.test.ts`

### Worker

- `packages/worker/src/processors/redemption-handler.ts`

### Scripts / outils

- `scripts/validate-redemption-onchain.mjs` (`--asset-id`)
- `tools/recover-stranded-redemption/*` (diagnostic + recovery manuelle)

---

## 5. Tests

```bash
npm run test -w @polywatch/backend -- clob-redeem collateral-detection wallet-history
npm run test -w @polywatch/core -- execution.service
```

---

## 6. Déploiement

1. Rebuild : `npm run build` (core → backend → worker).
2. Redémarrer **backend** et **worker** pour activer garde anti-boucle + auto-wrap.
3. Vérifier une rédemption test : `npm run validate:redemption -- --condition-id … --outcome YES --asset-id …`

---

## 7. Reste à faire (hors MVP)

| Item | Priorité | Notes |
|------|----------|-------|
| Correction comptable BDD position **#22441** | Ops | Script one-shot ; `realized_pnl` incorrect (+0,81 au lieu du gain réel) |
| Lot 6 : persistance `markets.collateral_token` | Différé | Évite un RPC à chaque redeem |
| Badges frontend « rachat échoué / retry » | Différé | UX opérateur |
| Rebuild `packages/core/dist` si consommation via dist uniquement | Vérif | `USDC_NATIVE_ADDRESS` corrigé en source |
