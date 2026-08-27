# Plan — Gestion multi-intervalles de l'historique CLOB weather + refonte colonne « En base »

**Date** : 2026-08-10
**Statut** : ✅ **implémenté** (vérifié 2026-08-27)
**Scope** : Section **Villes → Données télécharger** (`WeatherAlgoHistoryIngestSection`) + timeline CLOB (`WeatherClobTimelineView`)
**Référence** : `[2026-08-08_PLAN-weather-market-data-persistence.md](./2026-08-08_PLAN-weather-market-data-persistence.md)` (tables `weather_clob_price_history` / `weather_history_ingest_jobs`)

---

## 1. Contexte et problème

### 1.1 État actuel

La section **Villes → Données télécharger** affiche un tableau par ville avec les colonnes **Ville | Période | Intervalle | En base | Actions** :

- La colonne **« En base »** affiche un texte brut : `"X points · dates: 2026-08-08, 2026-08-09"` (`formatCoverage()`).
- L'**intervalle** (`fidelityMinutes`) est un `<select>` qui ne sert qu'à *charger* de nouvelles données (1 min, 5 min, 15 min, 1 h, 1 j).
- En base, chaque ligne de `weather_clob_price_history` porte bien son `fidelity_minutes`, mais le **coverage** (`WeatherHistoryCoverageDto`) ne le remonte **pas** : on ne sait donc pas quels intervalles existent déjà pour une ville.

### 1.2 Problèmes

1. **La colonne « En base » est un bloc de texte** : points + dates en vrac, pas de hiérarchie visuelle, pas d'info sur l'intervalle réellement stocké.
2. **L'intervalle en base n'est pas affiché** : on ne voit pas si la ville a des données en 15 min, 1 h, etc.
3. **Impossible de gérer plusieurs intervalles** : la clé d'upsert est `(condition_id, side, recorded_at)`. Recharger une même ville avec un intervalle différent **écrase** le prix existant au lieu de conserver les deux séries. On ne peut donc pas avoir 15 min ET 1 h pour la même ville/date.

### 1.3 Objectifs

1. **Stocker plusieurs intervalles** pour la même ville/date (l'intervalle devient partie de la clé d'upsert).
2. **Afficher les intervalles présents en base** dans la colonne « En base » (badges + volume par intervalle).
3. **Gérer les intervalles** : pré-sélection de l'intervalle dominant, suppression d'un intervalle précis.
4. **Filtrer la timeline CLOB par intervalle** (sinon les séries 15 min et 1 h seraient mélangées dans le même graphique).

---

## 2. Décisions utilisateur (2026-08-10)

| Question | Décision |
|----------|----------|
| Stocker plusieurs intervalles pour la même ville/date ? | **Oui** — modifier la clé d'upsert |
| Supprimer un intervalle précis en base ? | **Oui** — nouvel endpoint |
| Scope de la refonte « En base » ? | **Uniquement** la section Villes → Données télécharger |

---

## 3. Architecture cible

### 3.1 Clé d'upsert multi-intervalle

La contrainte d'unicité en base est actuellement `UNIQUE (condition_id, side, recorded_at)` (migration `AddWeatherClobPriceHistory1700000000103`). Pour stocker plusieurs intervalles, il faut l'étendre à `UNIQUE (condition_id, side, recorded_at, fidelity_minutes)`.

**⚠️ Point critique** : `orUpdate` de TypeORM ne modifie pas la contrainte en base. Sans migration, insérer un second intervalle lèverait une **violation d'unicité PostgreSQL (23505)**. Une migration est donc **obligatoire**.

### 3.2 Coverage enrichi

`WeatherHistoryCoverageDto` gagne un champ `intervals: { fidelityMinutes: number; pointCount: number }[]` calculé par `SELECT fidelity_minutes, COUNT(*) GROUP BY fidelity_minutes`.

### 3.3 Timeline filtrée par intervalle

`getClobPriceHistoryTimeline` accepte un paramètre `fidelityMinutes?` (filtre `h.fidelity_minutes = :fid`). Le front expose un `<select>` d'intervalle persisté.

---

## 4. Fichiers touchés

| Fichier | Changement |
|---------|------------|
| `packages/core/src/migrations/AddClobHistoryIntervalToUniqueKey1700000000104.ts` | **Nouveau** — contrainte d'unicité étendue |
| `packages/core/src/database/data-source.ts` | Enregistrer la migration |
| `packages/core/src/entities/WeatherClobPriceHistory.ts` | `@Index` étendu à `fidelityMinutes` |
| `packages/core/src/services/weather-history-ingest.service.ts` | Clé d'upsert + `intervals` coverage + `deleteCityInterval` |
| `packages/core/src/services/weather-algo-data.service.ts` | Filtre `fidelityMinutes` timeline |
| `packages/core/src/services/index.ts` | Export types (déjà partiellement) |
| `packages/backend/src/routes/weather-algo-history.ts` | Endpoint `DELETE /interval` |
| `packages/backend/src/routes/weather-algo-data.ts` | Query param `fidelityMinutes` |
| `packages/frontend/src/api.ts` | Types + fonctions |
| `packages/frontend/src/lib/ui-persistence.ts` | Clé `weatherAlgoClobTimelineFidelity` |
| `packages/frontend/src/components/WeatherAlgoHistoryIngestSection.tsx` | Refonte colonne « En base » |
| `packages/frontend/src/components/WeatherClobTimelineView.tsx` | Filtre intervalle |
| `packages/frontend/src/styles.css` | Styles badges/chips |
| `packages/core/src/services/weather-history-ingest.service.test.ts` | Tests multi-intervalle + delete |
| `packages/core/src/services/weather-algo-data.service.test.ts` | Test filtre timeline |

---

## 5. Détail des changements

### 5.1 Migration `AddClobHistoryIntervalToUniqueKey1700000000104`

```typescript
// packages/core/src/migrations/AddClobHistoryIntervalToUniqueKey1700000000104.ts
export class AddClobHistoryIntervalToUniqueKey1700000000104 implements MigrationInterface {
  name = 'AddClobHistoryIntervalToUniqueKey1700000000104';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history DROP CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_key`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history ADD CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_key UNIQUE (condition_id, side, recorded_at, fidelity_minutes)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history DROP CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_key`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history ADD CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_key UNIQUE (condition_id, side, recorded_at)`,
    );
  }
}
```

> **Note** : le nom exact de la contrainte générée par PostgreSQL pour `UNIQUE (condition_id, side, recorded_at)` est `weather_clob_price_history_condition_id_side_recorded_at_key` (convention `{table}_{cols}_key`). À confirmer à l'implémentation via `\d weather_clob_price_history` ; sinon utiliser `DROP CONSTRAINT` avec le nom réel.

### 5.2 Entité `WeatherClobPriceHistory.ts`

```typescript
@Index(['conditionId', 'side', 'recordedAt', 'fidelityMinutes'], { unique: true })
```

### 5.3 Service `weather-history-ingest.service.ts`

**Clé d'upsert** :

```typescript
.orUpdate(
  ['price', 'ingest_job_id'],
  ['condition_id', 'side', 'recorded_at', 'fidelity_minutes'],
)
```

> **Note** : `metric` reste hors de la clé — sans risque réel car un `condition_id` correspond à un marché à métrique fixe. À documenter en commentaire.

**Coverage enrichi** :

```typescript
export interface WeatherHistoryCoverageDto {
  city: string;
  pointCount: number;
  fromRecordedAt: string | null;
  toRecordedAt: string | null;
  targetDates: string[];
  intervals: { fidelityMinutes: number; pointCount: number }[]; // NOUVEAU
}
```

Dans `getCoverage()`, ajouter :

```typescript
const intervalRows = await this.historyRepo()
  .createQueryBuilder('h')
  .select('h.fidelity_minutes', 'fidelityMinutes')
  .addSelect('COUNT(h.id)', 'pointCount')
  .where('LOWER(h.city) = :city', { city: cityNormalized })
  .groupBy('h.fidelity_minutes')
  .orderBy('h.fidelity_minutes', 'ASC')
  .getRawMany<{ fidelityMinutes: number; pointCount: string | number }>();

const intervals = intervalRows.map((r) => ({
  fidelityMinutes: Number(r.fidelityMinutes),
  pointCount: Number(r.pointCount ?? 0),
}));
```

**`deleteCityInterval`** :

```typescript
async deleteCityInterval(city: string, fidelityMinutes: number): Promise<number> {
  const result = await this.historyRepo()
    .createQueryBuilder()
    .delete()
    .where('LOWER(city) = :city', { city: city.trim().toLowerCase() })
    .andWhere('fidelity_minutes = :fidelityMinutes', { fidelityMinutes })
    .execute();
  return result.affected ?? 0;
}
```

### 5.4 Service `weather-algo-data.service.ts` — filtre timeline

`getClobPriceHistoryTimeline` accepte `fidelityMinutes?: number` :

```typescript
if (options.fidelityMinutes != null) {
  qb.andWhere('h.fidelity_minutes = :fid', { fid: options.fidelityMinutes });
}
```

### 5.5 Routes backend

**`weather-algo-history.ts`** — `DELETE /interval` (forme défensive, évite toute collision future avec des routes paramétrées) :

```typescript
router.delete('/interval', requireJwt, async (req, res) => {
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
  const fidelityMinutes = Number(req.query.fidelityMinutes);
  if (!city || !Number.isFinite(fidelityMinutes) || fidelityMinutes <= 0) {
    res.status(400).json({ error: 'invalid_params' });
    return;
  }
  try {
    const deleted = await service.deleteCityInterval(city, fidelityMinutes);
    res.json({ city, fidelityMinutes, deleted });
  } catch (err) {
    res.status(500).json({
      error: 'delete_interval_failed',
      message: err instanceof Error ? err.message : 'unknown error',
    });
  }
});
```

**`weather-algo-data.ts`** — propager `fidelityMinutes` à `/clob-price-history/timeline` :

```typescript
const fidelityMinutes = Number(req.query.fidelityMinutes);
// ...
fidelityMinutes: Number.isFinite(fidelityMinutes) ? fidelityMinutes : undefined,
```

### 5.6 API frontend `api.ts`

- Étendre `WeatherHistoryCoverage` avec `intervals`.
- `deleteWeatherHistoryInterval(city, fidelityMinutes)`.
- `fetchClobPriceHistoryTimeline(targetDate, { city, maxTicks, fidelityMinutes })`.

### 5.7 UI persistence `ui-persistence.ts`

```typescript
weatherAlgoClobTimelineFidelity: 'polywatch_weather_algo_clob_timeline_fidelity',
```

### 5.8 UI `WeatherAlgoHistoryIngestSection.tsx` — refonte colonne « En base »

Remplacer `formatCoverage()` par une carte structurée :

- **En-tête** : total de points + plage `from → to`.
- **Badges d'intervalle** : un par intervalle présent, avec son nombre de points et un bouton « supprimer » (appelle `deleteWeatherHistoryInterval`).
- **Dates** : chips compactes (masquées derrière un tooltip si nombreuses).
- Le `<select>` d'intervalle de chargement pré-sélectionne l'intervalle dominant en base.
- Rechargement du coverage après chargement/suppression.

### 5.9 UI `WeatherClobTimelineView.tsx` — filtre intervalle

Ajouter un `<select>` d'intervalle persisté (`weatherAlgoClobTimelineFidelity`), alimenté par les intervalles du coverage de la ville sélectionnée, passé à `fetchClobPriceHistoryTimeline`.

### 5.10 CSS `styles.css`

Nouvelles classes (badges d'intervalle, chips de dates, layout grille de la colonne) réutilisant les tokens existants (`--accent`, `--border-subtle`, `--radius-sm`), responsive mobile conservé (`data-label`).

---

## 6. Ordre d'implémentation

1. **Migration** + enregistrement `data-source.ts`
2. **Entité** `@Index` étendu
3. **Service ingest** : clé d'upsert + coverage `intervals` + `deleteCityInterval`
4. **Service algo-data** : filtre `fidelityMinutes` timeline
5. **Routes backend** : `DELETE /interval` + query param timeline
6. **Rebuild core** (le backend importe `dist/`)
7. **API frontend** : types + fonctions
8. **UI persistence** : clé `weatherAlgoClobTimelineFidelity`
9. **UI** : refonte colonne « En base » + filtre timeline
10. **CSS** : badges/chips
11. **Tests** : multi-intervalle + delete + filtre timeline

---

## 7. Tests

| Composant | Test |
|-----------|------|
| `weather-history-ingest.service.test.ts` | Un second intervalle crée une ligne distincte (pas d'écrasement) |
| `weather-history-ingest.service.test.ts` | `deleteCityInterval` supprime uniquement les lignes de la ville avec cet intervalle |
| `weather-algo-data.service.test.ts` | Le filtre `fidelityMinutes` de la timeline ne retourne que les points de cet intervalle |

---

## 8. Risques résiduels

| Risque | Mitigation |
|--------|------------|
| Nom de la contrainte générée différent | Vérifier via `\d weather_clob_price_history` avant `DROP CONSTRAINT` |
| `metric` hors de la clé d'upsert | Sans risque réel (un `condition_id` = un marché à métrique fixe) ; documenté en commentaire |
| Timeline mélange les intervalles | Filtre `fidelityMinutes` ajouté |
| Backend importe `dist/` de core | Rebuild core requis après modification |
| Tests `pg-mem` (synchronize) | La contrainte est recréée depuis l'`@Index` mis à jour — cohérent |

---

## 9. Critère de complétude

- [x] Migration passe (up + down)
- [x] Charger la même ville/date en 15 min puis 1 h crée deux séries distinctes
- [x] La colonne « En base » affiche les badges d'intervalle avec volume
- [x] Supprimer un intervalle précis purge uniquement ces lignes
- [x] La timeline CLOB se filtre par intervalle
- [x] Tests verts
