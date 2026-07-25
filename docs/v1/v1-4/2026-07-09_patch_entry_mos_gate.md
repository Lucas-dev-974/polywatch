# Patch — Gate MOS à l'entrée (bump + floor conservateur)

**Date** : 2026-07-09  
**Version cible** : v1-4  
**Statut** : Implémenté  
**Tags** : `MOS`, `entry`, `SL`, `crypto-algo`, `copy-trading`, `below_min_order_size`  
**Références** :
- Audit position `#18238` — qty 3.33 < MOS 5 → SL détecté mais jamais émis (`below_min_order_size`)
- `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md` (phase émission SL — complémentaire)

---

## 1. Résumé

L'entrée (algo + copy) n'exigeait que `MIN_ORDER_SHARES = 1`, alors que la sortie SL applique le **MOS marché** (souvent 5 shares). Des positions étaient ouvertes mais structurellement invendables.

**Correctif** : gate MOS à l'entrée — si `targetQty < MOS`, **bump** à MOS quand cash et `maxPositionSizeUsdc` le permettent, sinon **skip**. Si le lookup MOS échoue, floor conservateur `max(1, 5)`.

La sortie SL reste inchangée (pas de bypass MOS).

---

## 2. Comportement

| Étape | Avant | Après |
|-------|-------|-------|
| Entrée BUY | `qty >= 1` | `qty >= MOS` (bump ou skip) |
| Lookup MOS fail | N/A à l'entrée | Floor 5 shares |
| Sortie SL | Gate MOS | Inchangé |
| Resume réservation | `MIN_ORDER_SHARES` seulement | Abandon si qty réservée < MOS |

---

## 3. Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `packages/core/src/sizing/entry-mos.ts` | Floor 5, `ensureEntryQuantityMeetsMos` |
| `packages/core/src/sizing/resolve-entry-mos.ts` | Lookup MOS détaillé (clob / book / fallback) |
| `packages/core/src/sizing/apply-entry-mos-gate.ts` | Gate async bump + re-fetch VWAP |
| `packages/core/src/sizing/resume-reserved-entry.ts` | Abandon si qty < MOS |
| `packages/crypto-algo/src/processors/algo-entry-pipeline.ts` | Gate avant reserve |
| `packages/worker/src/processors/copy/copy-entry-pipeline.ts` | Gate avant reserve |
| `packages/worker/src/clob/min-order-size.ts` | Délègue au resolver core + cache source |

---

## 4. Config opérationnelle

Avec `sim_entry_usdc_amount = 2`, le bump vers MOS 5 est fréquent (~3 USDC @ 0.6). Recommandé : **≥ 5 USDC** pour limiter les bumps. Le code reste correct avec une config basse.

---

## 5. Positions legacy

Les positions déjà ouvertes sous MOS (ex. `#18238`) ne sont pas migrées — elles restent sur le chemin redemption / blocage SL actuel.

---

## 6. Tests

- `packages/core/src/sizing/entry-mos.test.ts`
- `packages/core/src/sizing/apply-entry-mos-gate.test.ts`
- `packages/worker/src/clob/min-order-size.test.ts` (étendu)
