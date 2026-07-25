# Plan : Onglet « Overview Système » sur la page Système

**Date :** 2026-07-15  
**Version :** Polywatch v1.1  
**Auteur :** Assistant Polywatch  
**Statut :** Proposition validée, prête pour implémentation

---

## 1. Objectif métier

Ajouter un onglet **« Overview »** en première position de la page **Système**. Cet onglet doit offrir :

1. Une **vue d’ensemble de santé** des processus critiques : backend, worker, crypto-algo, Redis, PostgreSQL.
2. Une **vue des files Redis** et de l’état du worker (algo-order-signals, order-signals, execution-results, etc.).
3. Des **actions de diagnostic rapide** : boutons pour lancer les scripts d’audit existants (`tools/_audit-*.ts`, `tools/flush-redis-queues.ts`) et afficher leur sortie en direct.

Cela réduit le temps de diagnostic en cas de badge « Worker arrêté · file N » ou d’autres symptômes opérationnels, sans avoir à ouvrir manuellement un terminal et à se souvenir des commandes.

---

## 2. Constat et motivations

L’incident du 2026-07-15 a montré que le badge **« Worker arrêté · file 2 »** n’était pas un bug de l’UI, mais l’absence du processus worker dans la session `npm run dev`. Le diagnostic a nécessité :

- Vérifier les PIDs dans les terminaux.
- Lire Redis (`worker:heartbeat`, `algo-order-signals`).
- Lancer des commandes d’audit (`tools/_audit-redis-queues.ts`, etc.).

Ces opérations sont répétitives et requièrent une connaissance technique de la stack. Un onglet Overview centralisé les rend accessibles et réutilisables.

---

## 3. Analyse de l’existant

### 3.1 Page Système

- Conteneur : `packages/frontend/src/components/SystemPage.tsx`.
- Onglets persistés via `usePersistedEnum(UI_KEYS.systemTab, ...)`, défini dans `packages/frontend/src/lib/ui-persistence.ts`.
- Quatre onglets actuels : `reports`, `snapshots`, `e2e-tests`, `metrics`.

### 3.2 Patrons réutilisables

- **Métriques** (`MetricsDashboardPage.tsx`) : polling toutes les 10 s, `StatCard`, sections par domaine.
- **E2E Tests** (`E2eTestsPage.tsx`) : lancement d’un job, streaming de logs via WebSocket, terminal scrollable, historique.

### 3.3 Heartbeats déjà en place

- Worker : `worker:heartbeat` dans `packages/worker/src/index.ts`.
- Crypto-algo : `crypto-algo:heartbeat` dans `packages/crypto-algo/src/index.ts`.
- Crypto-algo runtime status : clé Redis `crypto-algo:runtime-status` avec `CryptoAlgoRuntimeStatusPayload`.

### 3.4 Endpoint worker queue status

- `GET /api/algo/worker-queue-status` dans `packages/backend/src/routes/algo-worker-queue-status.ts`.
- Retourne `workerAlive`, `algoOrderSignalsDepth`, `algoOrderSignalsProcessing`, `orderSignalsDepth`, `executionResultsDepth`, `level`, `hint`.

### 3.5 Scripts d’audit existants

- `tools/_audit-redis-queues.ts`
- `tools/_audit-redis-clients.ts`
- `tools/_audit-worker-liveness.ts`
- `tools/_audit-pending-algo.ts`
- `tools/_audit-recent-outcomes.ts`
- `tools/flush-redis-queues.ts` (avec `--confirm --release-reservations`)

---

## 4. Architecture proposée

### 4.1 Vue d’ensemble

```
Frontend                       Backend                        Redis/DB
────────                       ───────                        ────────
SystemOverviewPage  ─────GET──► /api/system/overview  ─────►  heartbeat keys
       │                              │                         files
       │                              │
       │────POST /api/system/audit───►│  spawn("npx tsx tools/...")
       │                              │  emit socket events
       │◄──── system:audit:log ──────│
       │      system:audit:finished
```

### 4.2 Principe de détection des services

On n’essaie **pas** de détecter les PIDs via des commandes système (`tasklist`, `ps`). Cela est peu fiable sous Windows + Docker + `concurrently` (bruit, faux positifs, permissions). On utilise les heartbeats Redis comme source de vérité :

- Service vivant si sa clé heartbeat Redis existe et est récente (TTL 60 s, intervalle 30 s).
- Service mort si la clé est absente ou expirée.
- Redis lui-même testé par un `PING`.
- PostgreSQL testé par une requête `SELECT 1` via TypeORM.
- Le backend expose son propre uptime et son PID dans la réponse.

---

## 5. Fichiers impactés

| Fichier | Changement |
|---|---|
| `packages/frontend/src/lib/ui-persistence.ts` | Ajouter `overview` dans `SystemPageTab` et `SYSTEM_PAGE_TABS` |
| `packages/frontend/src/components/SystemPage.tsx` | Ajouter le label et le rendu conditionnel de `SystemOverviewPage` |
| `packages/frontend/src/components/SystemOverviewPage.tsx` | **Nouveau** composant de l’onglet (contient `ServiceCard`, `QueueCard`, `WorkerStatusBadge` en interne) |
| `packages/frontend/src/hooks/useSystemOverview.ts` | **Nouveau** hook de polling avec `AbortController` et timeout 15 s |
| `packages/frontend/src/hooks/useSystemAudit.ts` | **Nouveau** hook pour lancer un audit et écouter les logs |
| `packages/frontend/src/socket.ts` | Ajouter les listeners `system:audit:*` |
| `packages/backend/src/routes/system-overview.ts` | **Nouveau** route `/api/system/overview` |
| `packages/backend/src/routes/system-audit.ts` | **Nouveau** route `/api/system/audit` + whitelist |
| `packages/backend/src/services/system-audit-runner.ts` | **Nouveau** exécuteur sécurisé de scripts |
| `packages/backend/src/index.ts` | Monter les nouvelles routes + nettoyage des processus enfants au shutdown |
| `packages/backend/src/websocket.ts` | Émettre les événements `system:audit:*` |
| `packages/backend/src/redis.ts` | Pas de changement — `getRedis()` existant suffit pour les opérations Redis de l'overview |
| `docs/plans/2026-07-15_PLAN_SYSTEM_OVERVIEW_TAB.md` | Ce document |

---

## 6. Spécification détaillée

### 6.1 Types de données

```typescript
// packages/frontend/src/lib/system-overview.ts
export interface ProcessStatus {
  name: string;
  alive: boolean;
  lastSeenAt: string | null; // ISO date depuis le heartbeat Redis
  uptimeSeconds: number | null;
  pid: number | null;
  extra?: Record<string, unknown>;
}

export interface RedisQueueStatus {
  name: string;
  depth: number;
  processing: number;
  dead?: number;
}

export interface ServiceHealth {
  redis: 'ok' | 'down';
  postgres: 'ok' | 'down';
  backend: 'ok' | 'down';
}

export interface SystemOverviewResponse {
  generatedAt: string;
  backend: {
    pid: number;
    uptimeSeconds: number;
    status: 'ok' | 'degraded';
  };
  services: ServiceHealth;
  processes: ProcessStatus[];
  queues: RedisQueueStatus[];
  workerQueueStatus: AlgoWorkerQueueStatus;
}

export type AuditScriptId =
  | 'redis-queues'
  | 'redis-clients'
  | 'worker-liveness'
  | 'pending-algo'
  | 'recent-outcomes'
  | 'flush-redis-queues';

export interface SystemAuditRequest {
  script: AuditScriptId;
  confirm?: boolean; // requis pour flush-redis-queues
}

export interface SystemAuditLogEvent {
  runId: string;
  line: string;
  timestamp: number;
}

export interface SystemAuditFinishedEvent {
  runId: string;
  exitCode: number;
  elapsedMs: number;
}
```

### 6.2 Backend — `/api/system/overview`

Route : `GET /api/system/overview`  
Middleware : `requireJwt`

Logique :

1. **Backend self-status**
   - `process.pid`
   - `process.uptime()`
   - `status = 'ok'`

2. **Redis health**
   - `await redis.ping()`
   - Si OK → `services.redis = 'ok'`
   - Sinon → `services.redis = 'down'`

3. **PostgreSQL health**
   - `await ds.query('SELECT 1')`
   - Si OK → `services.postgres = 'ok'`
   - Sinon → `services.postgres = 'down'`

4. **Processus via heartbeats**
   - Lire `worker:heartbeat`
   - Lire `crypto-algo:heartbeat`
   - Lire `crypto-algo:runtime-status`
   - Déterminer `alive = heartbeat !== null && Date.now() - ts <= 90_000` (marge pour le jitter)
   - Pour chaque processus, renvoyer `lastSeenAt`, `uptimeSeconds: null` (on n’a pas l’uptime distant), `pid: null`

5. **Files Redis**
   - `LLEN` sur : `algo-order-signals`, `algo-order-signals:processing`, `order-signals`, `execution-results`, `close-signals`, `move-events`
   - Optionnellement `LLEN` des dead-letter queues.

6. **Worker queue status**
   - Réutiliser la logique de `algo-worker-queue-status.ts` (ou importer la fonction existante).

### 6.3 Backend — `/api/system/audit`

Route : `POST /api/system/audit`  
Middleware : `requireJwt` + éventuellement `requireAdmin` si les scripts deviennent dangereux.

Whitelist des scripts (chemins résolus absolument, pas d’entrée utilisateur dans la commande) :

```typescript
const ALLOWED_AUDIT_SCRIPTS: Record<AuditScriptId, { path: string; args: string[]; dangerous: boolean }> = {
  'redis-queues': { path: 'tools/_audit-redis-queues.ts', args: [], dangerous: false },
  'redis-clients': { path: 'tools/_audit-redis-clients.ts', args: [], dangerous: false },
  'worker-liveness': { path: 'tools/_audit-worker-liveness.ts', args: [], dangerous: false },
  'pending-algo': { path: 'tools/_audit-pending-algo.ts', args: [], dangerous: false },
  'recent-outcomes': { path: 'tools/_audit-recent-outcomes.ts', args: [], dangerous: false },
  'flush-redis-queues': { path: 'tools/flush-redis-queues.ts', args: ['--confirm', '--release-reservations'], dangerous: true },
};
```

Comportement :

1. Valider `script` dans la whitelist. Sinon → 400.
2. Si `dangerous === true` et `confirm !== true` → 400 avec message explicite.
3. Générer un `runId` UUID.
4. Lancer `npx tsx <path> ...args` via `child_process.spawn`.
5. Streamer chaque ligne `stdout`/`stderr` via WebSocket : `system:audit:log`.
6. À la fin, émettre `system:audit:finished` avec `exitCode` et `elapsedMs`.
7. Retourner immédiatement `{ runId }` au frontend.

Contraintes de sécurité :

- Aucune chaîne utilisateur ne peut modifier le chemin ou les arguments.
- Les scripts sont dans `tools/`, résolus avec `path.resolve(import.meta.dirname, '../../tools/', ...)` (ou `__dirname` en CJS). Ne pas utiliser `process.cwd()` — le répertoire de travail peut varier selon le mode de lancement (hot-reload, Docker, `concurrently`).
- La purge est marquée `dangerous` et nécessite `confirm: true`.
- **Parallélisme : verrou par script.** Un `Map<AuditScriptId, { runId: string; child: ChildProcess }>` stocke les audits en cours. Si un audit est déjà actif pour le même `script`, retourner `409 Conflict` avec le `runId` existant. Cela évite les logs mélangés et les doubles purges simultanées.
- **Nettoyage au shutdown :** Le `Map` des processus enfants est accessible depuis le handler `shutdown` de `packages/backend/src/index.ts`. À l'arrêt du backend, tous les `child.kill()` sont appelés avant de fermer le serveur HTTP.

### 6.4 WebSocket events

Ajouter dans `packages/frontend/src/socket.ts` et dans le backend :

- `system:audit:log` → `{ runId, line, timestamp }`
- `system:audit:finished` → `{ runId, exitCode, elapsedMs }`
- `system:audit:started` → `{ runId, script }`

### 6.5 Frontend — `SystemOverviewPage.tsx`

Structure :

```
<main class="system-tab-content page-system-overview">
  <header>…</header>

  <!-- Section 1 : Services -->
  <section class="panel">
    <div class="panel-header"><h2>Services</h2></div>
    <div class="panel-body stat-row">
      <ServiceCard name="Backend" status={…} pid={…} uptime={…} />
      <ServiceCard name="Worker" status={…} lastSeen={…} />
      <ServiceCard name="Crypto Algo" status={…} lastSeen={…} extra={…} />
      <ServiceCard name="Redis" status={…} />
      <ServiceCard name="PostgreSQL" status={…} />
    </div>
  </section>

  <!-- Section 2 : Files Redis -->
  <section class="panel">
    <div class="panel-header"><h2>Files Redis</h2></div>
    <div class="panel-body stat-row">
      <QueueCard name="algo-order-signals" depth={…} processing={…} />
      <QueueCard name="order-signals" depth={…} processing={…} />
      <QueueCard name="execution-results" depth={…} processing={…} />
      <QueueCard name="close-signals" depth={…} processing={…} />
      <QueueCard name="move-events" depth={…} processing={…} />
    </div>
  </section>

  <!-- Section 3 : Worker algo -->
  <section class="panel">
    <div class="panel-header"><h2>Worker crypto-algo</h2></div>
    <div class="panel-body">
      <WorkerStatusBadge status={data.workerQueueStatus} />
      <p class="text-muted">{data.workerQueueStatus.hint}</p>
    </div>
  </section>

  <!-- Section 4 : Actions d’audit -->
  <section class="panel">
    <div class="panel-header"><h2>Actions de diagnostic</h2></div>
    <div class="panel-body">
      <For each={AUDIT_ACTIONS}>
        {(action) => (
          <button
            type="button"
            class="btn btn-primary"
            disabled={auditRunning()}
            onClick={() => runAudit(action.id)}
          >
            {action.label}
          </button>
        )}
      </For>
      <Show when={selectedAudit()}>
        <pre ref={logContainer}>{auditLogs()}</pre>
      </Show>
    </div>
  </section>
</main>
```

Détails UX :

- Polling toutes les **10 secondes** via `useSystemOverview`.
- Statut visuel : vert/orange/rouge.
- Pour l’action `flush-redis-queues`, afficher une boîte de confirmation native (`window.confirm`) avant d’appeler le backend.
- Le terminal d’audit est scrollable et se vide/recharge à chaque nouvel audit.

### 6.6 Frontend — hooks

`useSystemOverview.ts` :

- Polling `GET /api/system/overview` via `setInterval` toutes les 10 s.
- Gestion des états : `loading`, `data`, `error`.
- **Timeout :** Utiliser un `AbortController` avec un timeout de 15 s par requête. Si le backend ne répond pas dans ce délai, `error` reçoit un message explicite (« Le backend ne répond pas — vérifier que le serveur est en marche ») et le polling continue normalement au cycle suivant.
- Nettoyage : `clearInterval` et `AbortController.abort()` dans `onCleanup`.

`useSystemAudit.ts` :

- Fonction `runAudit(script)` qui POST `/api/system/audit`.
- Gère `runId`, `logs`, `running`, `finished`, `exitCode`.
- S’abonne aux événements socket `system:audit:*` via `onMount` / `onCleanup`.

---

## 7. Gestion des cas d’erreur et bugs fantômes évités

| Risque | Mitigation |
|---|---|
| Faux positif « worker mort » à cause du polling | Marge de 90 s sur le heartbeat ; intervalle réel 30 s, TTL 60 s |
| Détection PID fausse sous Windows | On n’utilise pas `tasklist`/`ps` ; on se base sur Redis |
| Exécution de commande arbitraire | Whitelist stricte, chemins absolus, pas d’entrée utilisateur dans `spawn` |
| Purge Redis accidentelle | `flush-redis-queues` est marqué `dangerous` et demande `confirm: true` + `window.confirm` frontend |
| Socket events qui polluent E2E | Préfixe d’événements distinct : `system:audit:*` |
| Backend down → UI bloquée sur « Chargement » | `AbortController` avec timeout 15 s dans `useSystemOverview` ; `error` explicite affiché |
| Redis down → overview incomplet | Endpoint continue de répondre avec DB/backend status, Redis marqué `down` |
| Crypto-algo sans heartbeat | Déjà implémenté dans le code actuel (`crypto-algo:heartbeat`) |
| Perte du runId côté client si refresh | L’historique n’est pas persisté pour la V1 ; acceptable |
| **Audit lancé deux fois en parallèle** | Verrou par `AuditScriptId` : `Map` côté backend, retour `409 Conflict` si déjà en cours |
| **Chemin de script invalide selon CWD** | Résolution par `import.meta.dirname` (ou `__dirname`), pas par `process.cwd()` |
| **Processus enfant orphelin au shutdown** | `Map<AuditScriptId, ChildProcess>` accessible depuis le handler `shutdown` ; `child.kill()` avant `server.close()` |

---

## 8. Phases d’implémentation

### Phase 1 — Backend : endpoint overview

1. Créer `packages/backend/src/routes/system-overview.ts`.
2. Implémenter `GET /api/system/overview` avec les règles du §6.2.
3. Monter la route dans `packages/backend/src/index.ts` sous `/api/system/overview`.
4. Tester avec `curl` / navigateur.

### Phase 2 — Backend : exécuteur d’audit

1. Créer `packages/backend/src/services/system-audit-runner.ts`.
2. Implémenter la whitelist, le `spawn`, le streaming socket.
3. Créer `packages/backend/src/routes/system-audit.ts`.
4. Ajouter les émetteurs d’événements dans `packages/backend/src/websocket.ts`.
5. Monter la route `POST /api/system/audit`.

### Phase 3 — Frontend : hook et composant overview

1. Ajouter `overview` dans `SystemPageTab` / `SYSTEM_PAGE_TABS`.
2. Créer `useSystemOverview.ts`.
3. Créer `SystemOverviewPage.tsx` avec les sections Services, Files, Worker, Actions.
4. Créer `useSystemAudit.ts`.
5. Intégrer dans `SystemPage.tsx`.

### Phase 4 — Validation

1. Ouvrir la page Système > Overview.
2. Vérifier que les 5 services sont affichés avec le bon statut.
3. Vérifier que les files Redis correspondent à Redis.
4. Lancer chaque audit et vérifier la sortie dans le terminal live.
5. Tester le cas dégradé : arrêter Redis, vérifier l’affichage.
6. Tester le cas worker arrêté : arrêter le worker, vérifier le badge et le statut.

---

## 9. Critères de succès

- [ ] L’onglet Overview est visible en première position de la page Système.
- [ ] Le statut du worker, du crypto-algo, du backend, de Redis et de PostgreSQL est affiché correctement.
- [ ] Les files Redis sont affichées avec leur profondeur et le nombre de jobs en cours.
- [ ] Le badge worker (vert/orange/rouge) reflète `AlgoWorkerQueueStatus.level`.
- [ ] Les boutons d’audit lancent les scripts existants et affichent leur sortie en direct.
- [ ] L’action de purge demande une confirmation explicite.
- [ ] Aucune commande arbitraire ne peut être exécutée via l’endpoint audit.

---

## 10. Notes et décisions

- **Pourquoi ne pas ajouter de heartbeat backend ?** Le backend est le point d’entrée de l’API. S’il est down, l’endpoint `/api/system/overview` ne répondra tout simplement pas, ce qui suffit à détecter son état.
- **Pourquoi pas de statut frontend ?** Le frontend est un navigateur, pas un processus serveur. Son état est implicite (l’utilisateur voit la page).
- **Pourquoi poller plutôt que WebSocket pour l’overview ?** L’overview contient des données légères qui changent lentement. Le polling 10 s est suffisant et plus simple. Seuls les audits utilisent WebSocket pour le streaming.
- **Pourquoi ne pas persister l’historique des audits ?** Hors scope initial. On peut l’ajouter plus tard en stockant les logs dans Redis ou en DB.
