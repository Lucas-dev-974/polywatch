# Audit — `PRE_CLOSE_LOSS` sim : 99,95 % d'échecs `no_liquidity`

**Date** : 13 juin 2026  
**Périmètre** : `packages/worker/src/processors/executor.ts`  
**Statut** : corrigé

## Symptôme

BDD : 6 173 exécutions sim `PRE_CLOSE_LOSS` sur 6 176 ont échoué (`no_liquidity`). Seulement 3 `filled`.

## Cause

`simulateFill` appelle `fetchBook` au moment de l'exécution. Entre l'émission du signal (pre-close, `bidVwap > 0`) et le traitement par l'executor, le marché se ferme sur Polymarket → carnet vide → échec immédiat.

## Correctif

Fallback sim-only pour les sorties forcées : si le carnet est vide mais que le signal porte un `referenceVwap` positif, `simulateFill` synthétise un niveau unique à ce prix pour permettre le FAK match.

Les entrées (`COPY_OPEN`, `COPY_INCREASE`) restent strictes (pas de fallback).

## Fichiers modifiés

- `packages/worker/src/processors/executor.ts` — `simulateFill` : fallback `referenceVwap` sur close signals  
- `packages/worker/dist/processors/executor.js` — aligné pour redémarrage immédiat sans rebuild

## Référence

- `SLIPPAGE_GUARDED_REASONS` (`packages/worker/src/constants.ts`) délimite les raisons qui **ne** bénéficient **pas** du fallback (entrées/TP).
