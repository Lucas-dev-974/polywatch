# Plan — P4 badge frontend & P5 monitoring sous-marchés

**Dernière mise à jour** : 2026-07-09
**Statut** : ✅ Implémenté (P4 + P5)
**Brainstorm** : `2026-07-08_brainstorm_redemption_winning_token_premature.md`

---

## Objectif

Compléter le correctif `winningTokenId ≠ settled` avec :
- **P4** : transparence UX pour l'utilisateur (badge "résultat connu" vs "rédemption")
- **P5** : observabilité ops (marchés `winningTokenId` + `!resolved` depuis > 24h)

---

## P4 — Badge frontend

### Problème

Après P1, une position sur sous-marché spread avec `winningTokenId` set et `resolved = false` apparaît en "Ouvertes" sans indication que le résultat du sous-token est déjà fixé.

### Implémentation

| Étape | Fichier | Action |
|-------|---------|--------|
| 1 | `packages/frontend/src/lib/position-tooltips.ts` | Tooltips `subMarketOutcomeKnown`, `redemptionInProgress` |
| 2 | `packages/frontend/src/lib/redemption-wait.ts` | Helpers `subMarketOutcomeKnownBadge()`, `redemptionProgressBadge()` |
| 3 | `packages/frontend/src/components/position/PositionOpenRowMeta.tsx` | Afficher les badges (jaune `warn`, bleu `accent`) |
| 4 | `packages/frontend/src/lib/position.ts` | Ré-exporter les helpers |
| 5 | `packages/frontend/src/lib/redemption-wait.test.ts` | Tests unitaires |

### Règles d'affichage

| Badge | Condition | Classe | Onglet |
|-------|-----------|--------|--------|
| **Résultat connu** | `marketWinningTokenId` set + `!marketResolved` | `warn` | Ouvertes / En attente (phase `awaiting_resolution`) |
| **Rédemption** | `getRedemptionWaitPhase() === 'awaiting_redemption'` | `accent` | En attente de rédemption |

Pas de changement backend — `marketWinningTokenId` et `marketResolved` déjà sur `Position`.

---

## P5 — Monitoring worker

### Problème

Aucune alerte quand des marchés restent longtemps en `winningTokenId set + resolved = false` (sous-marchés sportifs multi-jours).

### Implémentation

| Étape | Fichier | Action |
|-------|---------|--------|
| 1 | `packages/worker/src/processors/market-resolution-monitoring.ts` | `countStaleUnresolvedWinningTokenMarkets()`, constante 24h |
| 2 | `packages/worker/src/processors/market-resolution-watcher.ts` | Appel en fin de `processAll()` + log warn |
| 3 | `packages/worker/src/processors/market-resolution-monitoring.test.ts` | Test DB avec marché seedé |

### Requête

```sql
SELECT COUNT(*) FROM markets
WHERE winning_token_id IS NOT NULL
  AND resolved = false
  AND updated_at < NOW() - INTERVAL '24 hours'
```

Log : `WARN markets with winningTokenId but unresolved for >24h count=N`

---

## Tests

- Frontend : `redemption-wait.test.ts` — badges outcome known / redemption / null
- Worker : `market-resolution-monitoring.test.ts` — count avec marché stale seedé

---

## Documentation post-implémentation

Mettre à jour :
- `2026-07-08_brainstorm_redemption_winning_token_premature.md` — statut P4/P5 ✅
- `2026-07-08_patch_redemption_winning_token_premature.md` — sections P4/P5 marquées implémentées
