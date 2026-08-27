# Snapshots réel (périodes)

Les **snapshots réel** enregistrent un instantané observationnel du mode réel :
portefeuille (cash on-chain lu à T, pas modifié), positions, exécutions, config
`real_*` et journal décisionnel. Ils servent à **comparer** l'évolution entre
**périodes** sans toucher au wallet ni aux positions ouvertes.

> Distinct des snapshots simulation — voir [`snapshots-simulation.md`](./snapshots-simulation.md).
> L'onglet Activité (Réel) reste un **ledger live** ; l'historique longitudinal
> est dans la page nav **Snapshots** → onglet **Réel**.

## Objectif

- Borner des périodes analytiques (pas de reset de capital).
- Archiver les positions **fermées** de la période à la clôture.
- Conserver les positions **open-like** (`open`, `closing`, `pending_resolution`, `failed`) en live.
- Comparer snapshots et périodes comme en simulation.

## Vocabulaire

| Terme sim | Terme réel |
|-----------|------------|
| Reset | **Clôturer la période** |
| Session | **Période** |
| `POST /simulation-balance/reset` | `POST /api/real-sessions/rotate` |

## Déclencheurs

| Source | Quand | Label par défaut |
|--------|-------|------------------|
| `manual` | Bouton **Snapshot** dans `RealHero` ou page Snapshots | Label optionnel |
| `auto` | Boucle backend si `realAutoSnapshotEnabled` | `Automatique` |
| `rotate` | Avant `POST /api/real-sessions/rotate` | `Avant clôture de période` |

Service : `RealArchiveService.createSnapshot()` dans
`packages/core/src/services/real-archive.service.ts`.

## Capital observationnel

- `amount` / `observed_cash` : cash on-chain (ou indisponible → rotate **abort 503**).
- `positions_value`, `equity` : calculés depuis les positions réelles + marchés.
- `baseline_capital` de la période active = **equity** au début de période (pas le cash seul), pour éviter un PnL session fictif sur les positions reportées.
- KPI `realizedPnlInPeriod` : PnL des positions fermées dans `[startedAt, endedAt]`.

**Jamais** : écriture `wallet_accounts`, credentials, `realCashOverride`, balances on-chain.

## Clôture de période (`POST /api/real-sessions/rotate`)

Corps : `{ archive?: true, clearClosedLive?: false, newPeriodLabel?: string }`.

Ordre transactionnel :

1. Advisory lock (`real-rotate-lock`)
2. Snapshot `source=rotate` (wallet requis)
3. Si `archive` : copie positions `closed` avec `closed_at ∈ [startedAt, rotateAt)` → `real_archive_*`
4. Si `clearClosedLive` : DELETE live **uniquement** les IDs archivés (+ exécutions / exit attempts / ticks liés)
5. Fermeture période + ouverture nouvelle (`baselineCapital = observed_equity`)

Défauts : `archive=true`, **`clearClosedLive=false`** (l'Activité garde l'historique closed en live tant que l'utilisateur n'opte pas pour le clear).

## Tables

| Table | Rôle |
|-------|------|
| `real_sessions` | Périodes (`active` / `closed`) |
| `real_session_state` | Singleton : `current_session_id`, `period_started_at` |
| `real_state_snapshots` | Instantanés immuables |
| `real_archive_positions` | Positions fermées archivées |
| `real_archive_executions` | Exécutions liées |
| `real_archive_exit_attempts` | Tentatives de sortie liées |

Bootstrap migration : session `Legacy (avant périodes)` si closed `mode=real` existent avant la première période active.

## API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/real-snapshots` | Liste paginée |
| POST | `/api/real-snapshots` | Création manuelle |
| GET | `/api/real-snapshots/:id` | Détail |
| DELETE | `/api/real-snapshots` | Supprimer tous |
| GET | `/api/real-sessions` | Liste périodes |
| GET | `/api/real-sessions/current` | Période active |
| GET | `/api/real-sessions/:id` | Détail |
| GET | `/api/real-sessions/:id/archive` | Archive paginée |
| PATCH | `/api/real-sessions/:id` | `{ label?, notes? }` |
| DELETE | `/api/real-sessions/:id` | Période fermée (`?deleteSnapshots=true`) |
| POST | `/api/real-sessions/rotate` | Clôturer la période |

## UI

- Nav **Snapshots** → onglet **Réel** : `RealSnapshotsPanel`
- Consultation archive : `RealSessionArchiveDialog` (miroir de `SimSessionArchiveDialog`, lecture seule depuis Snapshots → Réel → sessions fermées avec `archiveSummary`)
- `RealHero` : **Snapshot**, **Clôturer la période** (`RealPeriodCloseDialog`)
- WebSocket : `real_snapshot_created`, `real_period_rotated` (pas d'alias `simulation_reset`)

### Comparaison de configuration entre périodes

Lorsque plusieurs périodes sont sélectionnées (cases à cocher), la carte de chaque période
affiche en **preview** les paramètres de configuration qui diffèrent entre les périodes
sélectionnées (SL, TP, trailing, sizing, mode copie, algo crypto, etc.).

- **N périodes** : la comparaison fonctionne pour un nombre quelconque d'éléments (pas seulement 2).
- **Preview dans la carte** : seuls les paramètres qui changent sont affichés, avec la valeur
  de chaque période (ex. `SL 0.1 → 0.2`).
- **Groupes** : les paramètres sont regroupés par catégorie (Entrée, Copie, Sortie, Risque,
  Snapshots, Exécution, Crypto Algo, Autre).
- **Panel détaillé** : `SnapshotConfigDiffPanel` affiche la configuration complète avec
  les différences mises en évidence, incluant les paramètres copy-trading et crypto algo.
- **Snapshots legacy** : les snapshots anciens (sans clés crypto algo) n'affichent pas
  ces paramètres (pas de faux positif).

Logique de comparaison : `packages/frontend/src/lib/snapshot-config-diff.ts`
Affichage formaté : `packages/frontend/src/lib/snapshot-config-display.ts`

### Suppression groupée de périodes

Un bouton **Supprimer la sélection** apparaît dans l'en-tête de la liste des périodes
lorsqu'au moins une période est cochée. La suppression utilise `Promise.all` pour la
concurrence et un seul rafraîchissement final :

1. Confirmation : demande si les snapshots associés doivent aussi être supprimés.
2. Exécution concurrente via `Promise.all(ids.map(id => deleteRealSession(id, deleteSnapshots)))`.
3. Un seul `refresh()` après toutes les suppressions.

Hook : `useRealSnapshots` → `deleteSelectedSessions()`

## Config auto-snapshot

Clés `GlobalConfig` : `realAutoSnapshotEnabled`, `realAutoSnapshotIntervalSeconds`,
`realSnapshotMaxCount`, `realSnapshotRetentionDays`, `realSnapshotDecisionWindowHours`.

Dialog **Configurer** : `RealSnapshotSettingsDialog`.

## Métriques Prometheus

`polywatch_snapshot_created_total{mode,source}` et `polywatch_snapshot_count{mode}` avec `mode=real`.

## Miroir sim/real (C1)

Paire de la couche simulation — **pas** de fusion générique (décision Q2).
Correspondance et constantes partagées : voir [`snapshots-simulation.md`](./snapshots-simulation.md) § « Miroir sim/real (C1) ».

Sources code real : `real/snapshot-decision-collector.ts`, `real/trader-rollup.ts`,
`real/real-rotate-lock.ts`, `services/real-archive.service.ts`,
`services/real-session.service.ts`, `services/real-period-archive.service.ts`,
`services/real-portfolio.service.ts`.

## Hors scope v1

- Restore / rejeu live
- `deepClean` ticks marché partagés
- Rapports Crypto Algo mode réel
- `session_id` sur `copied_positions` live
