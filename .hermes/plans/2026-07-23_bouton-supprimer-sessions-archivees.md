# Bouton « Supprimer les sessions archivées » — Plan d'implémentation

> **Pour Hermes :** Utiliser subagent-driven-development pour implémenter ce plan tâche par tâche.

**Objectif :** Ajouter un bouton « Supprimer sessions archivées » dans chaque panneau (Simulation et Réel) de l'onglet Système → Snapshots, à côté du bouton « Supprimer tous » existant. Ce bouton supprime toutes les sessions fermées (`status='closed'`) **et leurs snapshots liés**, en une seule opération.

**Architecture :** Nouvelle route backend `DELETE /real-sessions/closed` et `DELETE /simulation-sessions/closed` qui suppriment en masse les sessions `status='closed'` + leurs snapshots. Côté frontend, nouvelle fonction API par mode, méthode dans le hook, et bouton dans le panel header.

**Tech Stack :** Node.js, Express, TypeORM (PostgreSQL), SolidJS, TypeScript.

**Décisions confirmées avec l'utilisateur :**
- « Session archivée » = `status='closed'` (toutes les fermées, qu'elles aient un `archiveSummary` ou non)
- Les snapshots liés sont **supprimés en cascade** (pas détachés)
- Un bouton par panneau (RealSnapshotsPanel ET SimulationSnapshotsPanel), à côté de « Supprimer tous »
- Couvre les deux modes : Simulation ET Réel

---

## Contexte technique

### Structure actuelle

```
SystemPage.tsx
  └─ onglet "snapshots" → SnapshotsPage.tsx
       ├─ sous-onglet "sim"  → SimulationSnapshotsPanel.tsx
       └─ sous-onglet "real" → RealSnapshotsPanel.tsx
```

Chaque panneau a un header avec 3 boutons :
1. **Nouveau snapshot** → `setCreateOpen(true)`
2. **Configurer** → `setSettingsOpen(true)`
3. **Supprimer tous** → `snap.deleteAll()` (supprime tous les **snapshots**, pas les sessions)

La vue « Périodes/Sessions » liste les sessions avec filtre `status: 'all' | 'active' | 'closed'`.

### Suppression existante

| Opération | Route | Service |
|-----------|-------|---------|
| Supprimer 1 session | `DELETE /real-sessions/:id?deleteSnapshots=true` | `RealSessionService.deleteSession()` |
| Supprimer tous les snapshots | `DELETE /real-snapshots` | `RealArchiveService.deleteAllSnapshots()` |
| Supprimer sélection | Boucle `deleteRealSession()` côté frontend | — |

**Manquant :** Suppression en masse des sessions `status='closed'` + leurs snapshots.

### Contrainte clé

`deleteSession()` vérifie `status === 'active'` → lance `cannot_delete_active_session`. Le bulk doit faire la même garde : **ne jamais toucher aux sessions actives**.

---

## Plan

### Task 1: Backend — Méthode `deleteAllClosedSessions` dans `RealSessionService`

**Objectif :** Ajouter une méthode qui supprime toutes les sessions `status='closed'` et leurs snapshots liés.

**Files :**
- Modify: `packages/core/src/services/real-session.service.ts` (ajouter méthode à la fin de la classe, avant l'accolade de fermeture ligne ~420)

**Step 1 : Implémenter la méthode**

Ajouter après `deleteSession()` (ligne 419) :

```typescript
  /**
   * Delete all closed sessions and their associated snapshots in one transaction.
   * Active sessions are never touched.
   * Returns the number of sessions deleted and snapshots removed.
   */
  async deleteAllClosedSessions(): Promise<{
    sessionsDeleted: number;
    snapshotsDeleted: number;
  }> {
    return this.ds.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(RealSession);
      const snapshotRepo = manager.getRepository(RealStateSnapshot);

      // Find all closed session IDs
      const closedSessions = await sessionRepo.find({
        where: { status: 'closed' as const },
        select: ['id'],
      });
      if (closedSessions.length === 0) {
        return { sessionsDeleted: 0, snapshotsDeleted: 0 };
      }
      const ids = closedSessions.map((s) => s.id);

      // Delete snapshots for those sessions
      const snapshotResult = await snapshotRepo
        .createQueryBuilder()
        .delete()
        .where('session_id IN (:...ids)', { ids })
        .execute();
      const snapshotsDeleted = snapshotResult.affected ?? 0;

      // Delete the sessions
      const sessionResult = await sessionRepo
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids })
        .execute();
      const sessionsDeleted = sessionResult.affected ?? 0;

      return { sessionsDeleted, snapshotsDeleted };
    });
  }
```

**Step 2 : Vérifier la compilation**

```bash
cd packages/core && npx tsc --noEmit
```

Expected : pas de nouvelles erreurs.

**Step 3 : Commit**

```bash
git add packages/core/src/services/real-session.service.ts
git commit -m "feat: add deleteAllClosedSessions to RealSessionService"
```

---

### Task 2: Backend — Méthode `deleteAllClosedSessions` dans `SimulationSessionService`

**Objectif :** Même chose pour le mode simulation.

**Files :**
- Modify: `packages/core/src/services/simulation-session.service.ts` (ajouter méthode après `deleteSession()`, ligne ~422)

**Step 1 : Implémenter la méthode**

Ajouter après `deleteSession()` :

```typescript
  /**
   * Delete all closed sessions and their associated snapshots in one transaction.
   * Active sessions are never touched.
   * Returns the number of sessions deleted and snapshots removed.
   */
  async deleteAllClosedSessions(): Promise<{
    sessionsDeleted: number;
    snapshotsDeleted: number;
  }> {
    return this.ds.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(SimulationSession);
      const snapshotRepo = manager.getRepository(SimulationStateSnapshot);

      const closedSessions = await sessionRepo.find({
        where: { status: 'closed' as const },
        select: ['id'],
      });
      if (closedSessions.length === 0) {
        return { sessionsDeleted: 0, snapshotsDeleted: 0 };
      }
      const ids = closedSessions.map((s) => s.id);

      const snapshotResult = await snapshotRepo
        .createQueryBuilder()
        .delete()
        .where('session_id IN (:...ids)', { ids })
        .execute();
      const snapshotsDeleted = snapshotResult.affected ?? 0;

      const sessionResult = await sessionRepo
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids })
        .execute();
      const sessionsDeleted = sessionResult.affected ?? 0;

      return { sessionsDeleted, snapshotsDeleted };
    });
  }
```

**Step 2 : Vérifier imports**

S'assurer que `SimulationStateSnapshot` est déjà importé en haut du fichier (il l'est, car `deleteSession` l'utilise déjà à la ligne 403).

**Step 3 : Vérifier la compilation**

```bash
cd packages/core && npx tsc --noEmit
```

**Step 4 : Commit**

```bash
git add packages/core/src/services/simulation-session.service.ts
git commit -m "feat: add deleteAllClosedSessions to SimulationSessionService"
```

---

### Task 3: Backend — Route `DELETE /real-sessions/closed`

**Objectif :** Exposer la nouvelle méthode via une route API.

**Files :**
- Modify: `packages/backend/src/routes/real-sessions.ts` (ajouter après la route `DELETE /real-sessions/:id`, ligne ~209)

**Attention :** La route `DELETE /real-sessions/closed` doit être déclarée **AVANT** `DELETE /real-sessions/:id` pour éviter qu'Express matche "closed" comme `:id`. En réalité, Express matche dans l'ordre de déclaration, donc il faut placer `DELETE /real-sessions/closed` **avant** `DELETE /real-sessions/:id`.

**Step 1 : Ajouter la route**

Placer ce code **avant** la route `router.delete('/real-sessions/:id', ...)` (avant la ligne 186) :

```typescript
  router.delete('/real-sessions/closed', requireJwt, async (_req, res) => {
    const result = await sessionService.deleteAllClosedSessions();
    await refreshSnapshotCount();
    emitRealSnapshotCreated();
    res.json(result);
  });
```

**Note :** Pas de try/catch — on suit le même pattern que `DELETE /real-snapshots` (ligne 310) qui laisse l'error handler global d'Express gérer les erreurs. La méthode `deleteAllClosedSessions()` ne lance pas `cannot_delete_active_session` (elle filtre `status='closed'`), donc aucune erreur spécifique à catcher.

**Step 2 : Vérifier l'ordre des routes**

S'assurer que `DELETE /real-sessions/closed` apparaît **avant** `DELETE /real-sessions/:id` dans le fichier. Express teste les routes dans l'ordre de déclaration ; si `:id` est déclaré en premier, il capturera "closed" comme paramètre.

**Step 3 : Vérifier la compilation**

```bash
cd packages/backend && npx tsc --noEmit
```

**Step 4 : Commit**

```bash
git add packages/backend/src/routes/real-sessions.ts
git commit -m "feat: add DELETE /real-sessions/closed route"
```

---

### Task 4: Backend — Route `DELETE /simulation-sessions/closed`

**Objectif :** Même route pour le mode simulation.

**Files :**
- Modify: `packages/backend/src/routes/simulation.ts` (ajouter **avant** la route `DELETE /simulation-sessions/:id`, ligne ~518)

**Step 1 : Ajouter la route**

Placer ce code **avant** la route `router.delete('/simulation-sessions/:id', ...)` :

```typescript
  router.delete('/simulation-sessions/closed', requireJwt, async (_req, res) => {
    const result = await sessionService.deleteAllClosedSessions();
    await refreshSnapshotCount();
    emitSimulationSnapshotCreated();
    res.json(result);
  });
```

**Note :** Pas de try/catch — même pattern que `DELETE /simulation-snapshots` (ligne 563). `emitSimulationSnapshotCreated` est déjà importé (ligne 33). `log` n'est pas utilisé ici.

**Step 2 : Vérifier l'ordre des routes**

`DELETE /simulation-sessions/closed` doit être **avant** `DELETE /simulation-sessions/:id`.

**Step 3 : Vérifier la compilation**

```bash
cd packages/backend && npx tsc --noEmit
```

**Step 4 : Commit**

```bash
git add packages/backend/src/routes/simulation.ts
git commit -m "feat: add DELETE /simulation-sessions/closed route"
```

---

### Task 5: Frontend lib — Fonction `deleteAllClosedRealSessions`

**Objectif :** Wrapper API côté frontend pour le mode réel.

**Files :**
- Modify: `packages/frontend/src/lib/real-sessions.ts` (ajouter après `deleteRealSession()`, ligne ~74)

**Step 1 : Ajouter la fonction**

```typescript
export interface RealClosedSessionsDeleteResult {
  sessionsDeleted: number;
  snapshotsDeleted: number;
}

export async function deleteAllClosedRealSessions(): Promise<RealClosedSessionsDeleteResult> {
  return api<RealClosedSessionsDeleteResult>('/real-sessions/closed', {
    method: 'DELETE',
  });
}
```

**Step 2 : Vérifier la compilation frontend**

```bash
cd packages/frontend && npx tsc --noEmit
```

**Step 3 : Commit**

```bash
git add packages/frontend/src/lib/real-sessions.ts
git commit -m "feat: add deleteAllClosedRealSessions API wrapper"
```

---

### Task 6: Frontend lib — Fonction `deleteAllClosedSimulationSessions`

**Objectif :** Wrapper API côté frontend pour le mode simulation.

**Files :**
- Modify: `packages/frontend/src/lib/simulation-sessions.ts` (ajouter après `deleteSimulationSession()`)

**Step 1 : Vérifier la structure existante de `simulation-sessions.ts`**

Lire le fichier pour confirmer l'emplacement d'insertion (après la fonction `deleteSimulationSession`).

**Step 2 : Ajouter la fonction**

```typescript
export interface SimulationClosedSessionsDeleteResult {
  sessionsDeleted: number;
  snapshotsDeleted: number;
}

export async function deleteAllClosedSimulationSessions(): Promise<SimulationClosedSessionsDeleteResult> {
  return api<SimulationClosedSessionsDeleteResult>(
    '/simulation-sessions/closed',
    { method: 'DELETE' },
  );
}
```

**Step 3 : Vérifier la compilation**

```bash
cd packages/frontend && npx tsc --noEmit
```

**Step 4 : Commit**

```bash
git add packages/frontend/src/lib/simulation-sessions.ts
git commit -m "feat: add deleteAllClosedSimulationSessions API wrapper"
```

---

### Task 7: Frontend hook — `deleteAllClosedSessions` dans `useRealSnapshots`

**Objectif :** Ajouter la méthode au hook pour qu'elle soit callable depuis le panel.

**Files :**
- Modify: `packages/frontend/src/hooks/useRealSnapshots.ts`

**Step 1 : Mettre à jour l'import**

Dans l'import depuis `'../lib/real-sessions'` (ligne 8-12), ajouter `deleteAllClosedRealSessions` :

```typescript
import {
  deleteAllClosedRealSessions,
  deleteRealSession,
  fetchCurrentRealSession,
  fetchRealSessions,
  updateRealSession,
} from '../lib/real-sessions';
```

**Step 2 : Ajouter la méthode `deleteAllClosedSessions`**

Ajouter après `deleteAll()` (après la ligne 544), avant `onMount` :

```typescript
  async function deleteAllClosedSessions() {
    const confirmed = confirm(
      'Supprimer toutes les périodes fermées et leurs snapshots ?\n\nCette action est irréversible.',
    );
    if (!confirmed) return false;
    setDeleting(true);
    try {
      await deleteAllClosedRealSessions();
      clearSelection();
      clearSessionSelection();
      setDetails(new Map());
      setPage(0);
      setSessionsPage(0);
      await refresh();
      return true;
    } finally {
      setDeleting(false);
    }
  }
```

**Notes :**
- `clearSelection()` reset les snapshots sélectionnés (comme `deleteAll()` le fait ligne 536) — nécessaire car on supprime aussi des snapshots.
- `clearSessionSelection()` reset les sessions sélectionnées.
- `setPage(0)` reset la page snapshots (comme `deleteAll()` ligne 538) — sinon l'UI peut afficher une page vide « Page N / 1 ».
- `setSessionsPage(0)` reset la page sessions.

**Step 3 : Exposer la méthode dans le return**

Dans l'objet retourné (ligne 560-613), ajouter :

```typescript
    deleteAllClosedSessions,
```

(par exemple après `deleteAll,` à la ligne 612)

**Step 4 : Vérifier la compilation**

```bash
cd packages/frontend && npx tsc --noEmit
```

**Step 5 : Commit**

```bash
git add packages/frontend/src/hooks/useRealSnapshots.ts
git commit -m "feat: add deleteAllClosedSessions to useRealSnapshots hook"
```

---

### Task 8: Frontend hook — `deleteAllClosedSessions` dans `useSimulationSnapshots`

**Objectif :** Même méthode pour le hook simulation.

**Files :**
- Modify: `packages/frontend/src/hooks/useSimulationSnapshots.ts`

**Step 1 : Mettre à jour l'import**

Dans l'import depuis `'../lib/simulation-sessions'` (ligne 8-12), ajouter `deleteAllClosedSimulationSessions` :

```typescript
import {
  deleteAllClosedSimulationSessions,
  deleteSimulationSession,
  fetchCurrentSimulationSession,
  fetchSimulationSessions,
  updateSimulationSession,
} from '../lib/simulation-sessions';
```

**Step 2 : Ajouter la méthode**

Ajouter après `deleteAll()` (avant `onMount`), sur le même modèle que le hook real :

```typescript
  async function deleteAllClosedSessions() {
    const confirmed = confirm(
      'Supprimer toutes les sessions fermées et leurs snapshots ?\n\nCette action est irréversible.',
    );
    if (!confirmed) return false;
    setDeleting(true);
    try {
      await deleteAllClosedSimulationSessions();
      clearSelection();
      clearSessionSelection();
      setDetails(new Map());
      setPage(0);
      setSessionsPage(0);
      await refresh();
      return true;
    } finally {
      setDeleting(false);
    }
  }
```

**Notes :** Même logique que le hook real — `clearSelection()` + `setPage(0)` nécessaires car la suppression touche aussi les snapshots.

**Step 3 : Exposer dans le return**

Ajouter `deleteAllClosedSessions,` dans l'objet retourné.

**Step 4 : Vérifier la compilation**

```bash
cd packages/frontend && npx tsc --noEmit
```

**Step 5 : Commit**

```bash
git add packages/frontend/src/hooks/useSimulationSnapshots.ts
git commit -m "feat: add deleteAllClosedSessions to useSimulationSnapshots hook"
```

---

### Task 9: Frontend UI — Bouton dans `RealSnapshotsPanel`

**Objectif :** Ajouter le bouton « Supprimer sessions archivées » dans le panel header, à côté de « Supprimer tous ».

**Files :**
- Modify: `packages/frontend/src/components/RealSnapshotsPanel.tsx` (ligne ~130-137)

**Step 1 : Ajouter le bouton**

Remplacer le bloc du bouton « Supprimer tous » (lignes 130-137) :

```tsx
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAll()}
            >
              {snap.deleting() ? 'Suppression…' : 'Supprimer tous'}
            </button>
```

Par :

```tsx
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAll()}
            >
              {snap.deleting() ? 'Suppression…' : 'Supprimer tous'}
            </button>
            <button
              type="button"
              class="btn btn-danger btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAllClosedSessions()}
              title="Supprimer toutes les périodes fermées et leurs snapshots"
            >
              {snap.deleting() ? 'Suppression…' : 'Suppr. sessions archivées'}
            </button>
```

**Note :** Le bouton utilise `btn-danger` pour le distinguer visuellement de « Supprimer tous » (`btn-secondary`). Il est désactivé quand `snap.deleting()` est true (état partagé avec deleteAll et deleteSelectedSessions).

**Step 2 : Vérifier la compilation + build**

```bash
cd packages/frontend && npx tsc --noEmit && npm run build
```

**Step 3 : Commit**

```bash
git add packages/frontend/src/components/RealSnapshotsPanel.tsx
git commit -m "feat: add 'Suppr. sessions archivées' button to RealSnapshotsPanel"
```

---

### Task 10: Frontend UI — Bouton dans `SimulationSnapshotsPanel`

**Objectif :** Même bouton pour le panneau simulation.

**Files :**
- Modify: `packages/frontend/src/components/SimulationSnapshotsPanel.tsx` (ligne ~107-114)

**Step 1 : Ajouter le bouton**

Remplacer le bloc du bouton « Supprimer tous » (lignes 107-114) :

```tsx
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAll()}
            >
              {snap.deleting() ? 'Suppression…' : 'Supprimer tous'}
            </button>
```

Par :

```tsx
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAll()}
            >
              {snap.deleting() ? 'Suppression…' : 'Supprimer tous'}
            </button>
            <button
              type="button"
              class="btn btn-danger btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAllClosedSessions()}
              title="Supprimer toutes les sessions fermées et leurs snapshots"
            >
              {snap.deleting() ? 'Suppression…' : 'Suppr. sessions archivées'}
            </button>
```

**Step 2 : Vérifier la compilation + build**

```bash
cd packages/frontend && npx tsc --noEmit && npm run build
```

**Step 3 : Commit**

```bash
git add packages/frontend/src/components/SimulationSnapshotsPanel.tsx
git commit -m "feat: add 'Suppr. sessions archivées' button to SimulationSnapshotsPanel"
```

---

### Task 11: Tests & validation finale

**Objectif :** Vérifier que tout compile, que le build passe, et que les tests existants ne cassent pas.

**Step 1 : Build global**

```bash
npm run build
```

Expected : tous les packages compilent sans erreur.

**Step 2 : Lint**

```bash
npm run lint
```

Expected : pas de nouveaux warnings/erreurs sur les fichiers modifiés.

**Step 3 : Tests (si existants sur les routes/services modifiés)**

```bash
npm run test
```

Expected : pas de régression.

**Step 4 : Test manuel (optionnel)**

Démarrer le backend + frontend, aller sur Système → Snapshots → mode Réel, vérifier :
- Le bouton « Suppr. sessions archivées » apparaît à côté de « Supprimer tous »
- Cliquer → confirm dialog → les sessions fermées sont supprimées
- Les sessions actives ne sont pas touchées
- Idem en mode Simulation

**Step 5 : Commit final**

```bash
git add -A
git commit -m "test: validation bouton supprimer sessions archivées"
```

---

## Risques & points d'attention

1. **Ordre des routes Express** : `DELETE /real-sessions/closed` DOIT être déclaré avant `DELETE /real-sessions/:id`, sinon Express matche "closed" comme `:id` et retourne 400 (invalid_id). C'est le piège classique — les tâches 3 et 4 insistent sur ce point.

2. **Transaction & performance** : La méthode `deleteAllClosedSessions` fait un `find` puis deux `delete` en masse dans une transaction. Si le nombre de sessions fermées est très grand (centaines), les `IN (:...ids)` pourraient atteindre des limites PostgreSQL (1000 params max par query). En pratique, Polywatch a peu de sessions fermées, donc c'est acceptable. Si besoin, on pourrait paginer.

3. **État `deleting` partagé** : Le signal `deleting()` est partagé entre `deleteAll`, `deleteSelectedSessions`, et le nouveau `deleteAllClosedSessions`. Pendant une suppression en masse, tous les boutons sont désactivés — c'est le comportement souhaité.

4. **Socket refresh** : Après suppression, on appelle `emitRealSnapshotCreated()` / `emitSimulationSnapshotCreated()` pour forcer le refresh côté frontend via WebSocket (même pattern que `deleteAllSnapshots`).

5. **Pas de route `POST`** : On utilise `DELETE` pour rester RESTful et cohérent avec `DELETE /real-sessions/:id` et `DELETE /real-snapshots`.

6. **`archiveSummary` non utilisé** : La définition retenue est `status='closed'` (toutes les fermées), pas seulement celles avec `archiveSummary != null`. Le critère est donc purement le statut.

7. **Tables d'archive orphelines (limitation connue, pas un bug)** : Les tables `real_archive_positions`, `real_archive_executions`, `real_archive_exit_attempts` (et équivalents sim + `sim_archive_price_candles`, `sim_archive_surveillance`) ont un `sessionId` mais **pas de FK**. Supprimer une session laisse ces données orphelines en DB. Cependant, c'est le **même comportement que `deleteSession()` existant** — il ne nettoie pas non plus les tables d'archive. Et `getArchive()` retourne `null` si la session n'existe plus, donc pas de crash. Le plan est cohérent avec le code existant. Si on veut corriger ça, ce sera un ticket séparé (cleanup des archives orphelines).

---

## Résumé des fichiers modifiés

| Fichier | Type | Tâche |
|---------|------|-------|
| `packages/core/src/services/real-session.service.ts` | Ajout méthode | 1 |
| `packages/core/src/services/simulation-session.service.ts` | Ajout méthode | 2 |
| `packages/backend/src/routes/real-sessions.ts` | Ajout route | 3 |
| `packages/backend/src/routes/simulation.ts` | Ajout route | 4 |
| `packages/frontend/src/lib/real-sessions.ts` | Ajout fonction | 5 |
| `packages/frontend/src/lib/simulation-sessions.ts` | Ajout fonction | 6 |
| `packages/frontend/src/hooks/useRealSnapshots.ts` | Ajout méthode | 7 |
| `packages/frontend/src/hooks/useSimulationSnapshots.ts` | Ajout méthode | 8 |
| `packages/frontend/src/components/RealSnapshotsPanel.tsx` | Ajout bouton | 9 |
| `packages/frontend/src/components/SimulationSnapshotsPanel.tsx` | Ajout bouton | 10 |

Total : **10 fichiers modifiés**, **11 tâches** (10 implémentation + 1 validation).