# Plan de refactor : Retrait complet de SQLite

> **Objectif** : Éliminer toute trace de SQLite du codebase Polywatch. Le projet tourne désormais exclusivement sur PostgreSQL. Toute la couche d'abstraction dialect (`sqlite | postgres`) doit être supprimée, et le code simplifié pour ne cibler que Postgres.

> **Date** : 2026-07-03  
> **Statut** : Appliqué (2026-08-07) — retrait SQLite complet, Postgres-only + pg-mem

---

## Cartographie actuelle — tout ce qui touche SQLite

### Code source `@polywatch/core`

| Fichier | Lien SQLite | Action |
|---|---|---|
| `src/database/data-source.ts` | Branche `sqlite` dans `buildDataSourceOptions()`, `createDataSource()` (factory SQLite-only), PRAGMAs WAL/busy_timeout/synchronous, `assertDatabaseExists()` query `sqlite_master`, `patchDateTimeColumnsForPostgres()` | **Réécrire** — ne garder que Postgres |
| `src/database/dialect.ts` | `DatabaseDialect = 'sqlite' \| 'postgres'`, `inferDialect()` | **Supprimer** le type `'sqlite'` ou supprimer le fichier |
| `src/config/env.ts` | `getDatabasePath()` — résout `DATABASE_PATH` | **Supprimer** la fonction |
| `src/migration-backfill.ts` | Commentaires "SQLite-dialect baseline", déjà Postgres-only | **Nettoyer** commentaires |
| `src/migrate.ts` | Entry point — utilise `createMigratorDataSource()` | **Simplifier** (pas de changement dialect) |
| `src/migrations/Baseline1700000000000.ts` | Syntaxe SQLite uniquement (`AUTOINCREMENT`, `datetime('now')`, `boolean DEFAULT 0`) | **Réécrire** en syntaxe Postgres |
| `src/migrations/AddRealCashOverride1700000000007.ts` | Branche `isSqlite` | **Simplifier** — ne garder que Postgres |
| `src/migrations/CreateAlgoMarketSelections1700000000004.ts` | Branche `if (isPostgres) { … } else { … }` | **Simplifier** — ne garder que Postgres |
| `src/migrations/CreateAlgoAutoTrackRules1700000000008.ts` | Branche `if (isPostgres) { … } else { … }` | **Simplifier** — ne garder que Postgres |
| `src/services/execution.service.ts` | `supportsPessimisticLock()` — check `better-sqlite3` | **Simplifier** — toujours `true` |
| `src/entities/*.ts` | 19 entités avec `@Column({ type: 'datetime' })` (SQLite-compatible, patché en `timestamp` pour Postgres) | **Changer** `datetime` → `timestamp` directement |

### Bootstrap des services (3 fichiers identiques)

| Fichier | Pattern actuel | Action |
|---|---|---|
| `packages/backend/src/index.ts` L55-58 | `process.env.DATABASE_URL ? createDialectAwareDataSource() : createDataSource(config.databasePath)` | **Simplifier** → `createPostgresDataSource()` direct |
| `packages/worker/src/index.ts` L56-59 | Idem | Idem |
| `packages/crypto-algo/src/index.ts` L42-45 | Idem | Idem |

### Config des packages

| Fichier | Lien SQLite | Action |
|---|---|---|
| `packages/backend/src/config.ts` | `import { getDatabasePath }`, `databasePath: getDatabasePath()` | **Retirer** l'import et le champ |
| `packages/worker/src/config.ts` | Idem | Idem |
| `packages/crypto-algo/src/config.ts` | Idem | Idem |

### Tests (Vitest) — `createDataSource(':memory:')`

| Fichier | Usage |
|---|---|
| `packages/core/src/services/simulation-archive.service.test.ts` | `createDataSource(':memory:')` |
| `packages/core/src/services/algo-surveillance.service.test.ts` | Idem |
| `packages/core/src/services/algo-market-selection.service.test.ts` | Idem |
| `packages/core/src/services/reservation.service.test.ts` | Idem |
| `packages/core/src/services/market-position-tick.service.test.ts` | Idem |
| `packages/core/src/services/poll-cycle.service.test.ts` | Idem |
| `packages/core/src/services/execution.service.test.ts` | Idem |
| `packages/core/src/services/move-event-backfill.test.ts` | Idem |
| `packages/core/src/risk/risk-config-api.test.ts` | Idem (à vérifier) |
| `packages/core/src/simulation/reset-amount.test.ts` | Idem (à vérifier) |
| `packages/worker/src/processors/market-tracking/market-tick-recorder.test.ts` | Idem |
| `packages/worker/src/processors/copy/copy-entry-pipeline.test.ts` | Idem (à vérifier) |
| `packages/worker/src/processors/copy/copy-risk-gate.test.ts` | Idem (à vérifier) |

> **10+ fichiers de test** utilisent `createDataSource(':memory:')` pour instancier une SQLite en mémoire. Il faut une stratégie de remplacement (voir Phase 5).

### Outils & scripts (better-sqlite3 direct)

| Fichier | Usage | Action |
|---|---|---|
| `tools/audit-db.ts` | `createDataSource()` (TypeORM) | Réécrire avec `createPostgresDataSource()` |
| `tools/audit-failed.ts` | `import Database from 'better-sqlite3'` | Réécrire en `pg` direct ou TypeORM |
| `tools/audit-summary.ts` | Idem | Idem |
| `tools/analyze-db.ts` | Idem | Idem |
| `tools/analyze-config.ts` | Idem | Idem |
| `tools/analyze-performance.ts` | Idem | Idem |
| `tools/audit-db-direct.ts` | Idem | Idem |
| `tools/audit-sim-db/audit-sim-db.ts` | Idem + lecture `DATABASE_PATH` | Idem |
| `tools/optimization-report.ts` | Idem | Idem |
| `tools/optimize-config.sql` | SQL SQLite (`sqlite3 data/polywatch.db < …`) | Réécrire en SQL Postgres ou supprimer |
| `scripts/backup-db.sh` | `cp` du fichier `.db` | **Remplacer** par `pg_dump` |
| `scripts/drop-shadow-activity-tables.mjs` | `import Database from 'better-sqlite3'` | Réécrire en `pg` |
| `scripts/archive/migrate-to-postgres.ts` | Migration SQLite → Postgres | **Supprimer** (obsolète) |
| `scripts/archive/audit-pnl.ts` | À vérifier | Réécrire ou supprimer |
| `scripts/archive/drop-legacy-pnl-columns.ts` | À vérifier | Réécrire ou supprimer |

### Docker & infra

| Fichier | Lien SQLite | Action |
|---|---|---|
| `docker-compose.yml` | `DATABASE_PATH: /data/polywatch.db` (backend, worker, crypto-algo), `DATABASE_URL` commenté, volume `polywatch-data` | **Activer** `DATABASE_URL`, **retirer** `DATABASE_PATH`, `depends_on: postgres` |
| `.env.example` | `DATABASE_PATH` commenté, `DATABASE_URL` actif | **Retirer** la ligne `DATABASE_PATH` |
| `packages/data/polywatch.db` (+ `.db-shm`, `.db-wal`) | Fichiers SQLite | **Supprimer** |

### Dépendances npm

| Package | Fichier | Action |
|---|---|---|
| `better-sqlite3` | `packages/core/package.json` (dependency) | **Retirer** |
| `@types/better-sqlite3` | `packages/core/package.json` (devDependency) | **Retirer** |

### Documentation

| Document | Références SQLite | Action |
|---|---|---|
| `docs/README.md` | "Base de données | SQLite via better-sqlite3", diagramme | Mettre à jour |
| `docs/architecture.md` | Diagramme "SQLite (TypeORM)", description better-sqlite3 WAL | Mettre à jour |
| `docs/deployment.md` | "Option A : SQLite (défaut)", commande `sqlite3` | Mettre à jour |
| `docs/configuration.md` | `DATABASE_PATH`, "SQLite en mode WAL" | Mettre à jour |
| `docs/modele-donnees.md` | "La persistance repose sur SQLite" | Mettre à jour |
| `docs/pipeline-copy-trading.md` | "cache SQLite" | Mettre à jour |
| `docs/crypto-algo.md` | "SQLite/PostgreSQL" | Mettre à jour |
| `docs/code/01-architecture.md` | "base SQLite", `better-sqlite3 WAL` | Mettre à jour |
| `docs/code/03-core.md` | "TypeORM better-sqlite3 (WAL)", "Entités (SQLite)" | Mettre à jour |
| `docs/code/04-worker.md` | "Initialisation SQLite" | Mettre à jour |
| `docs/code/05-backend.md` | "TypeORM SQLite", "Sauvegarde SQLite" | Mettre à jour |
| `docs/code/07-crypto-algo.md` | "SQLite par défaut, ou Postgres" | Mettre à jour |
| `README.md` | "base SQLite" dans la structure | Mettre à jour |

---

## Plan d'exécution par phases

### Phase 0 — Préparation (15 min)

- [ ] Créer une branche `refactor/remove-sqlite`
- [ ] Vérifier que `DATABASE_URL` est bien configuré dans `.env` (déjà le cas — `.env.example` L9)
- [ ] Vérifier que PostgreSQL tourne (`docker compose up postgres -d`)
- [ ] Lancer `npm run migrate` pour valider que le schéma Postgres est à jour
- [ ] Lancer `npm test` pour avoir un baseline de l'état des tests (ils vont casser, c'est attendu)
- [ ] Commiter l'état actuel comme point de référence

### Phase 1 — Core : `data-source.ts` + `dialect.ts` + `env.ts` (le cœur du refactor)

**Objectif** : Éliminer la notion de dialect. Tout est Postgres.

#### 1.1 — `packages/core/src/database/dialect.ts`
- **Supprimer** le fichier entièrement, ou le simplifier à :
  ```ts
  export type DatabaseDialect = 'postgres';
  export function inferDialect(): DatabaseDialect { return 'postgres'; }
  ```
  → Préférer **supprimer** le fichier et retirer l'import partout.

#### 1.2 — `packages/core/src/database/data-source.ts`

Remplacer tout le fichier par une version Postgres-only :

- **Supprimer** : `createDataSource()` (factory SQLite), `patchDateTimeColumnsForPostgres()`, branche `sqlite` dans `buildDataSourceOptions()`, PRAGMAs SQLite, query `sqlite_master`
- **Renommer** `createDialectAwareDataSource()` → `createDataSource()` (devient le seul factory)
- **Supprimer** `createPostgresDataSource()` (redondant avec le nouveau `createDataSource()`)
- **Simplifier** `buildDataSourceOptions()` : ne garder que la branche `postgres`
- **Simplifier** `assertDatabaseExists()` : ne garder que `information_schema.tables`
- **Supprimer** l'import de `getDatabasePath` et `inferDialect`/`DatabaseDialect`
- **Supprimer** `mkdirSync`/`dirname` (plus besoin de créer un dossier pour un fichier `.db`)

Signature cible :
```ts
export function buildDataSourceOptions(opts?: { synchronize?: boolean; migrationsRun?: boolean }): DataSourceOptions
export function createDataSource(opts?: { synchronize?: boolean; migrationsRun?: boolean }): DataSource
export function createMigratorDataSource(): DataSource
export async function initializeDataSource(ds: DataSource): Promise<DataSource>
export async function assertDatabaseExists(ds: DataSource): Promise<void>
```

#### 1.3 — `packages/core/src/config/env.ts`
- **Supprimer** `getDatabasePath()`
- **Supprimer** `resolveMonorepoPath()` si plus rien ne l'utilise (vérifier)
- **Garder** `getDatabaseUrl()`, `loadMonorepoEnv()`

#### 1.4 — Entités : `datetime` → `timestamp`
- Rechercher tous les `@Column({ type: 'datetime' … })` dans `packages/core/src/entities/`
- Remplacer `type: 'datetime'` par `type: 'timestamp'`
- **Supprimer** `patchDateTimeColumnsForPostgres()` qui n'a plus de raison d'être
- Vérifier que TypeORM Postgres valide bien les entités sans le patch

> ⚠️ **Risque** : Si la base Postgres existante a déjà été créée avec le patch (colonnes en `timestamp`), il n'y a pas de changement. Mais si certaines colonnes ont été créées via `synchronize: true` sans le patch, elles pourraient être en `datetime` (qui n'existe pas en Postgres → TypeORM a dû le mapper). Vérifier le schéma actuel avec `\d table_name`.

### Phase 2 — Migrations : réécrire en Postgres-only

#### 2.1 — `Baseline1700000000000.ts`
C'est la migration la plus importante (15 tables). Réécrire toute la syntaxe :
- `INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL` → `SERIAL PRIMARY KEY`
- `datetime NOT NULL DEFAULT (datetime('now'))` → `timestamp NOT NULL DEFAULT now()`
- `boolean NOT NULL DEFAULT 0` → `boolean NOT NULL DEFAULT false`
- `boolean NOT NULL DEFAULT 1` → `boolean NOT NULL DEFAULT true`
- `real` → `double precision` (ou garder `real` qui est valide en Postgres)
- `text` → `text` (inchangé)

> ⚠️ **Risque critique** : Si la base Postgres existante a déjà ces migrations enregistrées (via backfill ou exécution), la réécriture ne les ré-exécutera pas — c'est safe. Mais si on part d'une base neuve, la nouvelle syntaxe doit créer exactement le même schéma. **Vérifier avec `npm run migrate` sur une base vierge.**

#### 2.2 — `AddRealCashOverride1700000000007.ts`
Retirer la branche `isSqlite` :
```ts
async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`ALTER TABLE risk_config ADD COLUMN real_cash_override REAL DEFAULT NULL`);
}
async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`ALTER TABLE risk_config DROP COLUMN real_cash_override`);
}
```

#### 2.3 — `CreateAlgoMarketSelections1700000000004.ts`
Retirer la branche `else`, ne garder que la syntaxe Postgres.

#### 2.4 — `CreateAlgoAutoTrackRules1700000000008.ts`
Idem.

#### 2.5 — Vérifier les autres migrations
Passer en revue les 18 migrations restantes pour identifier toute autre branche SQLite.

### Phase 3 — Services : retirer les checks SQLite

#### 3.1 — `execution.service.ts`
```ts
// Avant
function supportsPessimisticLock(ds: DataSource): boolean {
  const type = ds.options.type;
  return type !== 'better-sqlite3' && type !== 'sqlite' && type !== 'sqljs';
}

// Après — supprimer la fonction, toujours true ou retirer la garde
```
Remplacer tous les appels `supportsPessimisticLock(ds)` par `true` ou retirer la condition.

#### 3.2 — `migration-backfill.ts`
- Nettoyer les commentaires faisant référence à SQLite
- Le code utilise déjà `information_schema` (Postgres-only) — pas de changement fonctionnel

### Phase 4 — Bootstrap des services

#### 4.1 — `packages/backend/src/index.ts` (L55-58)
```ts
// Avant
const ds = await initializeDataSource(
  process.env.DATABASE_URL
    ? createDialectAwareDataSource()
    : createDataSource(config.databasePath),
);

// Après
const ds = await initializeDataSource(createDataSource());
```

#### 4.2 — `packages/worker/src/index.ts` (L56-59)
Idem.

#### 4.3 — `packages/crypto-algo/src/index.ts` (L42-45)
Idem.

#### 4.4 — Config des packages
- `packages/backend/src/config.ts` : retirer `import { getDatabasePath }` et `databasePath: getDatabasePath()`
- `packages/worker/src/config.ts` : idem
- `packages/crypto-algo/src/config.ts` : idem
- Si `getDatabaseUrl()` est importé mais inutilisé dans ces configs, le retirer aussi

### Phase 5 — Tests : remplacer SQLite `:memory:` par Postgres

> ⚠️ **C'est la phase la plus délicate.** Les tests utilisent `createDataSource(':memory:')` pour des tests rapides sans infrastructure. Il faut une stratégie de remplacement.

**Option A — `pg-mem` (recommandée)** :
- Installer `pg-mem` (`npm i -D pg-mem`)
- `pg-mem` émule Postgres en mémoire (même SQL, mêmes types)
- Créer un helper `createTestDataSource()` qui instancie `pg-mem` + TypeORM
- Avantage : pas de Docker requis pour les tests, rapide
- Risque : `pg-mem` ne supporte pas 100% du SQL Postgres (transactions avancées, certains types)

**Option B — Postgres test container** :
- Utiliser `testcontainers` npm package
- Démarre un vrai Postgres Docker pour chaque suite de tests
- Avantage : 100% fidèle à la production
- Inconvénient : Docker requis, plus lent

**Option C — Postgres de dev partagé avec schema de test** :
- Utiliser le Postgres local avec une DB de test dédiée
- Avantage : simple
- Inconvénient : doit nettoyer entre les tests, moins isolé

**Recommandation** : Option A (`pg-mem`) pour les tests unitaires. Si `pg-mem` ne suffit pas pour certains tests (transactions pessimistes, `SELECT … FOR UPDATE`), utiliser l'Option B pour ceux-là.

#### Étapes :
1. Installer `pg-mem` en devDependency
2. Créer `packages/core/src/database/test-data-source.ts` :
   ```ts
   export function createTestDataSource(): DataSource {
     const db = new DBMemory();
     const ds = new DataSource({
       type: 'postgres',
       ...db.getDataSourceOptions(),
       entities,
       synchronize: true,
       migrationsRun: false,
     });
     return ds;
   }
   ```
3. Remplacer `createDataSource(':memory:', { synchronize: true })` par `createTestDataSource()` dans les ~13 fichiers de test
4. Lancer `npm test` et corriger les échecs un par un

### Phase 6 — Outils & scripts

#### 6.1 — Outils `tools/*.ts` utilisant `better-sqlite3` direct
Pour chaque fichier (`audit-failed.ts`, `audit-summary.ts`, `analyze-db.ts`, `analyze-config.ts`, `analyze-performance.ts`, `audit-db-direct.ts`, `optimization-report.ts`) :
- Remplacer `import Database from 'better-sqlite3'` par `import { Pool } from 'pg'`
- Adapter les queries (syntaxe similaire mais API différente)
- Ou, plus simple : utiliser `createDataSource()` TypeORM et `ds.query()`

#### 6.2 — `tools/audit-db.ts`
- Remplace déjà `createDataSource()` → juste corriger l'import après refactor Phase 1

#### 6.3 — `tools/audit-sim-db/audit-sim-db.ts`
- Réécrire avec `pg` ou TypeORM, retirer la lecture `DATABASE_PATH` depuis `.env`

#### 6.4 — `tools/optimize-config.sql`
- Réécrire en SQL Postgres (très peu de changements — `sqlite3` → `psql`)
- Ou supprimer si obsolète

#### 6.5 — `scripts/backup-db.sh`
Remplacer par `pg_dump` :
```sh
#!/bin/sh
# Backup PostgreSQL database — retention 7 days
set -e
DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS=7
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/polywatch-$TIMESTAMP.sql.gz"
pg_dump "$DB_URL" | gzip > "$BACKUP_FILE"
echo "Backup created: $BACKUP_FILE"
find "$BACKUP_DIR" -name 'polywatch-*.sql.gz' -mtime +$RETENTION_DAYS -delete
echo "Old backups cleaned (retention: ${RETENTION_DAYS}d)"
```

#### 6.6 — `scripts/drop-shadow-activity-tables.mjs`
Réécrire avec `pg` :
- Remplacer `import Database from 'better-sqlite3'` par `import pg from 'pg'`
- Adapter `sqliteTableExists()` → query `information_schema.tables`

#### 6.7 — Scripts d'archive
- `scripts/archive/migrate-to-postgres.ts` → **Supprimer** (la migration SQLite→Postgres n'a plus de sens)
- `scripts/archive/drop-legacy-pnl-columns.ts` → Vérifier si encore utile, sinon supprimer
- `scripts/archive/audit-pnl.ts` → Vérifier, sinon supprimer
- `scripts/sql/drop-legacy-pnl-columns.sql` → Vérifier

### Phase 7 — Dépendances npm

#### 7.1 — `packages/core/package.json`
```diff
- "better-sqlite3": "^11.9.1",
- "@types/better-sqlite3": "^7.6.13",
```

#### 7.2 — `package.json` racine
- Vérifier s'il y a des overrides liés à `better-sqlite3` (aucun trouvé à ce jour)
- Vérifier `package-lock.json` après suppression

#### 7.3 — Installer `pg-mem` (Phase 5)
```diff
+ "pg-mem": "^1.x",
```

### Phase 8 — Docker & infra

#### 8.1 — `docker-compose.yml`
Pour les 3 services (backend, worker, crypto-algo) :
```diff
- # PostgreSQL (uncomment to switch from SQLite)
- # DATABASE_URL: postgresql://polywatch:***@postgres:5432/polywatch
- # SQLite (default)
- DATABASE_PATH: /data/polywatch.db
+ DATABASE_URL: postgresql://polywatch:${POSTGRES_PASSWORD:-polywatch}@postgres:5432/polywatch
```
Ajouter `depends_on: postgres` (avec healthcheck) pour les 3 services.
Retirer le volume `polywatch-data` (plus besoin de stockage fichier SQLite).

#### 8.2 — `.env.example`
```diff
- # SQLite (default — comment out DATABASE_PATH when using PostgreSQL)
- # DATABASE_PATH=./data/polywatch.db
- 
- # PostgreSQL (recommended for production / multi-instance)
- # Uncomment and set DATABASE_URL to switch from SQLite to PostgreSQL.
- # Requires a running PostgreSQL instance (e.g. `docker compose up postgres -d`).
- # DATABASE_URL=postgresql://polywatch:***@localhost:5432/polywatch
+ # PostgreSQL
+ DATABASE_URL=postgresql://polywatch:***@localhost:5432/polywatch
```

#### 8.3 — Supprimer les fichiers SQLite
```sh
rm packages/data/polywatch.db packages/data/polywatch.db-shm packages/data/polywatch.db-wal
```
Et retirer le dossier `packages/data/` s'il devient vide.

#### 8.4 — Vérifier les Dockerfiles
Les Dockerfiles ne référencent pas SQLite directement (pas de `DATABASE_PATH` hardcoded), mais vérifier qu'après suppression de `better-sqlite3`, le build Docker ne casse pas (compilation native de better-sqlite3 pouvait poser des soucis Alpine → bonus de la suppression).

### Phase 9 — Documentation

Mettre à jour tous les documents listés dans la cartographie :
- `README.md` : retirer "base SQLite", mentionner PostgreSQL
- `docs/README.md` : "Base de données | PostgreSQL via TypeORM"
- `docs/architecture.md` : diagramme et description
- `docs/deployment.md` : remplacer "Option A : SQLite" par instructions `pg_dump`
- `docs/configuration.md` : retirer `DATABASE_PATH`, documenter `DATABASE_URL` comme obligatoire
- `docs/modele-donnees.md` : "PostgreSQL via TypeORM"
- `docs/pipeline-copy-trading.md` : "cache PostgreSQL"
- `docs/crypto-algo.md` : retirer mention SQLite
- `docs/code/01-architecture.md` : "PostgreSQL (TypeORM)"
- `docs/code/03-core.md` : "TypeORM PostgreSQL"
- `docs/code/04-worker.md` : "Initialisation PostgreSQL"
- `docs/code/05-backend.md` : "TypeORM PostgreSQL", "Sauvegarde PostgreSQL"
- `docs/code/07-crypto-algo.md` : "PostgreSQL"

---

## Ordre d'exécution recommandé

```
Phase 0 (préparation)
  └→ Phase 1 (core data-source + dialect + env + entités)
       └→ Phase 2 (migrations Postgres-only)
            └→ Phase 3 (services)
                 └→ Phase 4 (bootstrap)
                      ├→ Phase 5 (tests) ← peut être en parallèle
                      └→ Phase 6 (outils/scripts)
                           └→ Phase 7 (dépendances)
                                └→ Phase 8 (Docker/infra)
                                     └→ Phase 9 (docs)
```

Phases 5 et 6 peuvent être faites en parallèle. Les phases 1-4 sont séquentielles (chacune dépend de la précédente).

## Points de risque critiques

| # | Risque | Mitigation |
|---|---|---|
| R1 | **Baseline migration réécrite** crée un schéma différent de l'existant | Comparer `\d table_name` avant/après sur une base vierge |
| R2 | **Entités `datetime → timestamp`** : la base existante pourrait avoir des colonnes en `datetime` (qui n'existe pas en Postgres) | Vérifier le schéma réel : `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'copied_positions'` |
| R3 | **Tests `pg-mem`** : certaines requêtes SQL Postgres ne sont pas supportées par `pg-mem` | Fallback sur testcontainers pour les tests complexes |
| R4 | **`supportsPessimisticLock`** : retirer la garde pourrait exposer des bugs si le code ne gère pas bien les locks Postgres | Le code Postgres supporte déjà `pessimistic_write` — c'est le chemin qui était déjà emprunté |
| R5 | **Scripts d'archive** : `migrate-to-postgres.ts` pourrait encore être référencé quelque part | Recherche grep avant suppression |
| R6 | **Docker compose** : `depends_on` postgres avec healthcheck nécessaire | Ajouter `condition: service_healthy` |

## Vérification finale

Après toutes les phases :

```sh
# 1. Aucune référence à SQLite dans le code source
grep -ri "sqlite\|better-sqlite3\|DATABASE_PATH\|dialect\|inferDialect" packages/*/src/ --include="*.ts"

# 2. Aucune référence à SQLite dans les configs
grep -ri "sqlite\|better-sqlite3\|DATABASE_PATH" docker-compose.yml .env.example package.json packages/*/package.json

# 3. Le projet build
npm run build

# 4. Le projet démarre
docker compose up postgres -d
npm run migrate
npm run dev

# 5. Les tests passent
npm test

# 6. Les E2E passent
npm run test:e2e

# 7. Build Docker
docker compose up --build
```

## Estimation

| Phase | Complexité | Temps estimé |
|---|---|---|
| 0 — Préparation | Triviale | 15 min |
| 1 — Core data-source | **Haute** (cœur du refactor) | 1-2 h |
| 2 — Migrations | Moyenne (Baseline est longue) | 1 h |
| 3 — Services | Triviale | 15 min |
| 4 — Bootstrap | Triviale | 30 min |
| 5 — Tests | **Haute** (stratégie pg-mem) | 2-3 h |
| 6 — Outils/scripts | Moyenne | 1-2 h |
| 7 — Dépendances | Triviale | 15 min |
| 8 — Docker/infra | Moyenne | 30 min |
| 9 — Docs | Moyenne | 1 h |
| **Total** | | **~8-10 h** |