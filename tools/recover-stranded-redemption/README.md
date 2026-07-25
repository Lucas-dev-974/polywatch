# Récupération parts gagnantes bloquées (rédemption réelle)

Scripts pour le cas : position **gagnante** en base, mais rachat Polywatch à **payout 0** ou UI bloquée en « Attente rédemption » avec boucle **Rachat 0,00 USDC**.

**Contexte bug (corrigé en prod phase 2)** : `clob-redeem` encodait `redeemPositions` avec **pUSD** en dur alors que de nombreux marchés indexent les parts CTF sur **USDC.e**. Voir [`docs/patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md`](../../docs/patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md).

## Fichiers

| Script | Risque | Rôle |
|--------|--------|------|
| `shared.ts` | — | Utilitaires partagés (pg, wallets, soldes CTF, détection collatéral) |
| `01-diagnose.ts` | **Aucun** (lecture seule) | Soldes CTF sur chaque wallet candidat, analyse tx précédente, recommandation |
| `02-redeem.ts` | **On-chain** (avec `--confirm`) | Rachat via `redeemOnChain()` backend (nécessite `npm run build -w @polywatch/backend`) |
| `03-verify-onchain.ts` | **Aucun** | Vérif payout vector + `positionId` CTF + collatéral attendu |
| `04-redeem-correct-collateral.ts` | **On-chain** | Rachat avec le collatéral détecté (ex. USDC.e) |
| `05-wrap-usdce-to-pusd.ts` | **On-chain** | Wrap USDC.e → pUSD sur le deposit wallet |
| `06-fix-pos-22539.ts` | **On-chain + BDD** | One-shot incident #22539 (wrap + correction PnL) — modèle pour ops similaires |

## Prérequis

- `.env` à la racine : `DATABASE_URL`, `POLYGON_RPC_URL`, `MASTER_ENCRYPTION_KEY`
- Credentials CLOB + signer configurés (comme pour le trading réel)
- Backend **non requis** pour `01`–`05` (imports relatifs `packages/core/src`, `packages/backend/src`)
- Pour le wrap (`05`, `06`) : backend compilé ou import depuis `packages/backend/src/polymarket/collateral-ramp.ts`

## Workflow recommandé

```bash
# 1. Diagnostic (sans risque)
npx tsx tools/recover-stranded-redemption/01-diagnose.ts --position-id 22441

# 2. Vérifier collatéral et payout vector on-chain
npx tsx tools/recover-stranded-redemption/03-verify-onchain.ts --position-id 22441

# 3. Simulation du rachat avec le bon collatéral
npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts --position-id 22441 --dry-run

# 4. Exécution réelle (uniquement après validation)
npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts --position-id 22441 --confirm

# 5. Si le redeem crédite USDC.e (pas pUSD), wrap vers pUSD
npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts --position-id 22441 --dry-run
npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts --position-id 22441 --confirm
```

> **Note prod** : depuis le patch 2026-07-12, le backend **wrap automatiquement** USDC.e → pUSD après un redeem réussi. Les scripts `04`/`05` restent utiles pour recovery manuelle ou positions déjà strandées avant redéploiement.

## Cas : solde CTF = 0, USDC.e déjà sur deposit

Symptôme : boucle « Rachat 0,00 USDC » dans l'historique wallet, position `pending_resolution`.

1. `01-diagnose` confirme CTF = 0 et USDC.e > 0 sur deposit.
2. Pas de nouveau redeem nécessaire — seulement **wrap** (`05`) si USDC.e non converti.
3. Corriger la BDD : clôturer la position, ajuster `realized_pnl` (voir `06-fix-pos-22539.ts` comme modèle).

## Ce que fait le diagnostic (`01`)

1. Charge la position réelle (via `--position-id` ou `--condition-id`)
2. Liste les wallets : deposit CLOB, proxy dérivé, safe dérivé, EOA
3. Lit `balanceOf(holder, assetId)` sur le contrat CTF Polygon
4. Décode le `payout` de la tx `REDEMPTION` Polywatch précédente (si présente)
5. Recommande wallet + collatéral + script suivant

## Ce que fait le rachat correct (`04`)

- Détecte le collatéral via `detectCollateralForAsset` (même logique que prod)
- Encode `redeemPositions` avec ce collatéral
- Vérifie `amountRedeemedRaw > 0` via logs `PayoutRedemption`
- **N'altère pas** `copied_positions` (recovery wallet uniquement)

## Options avancées

```bash
# Forcer un wallet / mode si le diagnostic est ambigu
npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts \
  --position-id 22441 \
  --wallet 0xVotreAdresse \
  --mode proxy \
  --dry-run

# Wrap d'un montant USDC.e explicite (sans lien position)
npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts \
  --amount 5.060235 \
  --dry-run
```

## Limites

- Si **tous les soldes CTF = 0** et **pas de USDC.e** sur deposit → parts déjà converties ou ailleurs → [polymarket.com](https://polymarket.com) Portfolio
- Le pUSD arrive sur le **deposit wallet** Polymarket, pas directement sur MetaMask ; retrait via l'onglet Wallet de l'app
- `02-redeem.ts` importe `packages/backend/dist` — lancer `npm run build -w @polywatch/backend` avant usage ; sinon préférer `04`

## Incidents traités dans cette session

| Position | Recovery | Tx clés |
|----------|----------|---------|
| #22441 | `04` redeem USDC.e + `05` wrap | `0x33dc8ed8…`, `0x77dc4271…` |
| #22539 | `06` wrap + fix BDD | `0xbb61c25b…` |
