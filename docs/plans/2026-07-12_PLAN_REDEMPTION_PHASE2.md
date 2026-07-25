# Plan — Phase 2 : Fixes rédemption réelle (corrigé)

**Date :** 2026-07-12  
**Version :** Polywatch v1.1  
**Statut :** MVP implémenté (Lots 0–5 + garde anti-boucle + auto-wrap)  
**Incidents :** #22441 (collatéral pUSD hardcodé → payout 0) ; #22539 (boucle Rachat 0 $, BDD désync)  
**Patch :** [`../patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md`](../patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md)

---

## Objectif MVP

Empêcher la récurrence de #22441 :

1. Racheter avec le **collatéral réel** du marché (détecté via `assetId`)
2. Traiter `PayoutRedemption.payout = 0` comme **échec** (pas de fallback `quantityRaw`)
3. Ne pas clôturer la position en `filled` sur un faux succès
4. Débloquer les exec REDEMPTION coincées en `placing` (timeout simple)
5. Ne pas embellir un REDEEM à 0 $ dans l’historique wallet

**Hors MVP initial :** persistance `markets.collateral_token`, nouveau janitor, badges frontend.

**Ajout post-incident #22539 :**
- Garde `no_ctf_balance` (pas de tx si solde CTF = 0) → stop boucle Rachat 0 $
- Auto-wrap USDC.e → pUSD après redeem réussi
- Worker : `no_ctf_balance` → clôture `filled` (déjà racheté)

---

## Lots retenus

| Lot | Contenu | Priorité |
|-----|---------|----------|
| 0 | Corriger `USDC_NATIVE_ADDRESS` tronqué | Bloquant |
| 1–2 | Détection collatéral + `clob-redeem` + verify payout | Critique |
| 3 | `assetId` API + garde worker `zero_payout` | Critique |
| 4 | Timeout `claimUnlessFilled` REDEMPTION placing (~5 min) | Résilience |
| 5 | Wallet history : pas de prix dérivé si `usdcSize === 0` | UX |

**Différé :** Lot 6 (colonne collateral), script correction comptable #22441 (ops one-shot séparé).

---

## Décisions d’architecture (post-audit)

- Détection collatéral + parsing receipt → **backend** (`clob-redeem` / module dédié), pas core (ethers/RPC déjà là)
- Core : adresses collatéral correctes uniquement
- Pas de nouveau `PlacingJanitor` : timeout dans `claimUnlessFilled`
- Double garde backend + worker sur payout 0

---

## Critères d’acceptation

- [x] `encodeCtfRedeemCalldata` utilise le collatéral détecté (paramètre obligatoire)
- [x] Receipt payout 0 → `success: false`, `amountRedeemedRaw: '0'`
- [x] Worker → `failed` / `redemption_failed: zero_payout` ; reclaim possible
- [x] REDEMPTION `placing` > 5 min → reset `failed` puis retry (`claimUnlessFilled`)
- [x] REDEEM Data API `usdcSize=0` → pas de prix 1,00 dérivé du payoff
- [x] Tests unitaires verts (backend redeem + detection + wallet-history ; core claimUnlessFilled)
- [x] `USDC_NATIVE_ADDRESS` corrigé (adresse Circle complète)
- [x] Garde `no_ctf_balance` (pas de tx si CTF = 0) — stop boucle Rachat 0 $
- [x] Auto-wrap USDC.e → pUSD après redeem réussi
- [x] Worker : `no_ctf_balance` → clôture `filled` (déjà racheté on-chain)

---

## Reste à faire

| Item | Priorité | Responsable | Notes |
|------|----------|-------------|-------|
| Redémarrer backend + worker en prod | **Immédiat** | Ops | Active garde anti-boucle + auto-wrap |
| Correction comptable BDD #22441 | Ops | Script one-shot | `realized_pnl` incorrect (+0,81) ; recovery wallet faite |
| Lot 6 : `markets.collateral_token` | Différé | Dev | Cache collatéral en BDD, moins de RPC |
| Badges UI « rachat échoué / retry » | Différé | Frontend | Hors scope MVP |
| Rebuild `packages/core/dist` | Vérif | Ops | Si d'autres process consomment le dist (adresse USDC native) |

### Recovery manuelle (incidents résolus)

| Position | Statut wallet | Statut BDD |
|----------|---------------|------------|
| #22441 | Récupéré (5,06 pUSD via scripts 04+05) | `realized_pnl` à corriger |
| #22539 | Récupéré (wrap 5 USDC.e) | Corrigé (`closed`, PnL +0,0465) |

Scripts : [`tools/recover-stranded-redemption/README.md`](../../tools/recover-stranded-redemption/README.md)
