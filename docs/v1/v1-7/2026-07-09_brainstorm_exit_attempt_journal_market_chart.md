# Brainstorm — Journal des tentatives de sortie non exécutées (Cours marché)

**Date** : 2026-07-09
**Version cible** : v1-7
**Statut** : Décision prise → implémenté (voir plan)
**Tags** : `observability`, `SL`, `TP`, `PRE_CLOSE`, `TIME_EXIT`, `market-chart`, `exit-attempts`, `copy-trading`, `crypto-algo`
**Références** :
- `docs/v1/v1-4/2026-07-09_patch_exit_emit_block_observability.md` — compteurs live pré-émission
- `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md` — Case B (décidé, jamais émis)
- `docs/v1/v1-4/2026-07-09_patch_pipeline_sorties_no_liquidity.md` — `forced_exit_failed_attempts`
- `docs/v1/v1-3/2026-07-07_plan_affichage_entry_sl_tp_graph.md` — overlays entrée/SL/TP sur le chart
- Plan d’implémentation : `2026-07-09_plan_exit_attempt_journal_market_chart.md`

---

## 1. Problème

Une sortie forcée (SL / TP / TRAILING / PRE_CLOSE_* / TIME_EXIT / KILL_SWITCH) peut être **décidée** puis **ne jamais s’exécuter** :

| Couche | Symptôme | Trace existante (v1-4) |
|--------|----------|-------------------------|
| **Pré-émission** | `closeReason` set, signal jamais enqueued (`no_close_bid`, MOS, cooldown, …) | `exit_emit_blocked_count`, `last_exit_block_*` |
| **Post-enqueue** | SELL enqueued, CLOB rejette (`no_liquidity`, …) | `forced_exit_failed_attempts`, rows `executions` failed |

Le dialogue **Cours marché** (listes positions ouvertes / attente rédemption / historique) montre entrée, seuils SL/TP et prix de sortie **réussie** — mais **aucune** tentative non exécutée.

### Lacune critique

Les compteurs live sont **remis à 0 à la clôture** (fill forced-exit ou close terminal). Conséquences :

- **Historique** : plus aucune trace sur la position des tentatives passées.
- **Rédemption** : une position qui n’a jamais vendu sur CLOB (Case B) peut arriver en rédemption avec compteurs déjà clearés ou peu lisibles.
- **Graphique** : pas de timestamps → impossible de corréler un épisode de blocage avec le cours.

Les alertes dashboard crypto-algo (`Sortie forcée bloquée`) ne couvrent que le **live** open-like, pas le post-mortem dans le dialog position.

---

## 2. Besoin UX

Depuis les items des listes **positions ouvertes**, **attente rédemption**, **historique** → dialog Cours marché :

1. **Sur le graphique** : indicateur des **tentatives SL non exécutées** (quand / pourquoi).
2. **Dans Debug & exécution** : nombre de tentatives par famille (SL / TP / PreClose / Exit…) + distinction blocage pré-émission vs échec CLOB.

---

## 3. Options de source de données

| Option | Idée | Pour | Contre |
|--------|------|------|--------|
| **1. MVP** | Compteurs live open/rédemption + agrégat `executions` failed en historique | Pas de schéma | Historique incomplet (pas de pré-émission) ; pas de marqueurs horodatés pour les blocks |
| **2. Persist on close** | Ne plus clear / snapshot des compteurs | Totaux visibles en historique | Toujours pas d’historique horodaté ; un seul « last » |
| **3. Journal append-only** | Table d’events à chaque observation throttlée / fail retryable | Marqueurs chart + breakdown partout ; survit à la clôture | Volume DB ; pas de backfill du passé |

**Décision** : option **3**.

Les compteurs live v1-4 restent pour les alertes dashboard ; le journal est la source de vérité **historique** pour le dialog.

---

## 4. Modèle mental du journal

```
Décision exit (évaluateur)
        │
        ├─ gate pré-emit échoue ──► kind=emit_blocked   (throttle ~5 s, comme le compteur)
        │
        └─ enqueue SELL
                │
                └─ CLOB fail retryable ──► kind=execution_failed  (même garde que forcedExitFailedAttempts++)
```

Sémantique volontaire :

- Un event `emit_blocked` ≠ un tick d’évaluateur → **observation throttlée** (« Observations bloquées » dans l’UI).
- Un fail CLOB **non retryable** n’incrémente pas le compteur live → **pas** d’event journal (aligné).
- Clear des compteurs à la clôture **ne touche pas** le journal.

---

## 5. Périmètre UI (v1 livrable)

| Surface | Contenu |
|---------|---------|
| Chart | Overlay **Tentatives SL** uniquement (éviter le bruit TP/TIME_EXIT) |
| Panel | Section **Tentatives de sortie** : totaux kind + breakdown `close_reason` (zéros masqués) + dernière |
| Listes | Open / rédemption / historique via `PositionMarketChartTrigger` + `copiedPositionId` |
| Hors position | `AlgoMarketChartTrigger` sans id → pas de fetch / pas de section |

Hors scope v1 : backfill positions déjà fermées, retention/TTL journal, marqueurs chart pour non-SL.

---

## 6. Risques retenus (garde-fous)

1. Insert journal **même transaction** que l’update compteur.
2. Idempotence : pas d’event sur re-finalize d’un `failed` déjà finalisé.
3. API `limit` bornée (défaut 500, max 2000).
4. Fetch attempts non bloquant pour le chart.
5. Marqueurs hors `[minT, maxT]` du plot **filtrés** (pas de clamp trompeur).
6. Dette : volume ~720 events/h si blocage long (1 / 5 s) — purge ultérieure.

---

## 7. Suite

Implémentation détaillée et fichiers livrés :  
`docs/v1/v1-7/2026-07-09_plan_exit_attempt_journal_market_chart.md`

### Suivi UX (post-v1)

Affichage du **prix d’évaluation** (`mark_bid`) sur les marqueurs SL : persisté dans le journal (pas d’interpolation chart). Voir plan §9.
