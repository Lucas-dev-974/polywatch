# Snapshots simulation

Les **snapshots simulation** enregistrent un instantané complet de l'état du mode
simulation à un moment donné : portefeuille, positions, exécutions, agrégats par
trader, configuration de risque et **journal décisionnel** (tentatives de sortie,
move events). Ils servent à **comparer** l'évolution de la session dans le temps
(equity, PnL, paramètres) sans modifier l'état courant.

> **Ne pas confondre** avec `TraderSnapshot` (`trader_snapshots`) : cette
> entité stocke le dernier état connu des positions **d'un trader suivi** pour
> le pipeline de détection des mouvements. Voir
> [`modele-donnees.md`](./modele-donnees.md#tradersnapshot-trader_snapshots).

## Objectif

- Garder une trace historique de la performance sim (equity, PnL session, traders).
- Comparer deux ou plusieurs instants (tableau métriques, deltas, diff traders).
- Capturer la **config sim** au moment T (SL/TP, sizing, réalisme d'exécution, tags marché, etc.).
- Archiver le **contexte décisionnel** (exit attempts, move events) sur une fenêtre glissante.
- Archiver automatiquement avant une réinitialisation ou à intervalle régulier.

## Déclencheurs

| Source | Quand | Label par défaut | `skipIfEmpty` |
|--------|-------|------------------|---------------|
| `manual` | Bouton **Snapshot** dans le hero sim ou **Nouveau snapshot** dans la page Snapshots (onglet Simulation) | Label optionnel saisi par l'utilisateur | non |
| `auto` | Boucle backend si activée dans la config | `Automatique` | oui — sauf si `simAutoSnapshotEmptySession` est activé |
| `reset` | Avant `POST /api/simulation-balance/reset` (**scopé au `algoKind` du body**) | `Avant réinitialisation` | oui — sauf si `simAutoSnapshotEmptySession` est activé |

La création passe par `SimulationArchiveService.createSnapshot()` dans
`packages/core/src/services/simulation-archive.service.ts`.

Toute la capture s'exécute dans **une seule transaction** : positions, exécutions,
portefeuille, config (cache bypass), enrichissement et payloads décisionnels utilisent
le même `EntityManager`.

## Sessions snapshot

Une **session** regroupe tous les snapshots d'une course de simulation, entre
deux réinitialisations **d'un même périmètre algo**.

Les trois périmètres `crypto` / `weather` / `copy` sont **indépendants** : chacun a
sa propre balance (`simulation_balances.algo_kind`), sa propre session `active`,
son capital initial (`simInitialCapitalCrypto|Weather|Copy`), et son reset isolé.

| Concept | Règle |
|---------|--------|
| Périmètre | `algoKind` ∈ `{ crypto, weather, copy }` |
| Ouverture | Seed / premier snapshot (`ensureActiveSession(algoKind)`) |
| Attache | Chaque snapshot porte `session_id` + `algo_kind` |
| Clôture | Au reset **du kind** : snapshot `reset` (si créé) → close session → wipe **du kind** → open nouvelle session |
| Snapshot `reset` | Appartient à la session **qui se termine** |
| Isolation | Reset crypto ne touche ni cash, ni positions, ni Redis des kinds weather/copy |

### Table `simulation_sessions`

- `algo_kind` : `crypto` \| `weather` \| `copy`
- `status` : `active` \| `closed` (**une seule active par `algo_kind`**, unique partiel)
- Agrégats : `snapshot_count`, `peak_equity`, `trough_equity`, `ending_equity`, `ending_session_pnl`
- Métadonnées : `label`, `notes` (éditables)
- Lien : `simulation_balances.current_session_id` (une ligne balance **par** kind)
- `archive_summary_json` : compteurs archivés au reset (positions, exécutions, bougies, …)

### Archivage par session (reset)

Lors d'un `POST /api/simulation-balance/reset` avec `archive: true` (défaut) et
**`algoKind` requis**, seule la session active **du kind** est archivée **avant**
le wipe dans des tables `sim_archive_*` :

| Table | Contenu |
|-------|---------|
| `sim_archive_positions` | Positions sim (copie + `raw_json`) |
| `sim_archive_executions` | Exécutions sim |
| `sim_archive_exit_attempts` | `exit_attempt_events` sim depuis `session.started_at` |
| `sim_archive_surveillance` | `algo_surveillance_snapshots` |
| `sim_archive_price_candles` | Bougies OHLC 1 min (algo / market / position ticks) |

`deepClean: true` purge ensuite ticks marché / surveillance / exit attempts **liés
aux conditions du kind** (pas un wipe marché global), et réinitialise
`market_price_history_sync` pour ces conditions (sans toucher aux lignes
surveillance **live** hors périmètre).

Indépendamment de `deepClean`, le wipe positions weather supprime aussi les
`weather_position_forecasts` des positions effacées (même transaction). Le reset
copy **ne flippe plus** `MoveEvent.processed` globalement — il marque seulement
`skipReasons.sim = 'session_reset'` sur les moves des traders watchlist sim.
`recoverOrphanMoves` ré-enqueue toujours ces orphans ; `CopyProcessor` ignore
l'entrée sim et conserve le copy **réel**.

#### Hygiène Redis (après wipe DB)

Après le commit transactionnel du reset, le backend appelle
`purgeSimExecutionRedisState(hints, algoKind)` :

1. **Avant** delete DB : `collectSimRedisPurgeHints(ds, algoKind)` —
   réservations + **toutes** les positions sim du kind (tous statuts) →
   `copiedPositionIds` / `copySignalIds` / clés logiques ; + traders watchlist
   sim (copy) et villes weather avec positions wipees (weather).
2. **Après** commit :
   - queues d'**entrée** dédiées uniquement (`algo-order-signals` /
     `weather-order-signals` / `order-signals` + `:processing`) : jobs `mode:sim`
     dont la raison d'entrée mappe au kind ;
   - **copy** : drain `move-events` (+ `:processing`) pour les jobs des traders
     watchlist **sim** et suppression de leurs marqueurs dedupe
     `move-events:enqueued:{id}` — anti re-entrée phantom ;
   - **weather** : suppression `weather-reentry:{city}:sim` (villes wipees) et
     `weather-bucket-hysteresis:{positionId}` — évite throttle/hystérésis orphelins ;
   - **`close-signals`** : jobs `mode:sim` dont `copiedPositionId ∈ hints.copiedPositionIds`
     (jamais classer un `SL`/`TP` via `algoKindFromReason` — ces raisons retombent
     sur `crypto`) ;
   - **`execution-results`** : match par `orderSignalId` (réservations ou closes
     retirés) **ou** raison **spécifique** au kind (`ALGO_*` / `COPY_*` /
     `WEATHER_*` après gate) — jamais SL/TP/TRAILING/MANUAL via mapping raison ;
   - marqueurs dedup/retry et `algo-entry-cooldown:${logicalKey}:sim` du périmètre.
3. Les autres kinds et le trading **réel** (`mode:real`) ne sont **pas** touchés.

Réponse API : champ `redisPurge` (compteurs). Pub/sub `simulation-reset` inclut
`algoKind` pour que le FE / workers filtrent.

> Pour un incident worker-down (file saturée, worker arrêté), `tools/flush-redis-queues.ts` reste l'outil manuel ; le reset sim ne remplace pas une purge globale d'urgence.

Voir [`plans/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md`](./plans/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md).

UI : `NewSessionResetDialog` (prop `algoKind`, forcé `crypto` après apply rapport
algo) ; reset manuel depuis `SimHero` sur le kind affiché. Consultation : bouton
**Archive** sur session fermée (`SimSessionArchiveDialog`).

#### UI archives — périmètre actuel et évolutions possibles

**En place (consultation uniquement)** :

- `NewSessionResetDialog` : déclenche l’archivage au reset (options `archive`, `deepClean`, label de session).
- `SimSessionArchiveDialog` : lecture seule depuis **Snapshots → Sessions → Archive** (sessions fermées avec `archiveSummary`).
- Onglets Positions / Exécutions / Sorties / Surveillance / Bougies ; résumé des compteurs ; chargement limité à 100 lignes par type côté UI (l’API supporte la pagination).

**Hors scope v1 (non implémenté — évolution future si besoin)** :

- Page ou hub dédié « Gestion des archives ».
- Suppression d’une archive sans supprimer la session (`sim_archive_*` restent liées à la session ; seul `DELETE /simulation-sessions/:id` existe aujourd’hui).
- Export CSV/JSON, détail `raw_json`, graphiques sur les bougies.
- Pagination / filtres avancés dans le dialog de consultation.

### API sessions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/simulation-sessions` | Liste paginée — **`algoKind` requis** + `status`, `label`, `from`, `to` |
| GET | `/api/simulation-sessions/current` | Session active — **`algoKind` requis** |
| GET | `/api/simulation-sessions/:id` | Détail (inclut `archiveSummary`) — **`algoKind` requis** ; 404 si mismatch kind |
| GET | `/api/simulation-sessions/:id/archive` | Archive paginée (`type`, `limit`, `offset`) |
| PATCH | `/api/simulation-sessions/:id` | `{ label?, notes? }` |
| DELETE | `/api/simulation-sessions/:id` | Session fermée — **`algoKind` requis** (`?deleteSnapshots=true`) |
| DELETE | `/api/simulation-sessions/closed` | Toutes les sessions fermées du kind — **`algoKind` requis** |

`GET /api/simulation-snapshots` exige aussi **`algoKind`** (et accepte `sessionId`).

### UI

Onglets **Crypto / Weather / Copy** dans `SimulationSnapshotsPanel` et `SimHero`
pour basculer le périmètre (sessions, snapshots, balance, reset).

Page nav **Snapshots** → onglet **Simulation** (`SnapshotsPage` → `SimulationSnapshotsPanel`) :

**Disposition** : chaque vue affiche d'abord la liste (cartes + pagination), puis le
panneau de comparaison **en pleine largeur sous la liste** dès qu'au moins un élément
est coché (pas de colonne latérale).

**Commun aux deux vues**

- Hero « Session en cours » (label, PnL live, durée, baseline, actions renommer / voir snapshots)
- Rafraîchissement temps réel via WebSocket (`simulation_snapshot_created`, `simulation_reset`)
- Boutons d'en-tête : **Nouveau snapshot**, **Configurer**, **Supprimer tous**

**Vue Sessions** (sous-onglet **Sessions**)

| Zone | Composant | Rôle |
|------|-----------|------|
| Filtres | barre inline | Statut (`all` / `active` / `closed`), recherche label |
| Liste | `SimSessionCard` | Cartes session (checkbox **Comparer**, renommer, supprimer si fermée) — affiche en preview la **diff de configuration** (SL/TP/trailing/threshold, sizing, copy ratio, crypto algo) entre les sessions sélectionnées |
| Pagination | 12 par page | Sélection conservée entre pages |
| Comparaison | `SimSessionComparePanel` | Sous la liste — référence, Δ absolu / Δ %, métriques session |
| Actions groupées | Bouton **Supprimer la sélection** | Visible quand ≥ 1 session cochée — confirmation avec/sans snapshots, suppression concurrente (`Promise.all`) + un seul rafraîchissement |

Métriques comparées (sessions) : label, statut, début/fin, durée, baseline, equity
finale, PnL session, peak/trough equity, drawdown peak→trough, nombre de snapshots,
PnL par snapshot. Résumé Δ PnL affiché quand exactement 2 sessions sont sélectionnées.

**Diff de configuration** : quand ≥ 2 sessions sont sélectionnées, chaque carte
`SimSessionCard` affiche un aperçu des paramètres qui diffèrent entre les sessions
(par groupe : entrée, copie, sortie, risque, snapshots, exécution, crypto algo).
Les paramètres identiques sont masqués. La comparaison supporte N sessions (pas
seulement 2). Voir [`snapshot-config-diff.ts`](#snapshot-config-diff) pour la logique.

Actions session : **Voir snapshots** bascule sur la vue Snapshots avec filtre `sessionId` ;
barre « Filtré sur session #… » + lien **Voir tous les snapshots**.

**Vue Snapshots** (sous-onglet **Snapshots**)

| Zone | Composant | Rôle |
|------|-----------|------|
| Filtres | `SimSnapshotFilters` | Source, label, plage de dates (+ filtre session implicite) |
| Résumé | barre `mode-hero` | Dernier snapshot de la page, delta equity, total filtré |
| Graphique | `SimSnapshotEquityChart` | Courbe equity (jusqu'à 200 points, filtres appliqués) |
| Liste | `SimSnapshotCard` | Cartes KPI, badge session, sélection pour comparaison |
| Pagination | 12 par page | Sélection conservée entre pages |
| Comparaison | `SimSnapshotComparePanel` | Sous la liste — référence, Δ absolu / Δ %, diff traders (2 snapshots) |
| Détail | `SimSnapshotDetailDialog` | Traders, config, positions, exécutions, **onglet Décisions** |

État et chargement : hook `useSimulationSnapshots`
(`packages/frontend/src/hooks/useSimulationSnapshots.ts`) — gère les deux vues, les
sélections multi-éléments (snapshots et sessions), la pagination et les filtres.

Logique de comparaison :

- Snapshots : `packages/frontend/src/lib/sim-snapshot-compare.ts`
- Sessions : `packages/frontend/src/lib/sim-session-compare.ts`

## Contenu d'un snapshot

Chaque enregistrement combine des **colonnes indexées** (requêtes liste/filtre)
et des **payloads JSON** (détail complet).

### Résumé (`SimStateSnapshotSummary`)

Exposé par la liste API et les cartes UI :

- Identité : `id`, `createdAt`, `label`, `source`
- Portefeuille : `amount` (cash), `token`, `positionsValue`, `equity`,
  `baselineCapital`, `sessionPnl` (= `equity - baselineCapital`)
- Agrégats : `openPnlSum`, `closedPnlSum`, compteurs positions/exécutions/traders
- `tradersLabel` : libellé synthétique des traders actifs

Les compteurs `openPositionCount` / `closedPositionCount` suivent la sémantique
open-like / strict `closed`. Le détail `decisionSummary.positionsByStatus` et
`otherPositionCount` couvrent les statuts intermédiaires (`pending`, `cancelled`, …).

### Détail (`SimStateSnapshotDetail`)

Retourné par `GET /api/simulation-snapshots/:id` :

| Champ JSON | Contenu |
|------------|---------|
| `config` | Snapshot des champs sim de `RiskConfig` (`SimRiskConfigSnapshot`) — inclut sizing, SL/TP, auto-snapshot, **réalisme d'exécution** (`simExec*`, `simSelfImpact*`, `simShadow*`, `shadowSampleRetentionDays`) |
| `traders` | Rollup par trader (watchlist sim, PnL réalisé/ouvert, compteurs) |
| `positions` | Positions sim enrichies (`CopiedPositionPresenter`) |
| `executions` | Toutes les exécutions sim à l'instant T |
| `exitAttempts` | Journal `exit_attempt_events` mode `sim` sur la fenêtre décisionnelle |
| `moveEvents` | Move events des traders watchlist sim-enabled sur la même fenêtre |
| `decisionSummary` | Agrégats (compteurs par kind/type, fenêtre, flag `truncated`) |

Les snapshots créés **avant** la migration `AddSnapshotSystemV2170000000045` ont
`decisionSummary: null` et des tableaux vides pour exit/move events.

### Fenêtre décisionnelle

`windowFrom = max(`

- `now - simSnapshotDecisionWindowHours` (défaut 24 h),
- `createdAt` du dernier snapshot (toute source),
- `sessionStartedAt` sur `simulation_balances` (mis à jour à chaque reset).

`)`

Les move events sont filtrés par **trader sim-enabled** (pas seulement les
`conditionId` des positions courantes), afin d'inclure les OPEN bloqués
(`skipReasons.sim`).

Limite : 500 events par type ; troncature avec `decisionSummary.truncated = true`
si le JSON dépasse 2 Mo.

## Modèle de données

Table `simulation_state_snapshots`, entité `SimulationStateSnapshot`
(`packages/core/src/entities/SimulationStateSnapshot.ts`).

Colonnes JSON : `config_json`, `traders_json`, `positions_json`, `executions_json`,
`exit_attempts_json`, `move_events_json`, `decision_summary_json`.

Pas de clé étrangère vers les lignes courantes : le snapshot est **immuable** et autonome.

Tables liées :

- `simulation_balances.session_started_at` — borne de session pour la fenêtre décisionnelle.
- `exit_attempt_events.mode` — `'sim' | 'real'` (backfill depuis positions/exécutions).

Voir aussi [`modele-donnees.md`](./modele-donnees.md).

## Algo surveillance (positions figées)

Pour les marchés crypto-algo, `algo_surveillance_snapshots` stocke désormais
`positions_json` + `positions_captured_at` au moment du **close redemption**
(`recordCloseSnapshot`, `resolveFallbackCloseFromMarket`).

À la lecture, les positions figées sont prioritaires ; sinon fallback sur le join live.
Le DTO expose `positionsFrozen: true` quand les données proviennent du JSON archivé.

## API REST

Routes montées dans `packages/backend/src/routes/simulation.ts`.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/simulation-snapshots` | Liste paginée — **`algoKind` requis** + filtres |
| POST | `/api/simulation-snapshots` | Création manuelle `{ algoKind, label?: string }` |
| GET | `/api/simulation-snapshots/:id` | Détail complet |
| DELETE | `/api/simulation-snapshots` | Supprime les snapshots **du kind** — **`algoKind` requis** (`?algoKind=crypto\|weather\|copy`) ; 400 sinon. Autres kinds intacts. |

### Query params (GET liste)

| Param | Type | Description |
|-------|------|-------------|
| `algoKind` | `crypto` \| `weather` \| `copy` | **Requis** — périmètre |
| `limit` | number | Défaut 50, max 200 |
| `offset` | number | Défaut 0 |
| `source` | `manual` \| `auto` \| `reset` | Filtre par source |
| `label` | string | Sous-chaîne insensible à la casse sur le label |
| `from` | date ISO (`YYYY-MM-DD`) | Créé à partir de ce jour (inclus) |
| `to` | date ISO | Créé jusqu'à ce jour (inclus, fin de journée) |
| `sessionId` | number | Limite aux snapshots d'une session (`simulation_sessions.id`) |

Réponse : `{ items: SimStateSnapshotSummary[], total: number }`.

## WebSocket

| Événement | Déclencheur | Usage frontend |
|-----------|-------------|----------------|
| `simulation_snapshot_created` | Création manuelle, auto ou reset (**si** snapshot créé) | Rafraîchit la liste dans l'onglet Snapshots |
| `simulation_reset` | Après reset sim (payload inclut `algoKind`) | Rafraîchit liste + balance ; `SimHero` filtre par kind affiché |

Le frontend écoute ces événements dans `useSimulationSnapshots` et `SimHero`.

## Snapshots automatiques

Boucle `startSimAutoSnapshotLoop()` (`packages/backend/src/simulation/auto-snapshot-loop.ts`) :

- Tick toutes les **30 s** ; vérifie `simAutoSnapshotEnabled` dans `RiskConfig`.
- Intervalle utilisateur : `simAutoSnapshotIntervalSeconds` (minimum **60 s**).
- `createAutoSnapshotIfDue` boucle les **trois** kinds (`crypto`, `weather`, `copy`)
  avec cooldown **par kind** (dernier `source=auto` filtré par `algo_kind`).
- `skipIfEmpty: true` par défaut : pas de snapshot si le kind n'a ni position ni
  exécution sim, **sauf** si `simAutoSnapshotEmptySession` est activé (snapshot config-only).

Configuration dans l'UI : dialog **Configurer** (onglet Snapshots) ou champs
`simAutoSnapshotEnabled` / `simAutoSnapshotIntervalSeconds` / `simAutoSnapshotEmptySession`
/ `simSnapshotDecisionWindowHours` via `PUT /api/config/global`.

Valeurs par défaut en base : auto désactivé, intervalle 3600 s (1 h), fenêtre décision 24 h.

## Métriques Prometheus

- `polywatch_snapshot_created_total{source}` — incrémenté uniquement si un snapshot est réellement créé.
- `polywatch_snapshot_count` — gauge synchronisé après create, prune et delete-all (plus seulement à la purge totale).

## Interface utilisateur (résumé)

Voir la section **UI** dans [Sessions snapshot](#sessions-snapshot) pour le détail des
vues Sessions / Snapshots, la disposition verticale (comparaison sous la liste) et les
composants associés.

Page nav **Snapshots** → onglet **Simulation** (`SnapshotsPage.tsx` → `SimulationSnapshotsPanel`).

## Flux typiques

### Comparer deux sessions de simulation

1. Nav **Snapshots** → onglet **Simulation** → sous-onglet **Sessions**.
2. Cocher au moins 2 sessions fermées ou actives.
3. Le panneau **Comparaison de sessions** apparaît sous la grille.
4. Choisir la session de référence et basculer Δ absolu / Δ %.
5. Optionnel : **Voir snapshots** sur une session pour inspecter ses instantanés.

### Comparer avant / après changement de config

1. Enregistrer un snapshot manuel (« avant changement SL »).
2. Modifier la config sim dans les réglages.
3. Laisser tourner la session ou enregistrer un second snapshot.
4. Cocher les deux cartes → panneau **Comparaison avancée** (sous la liste) → choisir la
   référence et inspecter les deltas (config incluse dans le tableau).

### Reset avec archive

1. L'utilisateur choisit le kind (onglets hero) et confirme **Réinitialiser**.
2. Le backend crée un snapshot `reset` **pour ce kind** si le périmètre a de
   l'activité (ou si `simAutoSnapshotEmptySession` est activé).
3. Puis `SimulationService.resetWithManager(algoKind, …)` remet cash / positions /
   historique **du kind** à zéro, **clôture** la session du kind et **ouvre** une
   nouvelle session active (`SimulationSessionService.rotateAfterReset(algoKind, …)`).
4. Le montant de capital utilisé est persisté dans
   `simInitialCapitalCrypto|Weather|Copy` selon le kind (préremplissage des
   prochains resets de ce kind uniquement). Les autres kinds et le reste de la
   config **ne sont pas** modifiés.

## Déploiement

Appliquer les migrations avant d'utiliser les sessions et le journal décisionnel :

```bash
npm run migrate -w packages/core
```

Migrations concernées :

| Migration | Apport |
|-----------|--------|
| `AddSnapshotSystemV2170000000045` | JSON décisionnel, `session_started_at`, `exit_attempt_events.mode`, champs risk config snapshot |
| `AddSimulationSessions1700000000046` | Table `simulation_sessions`, `session_id` sur snapshots, `current_session_id` sur balance |
| `SimBalancePerAlgoKind…` (0084) | Partition `simulation_balances` par `algo_kind` |
| `SimSessionsPerAlgoKind1700000000085` | `algo_kind` sur sessions + snapshots ; une session active **par** kind |
| `AddSimInitialCapitalPerAlgoKind1700000000086` | `sim_initial_capital_{crypto,weather,copy}` sur `risk_config` |

## Fichiers sources

| Couche | Fichier |
|--------|---------|
| Entité | `packages/core/src/entities/SimulationStateSnapshot.ts` |
| Types | `packages/core/src/types/sim-state-snapshot.ts` |
| Collector décisions | `packages/core/src/simulation/snapshot-decision-collector.ts` |
| Sessions | `packages/core/src/services/simulation-session.service.ts` |
| Entité session | `packages/core/src/entities/SimulationSession.ts` |
| Service | `packages/core/src/services/simulation-archive.service.ts` |
| Config sim snapshot | `packages/core/src/risk/sim-mode-fields.ts` |
| Routes | `packages/backend/src/routes/simulation.ts` |
| Auto-loop | `packages/backend/src/simulation/auto-snapshot-loop.ts` |
| Timing | `packages/core/src/simulation/auto-snapshot-timing.ts` |
| Migration | `packages/core/src/migrations/AddSnapshotSystemV2170000000045.ts`, `AddSimulationSessions1700000000046.ts`, `SimSessionsPerAlgoKind1700000000085.ts`, `AddSimInitialCapitalPerAlgoKind1700000000086.ts` |
| Capital / rotation | `packages/core/src/simulation/sim-initial-capital.ts`, `packages/core/src/risk/sim-rotation-targets.ts` |
| Redis hygiene | `packages/core/src/redis/sim-reset-redis-hygiene.ts` |
| API client | `packages/frontend/src/lib/simulation-snapshots.ts`, `simulation-sessions.ts` |
| Compare snapshots | `packages/frontend/src/lib/sim-snapshot-compare.ts` |
| Compare sessions | `packages/frontend/src/lib/sim-session-compare.ts` |
| Diff config snapshot | `packages/frontend/src/lib/snapshot-config-diff.ts` |
| Affichage config snapshot | `packages/frontend/src/lib/snapshot-config-display.ts` |
| UI | `SimulationSnapshotsPanel.tsx`, `SimSessionCard.tsx`, `SimSessionComparePanel.tsx`, `SnapshotConfigDiffPanel.tsx`, composants `SimSnapshot*` |

## Voir aussi

- [`api.md`](./api.md) — référence REST condensée
- [`frontend.md`](./frontend.md) — navigation et composants
- [`configuration.md`](./configuration.md) — variables d'environnement et config risque
