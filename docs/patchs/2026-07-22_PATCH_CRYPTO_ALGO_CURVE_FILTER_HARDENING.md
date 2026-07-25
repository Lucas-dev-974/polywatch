# PATCH : Durcissement filtre courbe descendante (entry crypto-algo)

**Date** : 2026-07-22  
**Contexte** : Correctifs post-audit du filtre courbe ([`2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md`](./2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md)).

## Problèmes corrigés

| Problème | Impact | Correction |
|----------|--------|------------|
| Lookback max UI/Zod 120 s vs buffer 60 s | Filtre on mais fail-open silencieux si lookback > 60 s | Plafond **60 000 ms** partout + `clampCurveLookbackMs()` à la lecture |
| Buffer mid non vidé au disconnect WS | Mids stale après reconnect → delta first→last incohérent | `MidHistoryBuffer.clearAll()` dans `price-feed.disconnect()` |
| Logs `insufficient` sans rate-limit | Spam debug + fuite Map lente | 1 log / 30 s / `conditionId` + prune clés > 60 s |

## Comportement après patch

### Lookback

- Écriture : rejet si `cryptoAlgoCurveLookbackMs` ∉ [1 000 ; 60 000] (Zod, validate tunables, UI).
- Lecture : `resolveNaiveMomentumConfig` clamp les valeurs stale en DB (ex. 120 000 → 60 000).
- Alignement avec `CURVE_BUFFER_MAX_MS = 60_000` (cap mémoire du ring buffer).

### Buffer WS

- Enregistrement des mids **avant** le debounce d'évaluation (inchangé).
- `disconnect()` vide le buffer → warm-up fail-open ~lookback après reconnect (voulu).

### Observabilité

- Abstain `curve_descending` inchangé (ticks / `last_abstain_reason`).
- Log debug « insufficient mid history » rate-limité (fail-open explicite sans spam).

## Refactors

- `MidHistorySample` : type unique dans `mid-history-buffer.ts`, réexporté par `strategy.ts`.
- `getOutcomeMidHistory` appelé seulement si `curveFilterEnabled` (pas de fetch inutile).
- Test : book illiquide → `illiquid_book` avant évaluation courbe.

## Fichiers modifiés

| Package | Fichiers |
|---------|----------|
| core | `crypto-algo-tunables.ts` (+ `clampCurveLookbackMs`, constantes min/max) |
| crypto-algo | `mid-history-buffer.ts`, `price-feed.ts`, `naive-momentum.strategy.ts`, `strategy.ts`, `strategy-runner.ts`, tests |
| backend | `routes/config.ts` (Zod max 60 000) |
| frontend | `CryptoAlgoSettingsGeneralTab.tsx` |
| docs | patch, `crypto-algo.md`, `configuration.md`, `code/07-crypto-algo.md` |

## Migration

Aucune migration SQL. Les valeurs DB > 60 s sont clampées à l'exécution.

## Critères d'acceptation

- Lookback > 60 s rejeté en écriture ; stale clampé à la lecture.
- Après disconnect WS, fenêtres mid vides.
- Filtre off : pas de fetch `midHistory`.
- Illiquidité cible évaluée avant gate courbe.
