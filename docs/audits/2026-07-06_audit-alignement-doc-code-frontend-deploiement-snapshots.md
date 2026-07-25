# Rapport d'Audit : Alignement Documentation ↔ Code Source

**Périmètre** : Frontend, Déploiement & Snapshots  
**Date** : 2026-07-06  
**Version cible** : Polywatch v1.1  
**Protocole** : 4 étapes (Setup → Doc→Code → Code→Doc → Synthèse)

---

## Résumé Exécutif

| Statut | Constats |
|--------|----------|
| ✅ Aligné | 12 vérifications |
| ⚠️ Divergence mineure | 3 constats |
| ❌ Divergence | 3 constats |

**3 divergences** et **3 divergences mineures** identifiées sur 18 points de vérification.

---

## 1. Pages Frontend — APP_PAGES

### 1.1 Nombre de pages

| Source | Pages déclarées | Constat |
|--------|----------------|---------|
| `frontend.md` (l.11) | **6** pages | ❌ **Divergence** |
| `06-frontend.md` (l.8) | **7** pages | ✅ |
| `ui-persistence.ts` (l.5-6) | **7** : `simulation, real, leaderboard, markets, wallet, crypto-algo, e2e-tests` | ✅ |
| `App.tsx` (l.27, 145-149, 211-215) | 7 pages, `E2eTestsPage` importé et rendu | ✅ |

**Constat** : `frontend.md` ligne 11 dit « 6 pages (APP_PAGES) » et ligne 14 liste 6 valeurs. Le code en a 7 depuis l'ajout de `e2e-tests`. `06-frontend.md` est à jour.

### 1.2 Page e2e-tests — documentée ?

| Doc | Présente ? | Détail |
|-----|-----------|--------|
| `frontend.md` (tableau l.18-25) | ❌ **Absente** | Le tableau liste 6 pages, e2e-tests n'apparaît nulle part |
| `06-frontend.md` (l.8, l.21-22) | ✅ | Décrite : « lancement et suivi des runs de tests E2E (via /api/e2e-runs) » |
| Code : `E2eTestsPage.tsx` | ✅ | Existe dans `components/`, 401 lignes |

**Constat** : La page e2e-tests est absente du tableau et de la description de `frontend.md`. Elle est correctement documentée dans `06-frontend.md`.

### 1.3 Page Trader Insight — documentée ?

| Doc | Présente ? | Détail |
|-----|-----------|--------|
| `frontend.md` (l.23) | ✅ | Tableau : « Trader Insight | TraderProfilePage : profil trader Polymarket... » |
| `06-frontend.md` (l.84) | ✅ | Liste complète des sous-composants |
| Code | ✅ | Tous les composants existent : `TraderProfilePage.tsx`, `TraderActivityTimelineChart.tsx`, `TraderCapitalEvolutionChart.tsx`, `TraderFundingSection.tsx`, `TraderFundingTimelineChart.tsx`, `TraderMarketBreakdownChart.tsx`, `TraderPnlEvolutionChart.tsx` |

**⚠️ Divergence mineure** : `frontend.md` présente Trader Insight comme une **page** dans le tableau de navigation, mais dans le code (`App.tsx`), il n'y a pas de route `page() === 'trader-insight'`. `TraderProfilePage` est en réalité un sous-composant du `Leaderboard` (importé et rendu dans `Leaderboard.tsx` l.9, l.101). Ce n'est pas une page autonome navigable.

---

## 2. Snapshots Simulation

### 2.1 Déclencheurs (manual / auto / reset)

| Déclencheur | Doc `snapshots-simulation.md` | Code | Statut |
|-------------|------------------------------|------|--------|
| `manual` | l.24 : label optionnel, skipIfEmpty=non | ✅ `CreateSimStateSnapshotOptions.source='manual'`, `skipIfEmpty` optionnel (défaut undefined/false) | ✅ |
| `auto` | l.25 : label "Automatique", skipIfEmpty=oui | ✅ `createAutoSnapshotIfDue` → `source:'auto', label:'Automatique', skipIfEmpty:true` (l.127-131) | ✅ |
| `reset` | l.26 : label "Avant réinitialisation", skipIfEmpty=oui | ✅ Type `SimStateSnapshotSource` inclut `'reset'` (sim-state-snapshot.ts l.5) | ✅ |

### 2.2 Boucle automatique

| Propriété | Doc | Code | Statut |
|-----------|-----|------|--------|
| Tick interval | l.105 : **30 s** | `auto-snapshot-loop.ts` l.17 : `TICK_MS = 30_000` | ✅ |
| Min interval utilisateur | l.106 : **60 s** | `auto-snapshot-timing.ts` l.4 : `MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS = 60` | ✅ |
| skipIfEmpty | l.109 : oui | `simulation-archive.service.ts` l.173-179 : vérifie positions.length===0 && executions.length===0 | ✅ |
| Garde DB lock | l.108 : garde en mémoire + base | `createAutoSnapshotIfDue` utilise `withAutoSnapshotCreationLock` (l.115) + re-vérification DB (l.116-125) | ✅ |
| Valeur par défaut | l.114 : désactivé, intervalle 3600 s | Vérifié dans `auto-snapshot-loop.ts` l.74 : `if (!risk.simAutoSnapshotEnabled) return` | ✅ |

### 2.3 Composants UI Snapshots

| Composant | Doc `snapshots-simulation.md` (l.120-135) | Code | Statut |
|-----------|------------------------------------------|------|--------|
| `SimulationSnapshotsPanel` | ✅ l.118 | ✅ `SimulationSnapshotsPanel.tsx` | ✅ |
| `SimHero` (bouton Snapshot) | ✅ l.122 | ✅ | ✅ |
| `SimSnapshotFilters` | ✅ l.123 | ✅ `SimSnapshotFilters.tsx` | ✅ |
| `SimSnapshotEquityChart` | ✅ l.125 | ✅ `SimSnapshotEquityChart.tsx` | ✅ |
| `SimSnapshotCard` | ✅ l.126 | ✅ `SimSnapshotCard.tsx` | ✅ |
| `SimSnapshotComparePanel` | ✅ l.128 | ✅ `SimSnapshotComparePanel.tsx` | ✅ |
| `SimSnapshotDetailDialog` | ✅ l.129 | ✅ `SimSnapshotDetailDialog.tsx` | ✅ |
| `SimSnapshotSettingsDialog` | ❌ **Absent** | ✅ `SimSnapshotSettingsDialog.tsx` existe | ⚠️ |
| `SimSnapshotDialog` | ❌ **Absent** | ✅ `SimSnapshotDialog.tsx` existe | ⚠️ |

**⚠️ Divergence mineure** : 2 composants `SimSnapshot*` existent dans le code mais ne sont pas documentés dans `snapshots-simulation.md`.

---

## 3. Déploiement

### 3.1 Services Docker

| Service | `docker-compose.yml` | `deployment.md` §2.1 | Statut |
|---------|---------------------|----------------------|--------|
| `postgres` | ✅ l.2 | ✅ l.60 | ✅ |
| `redis` | ✅ l.20 | ✅ l.61 | ✅ |
| `backend` | ✅ l.28 | ✅ l.59 | ✅ |
| `worker` | ✅ l.56 | ❌ **Absent** | ❌ |
| `crypto-algo` | ✅ l.75 | ✅ l.62 | ✅ |
| `frontend` | ✅ l.98 | ❌ **Absent** | ❌ |

**Constat** : `deployment.md` §2.1 omet les services `worker` et `frontend` de la liste des services Docker.

### 3.2 Port bindings

| Service | Port | `deployment.md` | `docker-compose.yml` | Statut |
|---------|------|-----------------|---------------------|--------|
| Backend | 3000 | ✅ l.59 (bind 0.0.0.0) | ✅ l.33 (`"3000:3000"`) | ✅ |
| PostgreSQL | 5432 | ✅ l.60 (bind 127.0.0.1) | ✅ l.10 (`"127.0.0.1:5432:5432"`) | ✅ |
| Redis | 6379 | ✅ l.61 (bind 127.0.0.1) | ✅ l.25 (`"127.0.0.1:6379:6379"`) | ✅ |
| Frontend | 5173 | ❌ **Absent** | ✅ l.103 (`"5173:80"`) | ❌ |

**Constat** : Le port 5173 (frontend) n'est pas documenté dans `deployment.md`. Il est mentionné dans `06-frontend.md` l.3 (port dev Vite).

### 3.3 Scripts package.json

| Script | `package.json` | `deployment.md` | Statut |
|--------|---------------|-----------------|--------|
| `generate-secrets` | ✅ l.19 | ✅ l.11 | ✅ |
| `dry-run:real` | ✅ l.20 | ✅ l.111 | ✅ |
| `migrate` | ✅ l.17 | ❌ **Absent** | ⚠️ |
| `dev` | ✅ l.9 | ✅ l.150 (partiel : `npm run dev -w @polywatch/worker`) | ⚠️ |

**⚠️ Divergence mineure** : `npm run migrate` n'est pas mentionné dans `deployment.md`. La commande `dev` n'est documentée que partiellement (worker uniquement).

### 3.4 Secrets

| Secret | `deployment.md` | `docker-compose.yml` | `generate-secrets.mjs` | Statut |
|--------|----------------|---------------------|----------------------|--------|
| `JWT_SECRET` | ✅ l.18 | ✅ l.37 | ✅ script existe | ✅ |
| `JWT_REFRESH_SECRET` | ✅ l.19 | ✅ l.38 | ✅ | ✅ |
| `SERVICE_TOKEN` | ✅ l.20 | ✅ l.39 | ✅ | ✅ |
| `MASTER_ENCRYPTION_KEY` | ✅ l.21 | ✅ l.40 | ✅ | ✅ |

---

## 4. Synthèse des Écarts

### ❌ Divergences (3)

| # | Fichier(s) | Ligne(s) | Problème | Correction |
|---|-----------|----------|----------|------------|
| D1 | `frontend.md` | 11, 14 | Dit « 6 pages (APP_PAGES) » et liste 6 valeurs. Le code en a 7 (`e2e-tests` manquant). | Remplacer « 6 pages » par « 7 pages » et ajouter `'e2e-tests'` dans la liste et le tableau. |
| D2 | `deployment.md` | §2.1 (l.58-63) | Omet les services Docker `worker` et `frontend` de la section Isolation Réseau. | Ajouter les 2 services manquants avec leurs ports. |
| D3 | `deployment.md` | §2.1 | Port 5173 (frontend) non documenté. | Ajouter `frontend : port 5173 (bind 127.0.0.1)` dans la liste. |

### ⚠️ Divergences mineures (3)

| # | Fichier(s) | Problème | Correction |
|---|-----------|----------|------------|
| M1 | `frontend.md` (l.23) | Trader Insight présenté comme une **page** autonome, mais c'est un sous-composant du Leaderboard (pas de route `page() === 'trader-insight'` dans App.tsx). | Clarifier que Trader Insight est un panneau/dialog du Leaderboard, pas une page séparée. |
| M2 | `snapshots-simulation.md` (l.120-135) | 2 composants UI (`SimSnapshotSettingsDialog`, `SimSnapshotDialog`) existent dans le code mais ne sont pas listés dans la doc. | Ajouter les 2 composants manquants au tableau. |
| M3 | `deployment.md` | `npm run migrate` non documenté. | Ajouter une mention de `npm run migrate` dans la section prérequis ou checklist. |

### ✅ Points alignés (12)

1. Snapshots : déclencheur `manual` — doc ↔ code
2. Snapshots : déclencheur `auto` — doc ↔ code
3. Snapshots : déclencheur `reset` — doc ↔ code
4. Snapshots : `skipIfEmpty` — doc ↔ code
5. Snapshots : tick 30s — doc ↔ code
6. Snapshots : min interval 60s — doc ↔ code
7. Snapshots : composants UI (7 sur 9) — doc ↔ code
8. Déploiement : secrets (4/4) — doc ↔ code ↔ script
9. Déploiement : ports 3000, 5432, 6379 — doc ↔ docker-compose
10. Déploiement : script `generate-secrets` — doc ↔ package.json
11. Déploiement : script `dry-run:real` — doc ↔ package.json
12. Frontend : `06-frontend.md` — 7 pages correctes, composants Trader Insight complets

---

## 5. Fichiers Sources Consultés

### Documentation
- `docs/frontend.md` (178 lignes)
- `docs/code/06-frontend.md` (101 lignes)
- `docs/deployment.md` (227 lignes)
- `docs/snapshots-simulation.md` (170 lignes)

### Code
- `packages/frontend/src/App.tsx` (219 lignes)
- `packages/frontend/src/lib/ui-persistence.ts` (105 lignes)
- `packages/frontend/src/components/E2eTestsPage.tsx` (401 lignes)
- `packages/frontend/src/components/TraderProfilePage.tsx` (526 lignes)
- `packages/frontend/src/components/SimulationSnapshotsPanel.tsx`
- `packages/frontend/src/components/SimSnapshotFilters.tsx`
- `packages/frontend/src/components/SimSnapshotEquityChart.tsx`
- `packages/frontend/src/components/SimSnapshotCard.tsx`
- `packages/frontend/src/components/SimSnapshotComparePanel.tsx`
- `packages/frontend/src/components/SimSnapshotDetailDialog.tsx`
- `packages/frontend/src/components/SimSnapshotSettingsDialog.tsx`
- `packages/frontend/src/components/SimSnapshotDialog.tsx`
- `packages/core/src/services/simulation-archive.service.ts` (342 lignes)
- `packages/core/src/types/sim-state-snapshot.ts` (75 lignes)
- `packages/core/src/simulation/auto-snapshot-timing.ts` (54 lignes)
- `packages/backend/src/simulation/auto-snapshot-loop.ts` (105 lignes)
- `packages/backend/src/index.ts` (195 lignes)
- `docker-compose.yml` (108 lignes)
- `package.json` (71 lignes)
- `scripts/generate-secrets.mjs`
