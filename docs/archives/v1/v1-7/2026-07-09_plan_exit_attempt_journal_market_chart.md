# Plan — Journal des tentatives de sortie (Cours marché)

**Date** : 2026-07-09
**Dernière mise à jour** : 2026-07-09
**Version cible** : v1-7
**Statut** : ✅ Implémenté
**Brainstorm** : `2026-07-09_brainstorm_exit_attempt_journal_market_chart.md`
**Tags** : `observability`, `exit-attempts`, `market-chart`, `SL`

---

## 1. Objectif

Rendre visibles, dans le dialogue **Cours marché** (listes open / rédemption / historique) :

1. les **tentatives SL non exécutées** sur le graphique ;
2. les **compteurs** de tentatives SL / TP / PreClose / Exit… dans le panneau Debug & exécution ;

via un **journal append-only** qui survit à la clôture (contrairement aux compteurs live v1-4).

---

## 2. Architecture livrée

```
PositionExitEvaluator.noteBlock
        │
        ▼
CopiedPositionService.recordExitEmitBlock  ──tx──►  exit_attempt_events (emit_blocked)
        + update exit_emit_blocked_*

ExecutionService.finalize (failed retryable)
        │
        ▼
forcedExitFailedAttempts++  ──même tx──►  exit_attempt_events (execution_failed)

GET /api/copied-positions/:id/exit-attempts
        │
        ▼
MarketChartDialog (useExitAttempts)
   ├─ UpDownPriceChart          → overlay Tentatives SL
   └─ MarketChartDebugPanel     → section Tentatives de sortie
```

---

## 3. Backend

### 3.1 Schéma — `exit_attempt_events`

Migration : `CreateExitAttemptEvents1700000000036`

| Colonne | Rôle |
|---------|------|
| `id` | PK serial |
| `copied_position_id` | Position concernée |
| `kind` | `emit_blocked` \| `execution_failed` |
| `close_reason` | SL, TP, TRAILING, PRE_CLOSE_*, TIME_EXIT, KILL_SWITCH, … |
| `block_reason` | nullable — motifs `EXIT_EMIT_BLOCK_REASONS` |
| `error` | nullable — erreur CLOB retryable |
| `execution_id` | nullable — lien `executions` si `execution_failed` |
| `mark_bid` | nullable — bid de décision / émission (0–1) ; null = legacy |
| `created_at` | timestamp observation |

Index : `(copied_position_id, created_at)`, `(copied_position_id, close_reason)`.

### 3.2 Write-paths

| Source | Condition d’insert | Fichier |
|--------|--------------------|---------|
| Pré-émission | Même throttle ~5 s que l’incrément `exitEmitBlockedCount` ; **même transaction** | `copied-position.service.ts` → `recordExitEmitBlock` |
| Post-enqueue | `isForcedExitCloseReason` + `isForcedExitRetryableError` ; uniquement quand le compteur s’incrémente ; **même transaction** que `finalize` | `execution.service.ts` |

`clearExitEmitBlock` / clear à la clôture : **ne supprime pas** les rows journal.

### 3.3 API & service

| Élément | Détail |
|---------|--------|
| Service | `ExitAttemptEventService` — `record`, `listByPosition` |
| Route | `GET /api/copied-positions/:id/exit-attempts` (JWT, pattern `/:id/ticks`) |
| Pagination | `limit` défaut 500, max 2000 ; `offset` ; order `created_at ASC, id ASC` |

Pas de backfill des positions fermées avant déploiement.

---

## 4. Frontend

### 4.1 Câblage contexte

| Fichier | Changement |
|---------|------------|
| `market-chart.ts` | `MarketChartContext.copiedPositionId` |
| `position-market-chart.ts` | Mappe `pos.id` → `copiedPositionId` |
| `PositionMarketChartTrigger` / `AlgoMarketChartTrigger` | Forward `copiedPositionId` + **`entryPrice`** (gap corrigé) |
| `MarketChartDialogHost` | Passe `copiedPositionId` au dialog |
| `useExitAttempts.ts` | Fetch non bloquant ; échec → items vides + erreur soft |

Sans `copiedPositionId` (surveillance marché seule) : pas de fetch, pas de section tentatives.

### 4.2 Graphique

| Élément | Comportement |
|---------|--------------|
| Toggle | **Tentatives SL** (`showSlExitAttempts`, ON par défaut si events SL) |
| Marqueurs | Lignes verticales + points (jaune) aux `created_at` où `closeReason === 'SL'` |
| Fenêtre | Events hors `[minT, maxT]` du plot **ignorés** (`buildSlExitAttemptMarkers`) |
| Tooltip | `SL / {block_reason\|error}` + heure |
| Non-SL | Pas de marqueurs chart (compteurs panel seulement) |

Fichiers : `UpDownPriceChart.tsx`, `updown-chart-overlays.ts`, CSS `.updown-chart-sl-attempt-*`.

### 4.3 Panneau Debug & exécution

Nouvelle section **Tentatives de sortie** (`MarketChartDebugPanel`) :

- **Observations bloquées** = count `emit_blocked` (libellé throttle-aware)
- **Échecs CLOB** = count `execution_failed`
- Breakdown par `close_reason` (zéros masqués) : SL, TP, TRAILING, PRE_CLOSE_LOSS, PRE_CLOSE_WIN, TIME_EXIT, KILL_SWITCH, …
- **Dernière** : détail + âge relatif
- Erreur fetch → « Journal / indisponible » (chart reste utilisable)

Helpers : `packages/frontend/src/lib/exit-attempts.ts`.

---

## 5. Fichiers livrés

| Zone | Fichiers |
|------|----------|
| Core | `entities/ExitAttemptEvent.ts`, migration `0036`, `exit-attempt-event.service.ts`, `copied-position.service.ts`, `execution.service.ts`, `database/data-source.ts`, `entities/index.ts`, `services/index.ts` |
| Backend | `routes/positions.ts` |
| Frontend | `exit-attempts.ts`, `useExitAttempts.ts`, `MarketChartDialog.tsx`, `MarketChartDebugPanel.tsx`, `MarketChartDialogHost.tsx`, `UpDownPriceChart.tsx`, `updown-chart-overlays.ts`, triggers, `position-market-chart.ts`, `market-chart.ts`, `styles.css` |
| Tests | `exit-attempt-event.service.test.ts`, extensions `execution.service.test.ts`, `exit-attempts.test.ts` |

---

## 6. Tests / validation

```bash
npm run test -w packages/core -- src/services/exit-attempt-event.service.test.ts src/services/execution.service.test.ts
npm run test -w packages/frontend -- src/lib/exit-attempts.test.ts src/lib/updown-chart-overlays.test.ts
```

Couvert :

- throttle emit_blocked + survie du journal après `clearExitEmitBlock`
- list pagination
- journal `execution_failed` + idempotence re-finalize + pas d’event si erreur non retryable
- `buildSlExitAttemptMarkers` filtre SL + fenêtre temps
- summarize / breakdown UI helpers

Build : `packages/core`, `packages/backend`, `packages/frontend` OK.

---

## 7. Ops / déploiement

1. Redémarrer backend (et worker si besoin) pour appliquer la migration `0036`.
2. Les tentatives **antérieures** au déploiement n’apparaissent pas (pas de backfill).
3. Compteurs live + alertes dashboard v1-4 **inchangés**.

---

## 8. Dette / hors scope

- Retention / purge TTL du journal (volume si blocage long)
- Marqueurs chart pour TP / PRE_CLOSE / TIME_EXIT
- Backfill historique
- Ownership user-scoped sur `GET .../exit-attempts` (même modèle JWT-only que `/:id/ticks`)

---

## 9. Suivi — mark_bid (prix d’évaluation)

**Statut** : ✅ Implémenté (2026-07-09)

| Élément | Détail |
|---------|--------|
| Colonne | `exit_attempt_events.mark_bid` (migration `0037`) |
| Pré-émission | `decisionBidVwap` (`triggerBidVwap ?? executableBidVwap`) passé via `noteBlock` → `recordExitEmitBlock` |
| Post-enqueue | `executions.reference_vwap` (bid d’émission) au finalize failed |
| Chart | Point à `(t, markBid)` converti Mid/Bid/Ask comme les lignes SL ; legacy `markBid=null` → Y fixe en haut |
| Tooltip / panel | Affiche `@ X.X¢` quand mark connu |
