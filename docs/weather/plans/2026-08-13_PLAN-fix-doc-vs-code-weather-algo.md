# Plan — Fix partie 5 « Doc vs code » (F1–F8)

- **Date** : 2026-08-13
- **Statut** : ✅ implémenté (2026-08-13)
- **Scope** : documentation uniquement (`docs/api.md`, `docs/backtest.md`, `docs/weather-algo.md`, `docs/code/08-weather-algo.md`, `docs/plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md`) — **aucun code modifié**
- **Référence** : [`../audits/2026-08-11_audit-weather-algo-complet.md`](../audits/2026-08-11_audit-weather-algo-complet.md) (§5 « Doc vs code », F1–F8)

**Objectif** : aligner la documentation sur le code réel pour les 8 constats de la partie 5 de l'audit weather-algo. Les constats F1–F8 ont été **re-vérifiés par lecture directe du code au 2026-08-13** (cf. §8bis de l'audit). F5 est réfuté (aucune action). Ce plan ne touche **que** les fichiers de doc.

> ⚠️ **Périmètre volontairement restreint** : ce plan ne traite **que** la partie 5 (Doc vs code). Les autres parties (C, T, R, D) sont déjà implémentées ou hors scope.

---

## 1. Contexte et re-vérification

Les 8 constats de la partie 5, re-vérifiés au 2026-08-13 :

| # | Constat | Verdict | Action |
|---|---------|---------|--------|
| **F1** | 2 routes data manquantes : `DELETE /tables/:id` (`weather-algo-data.ts:170`) et `GET /weather-algo-history/jobs` (`weather-algo-history.ts:68`) | ✅ Confirmé | Documenter dans `api.md` |
| **F2** | Param `fidelityMinutes` backtest omis dans la liste des paramètres de run (`api.md:438`) | ✅ Confirmé | Ajouter dans `api.md` |
| **F3** | Wording « 6 tables » stale (le code renvoie 7) | ⚠️ Nuancé | Corriger `plans/applied/2026-08-08_IMPL-...` (api.md déjà corrigé) |
| **F4** | Code warning `kill_switch_partial_close` manquant dans le tableau des warnings | ✅ Confirmé | Ajouter dans `backtest.md` |
| **F5** | Cross-refs manquantes | ⚪ Réfuté | **Aucune action** |
| **F6** | 3 routes data non documentées : `GET /clob-price-history`, `GET /bucket-ticks/dates`, `GET /clob-price-history/dates` | ✅ Confirmé | Documenter dans `api.md` |
| **F7** | `docs/weather-algo.md:42` documente `WeatherAutoTrackJanitor` (supprimé en D11) | ✅ Confirmé | Retirer la ligne |
| **F8** | `docs/code/08-weather-algo.md:58,67,81` référence le cycle auto-track (supprimé en D11) | ✅ Confirmé | Corriger les 3 lignes |

**Résultat** : **7 corrections de doc** (F1, F2, F3, F4, F6, F7, F8), **1 réfuté** (F5).

---

## 2. Décisions de design

| Q | Choix | Détail |
|---|-------|--------|
| **F1-placement** | Ajouter `DELETE /tables/:id` dans le tableau § Weather Algo data (`api.md:388-401`) et `GET /jobs` dans le tableau § Weather Algo history (`api.md:408-414`) | Respecter l'ordre des routes existantes dans chaque tableau. `DELETE /tables/:id` se place après `DELETE /tables` (ligne 391) ; `GET /jobs` se place avant `GET /jobs/:id` (ligne 412). |
| **F2-placement** | Ajouter `fidelityMinutes` dans la liste des paramètres de run (`api.md:438`), entre `maxConcurrentPositions` et `detectionDelayMs` | Aligner sur l'ordre du schéma Zod (`backtest/src/params.ts:17`). Mentionner le warning `replay_fidelity_filter_unsupported` en mode `replay` (cohérent avec `backtest.md:110-117`). |
| **F3-scope** | Corriger **uniquement** `plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md:57-58,90` | `api.md:390-391` est déjà corrigé (« 7 tables »). Le fichier `IMPL` est un plan appliqué (journal) — le wording « 6 tables » y est factuellement faux et doit être mis à jour. |
| **F4-placement** | Ajouter `kill_switch_partial_close` dans le tableau des warnings (`backtest.md:76-93`), après `kill_switch_force_close` (ligne 85) | Le code l'émet via `setOrUpdateWarning` (`weather-adapter.ts:259`) quand un close échoue / reste des positions ouvertes après `force_close_all`. |
| **F6-placement** | Ajouter les 3 routes dans le tableau § Weather Algo data (`api.md:388-401`) | `GET /clob-price-history` après `GET /position-forecasts` (ligne 397) ; `GET /bucket-ticks/dates` après `GET /bucket-ticks` (ligne 394) ; `GET /clob-price-history/dates` après `GET /clob-price-history` (nouvelle ligne). |
| **F7-suppression** | Retirer la ligne `WeatherAutoTrackJanitor` du tableau des processus (`weather-algo.md:42`) | Le janitor weather n'existe plus (D11). Ne pas le remplacer par un autre composant — le tableau liste les composants actifs. |
| **F8-correction** | Corriger les 3 lignes de `code/08-weather-algo.md` (58, 67, 81) | Ligne 58 : retirer « Timer auto-track » de la séquence de démarrage. Ligne 67 : retirer « Auto-track tick » de la liste des resilience patterns. Ligne 81 : retirer « + auto-track » du `clearInterval` de shutdown (seuls heartbeat + data-purge subsistent). |

---

## 3. Fichiers touchés

| Fichier | Changement | Constat |
|---------|------------|---------|
| `docs/api.md` | Ajouter `DELETE /tables/:id` (tableau data) + `GET /jobs` (tableau history) | F1 |
| `docs/api.md` | Ajouter `fidelityMinutes` dans la liste des paramètres de run | F2 |
| `docs/api.md` | Ajouter `GET /clob-price-history`, `GET /bucket-ticks/dates`, `GET /clob-price-history/dates` (tableau data) | F6 |
| `docs/backtest.md` | Ajouter `kill_switch_partial_close` dans le tableau des warnings | F4 |
| `docs/weather-algo.md` | Retirer la ligne `WeatherAutoTrackJanitor` du tableau des processus | F7 |
| `docs/code/08-weather-algo.md` | Corriger les lignes 58, 67, 81 (retrait du cycle auto-track) | F8 |
| `docs/plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md` | Corriger le wording « 6 tables » → « 7 tables » (lignes 57-58, 90) | F3 |

---

## 4. Détail des modifications

### 4.1 F1 — Routes manquantes dans `api.md`

**Tableau § Weather Algo data** (après la ligne 391 `DELETE /tables`) :

```markdown
| DELETE | `/api/weather-algo-data/tables/:id` | Vide une table précise (`id` ∈ `WEATHER_ALGO_DATA_TABLE_IDS`) → `{ deleted }` ; **400** `Unknown table id` |
```

**Tableau § Weather Algo history** (avant la ligne 412 `GET /jobs/:id`) :

```markdown
| GET | `/api/weather-algo-history/jobs` | Liste des jobs d'ingestion (`limit`≤100, défaut 20) → `{ jobs }` |
```

### 4.2 F2 — Param `fidelityMinutes` dans `api.md:438`

Insérer dans la liste des paramètres de run, entre `maxConcurrentPositions` et `detectionDelayMs` :

```markdown
`fidelityMinutes` (optionnel — filtre les `book_tick` en mode `reevaluate` ; **ignoré** en `replay` → warning `replay_fidelity_filter_unsupported`),
```

### 4.3 F3 — Wording « 6 tables » dans `plans/applied/2026-08-08_IMPL-...`

- Ligne 57 : `Résumé 6 tables` → `Résumé 7 tables`
- Ligne 58 : `Vide les 6 tables` → `Vide les 7 tables`
- Ligne 90 : `API lecture seule (4 routes)` → vérifier le contexte et aligner le compte si le tableau liste les 7 tables

### 4.4 F4 — Warning `kill_switch_partial_close` dans `backtest.md`

Ajouter après la ligne 85 (`kill_switch_force_close`) :

```markdown
| `kill_switch_partial_close` | `force_close_all` a échoué sur ≥1 position (close en erreur / positions restantes) — retry au prochain tick |
```

### 4.5 F6 — 3 routes data dans `api.md`

**Tableau § Weather Algo data** :

- Après `GET /position-forecasts` (ligne 397) :

```markdown
| GET | `/api/weather-algo-data/clob-price-history` | Liste (`city`, `from`, `to`, `limit`≤500) |
```

- Après `GET /bucket-ticks` (ligne 394) :

```markdown
| GET | `/api/weather-algo-data/bucket-ticks/dates` | Liste des dates distinctes de bucket ticks |
```

- Après la nouvelle ligne `GET /clob-price-history` :

```markdown
| GET | `/api/weather-algo-data/clob-price-history/dates` | Liste des dates distinctes de prix CLOB |
```

### 4.6 F7 — Retirer `WeatherAutoTrackJanitor` dans `weather-algo.md`

Supprimer la ligne 42 du tableau des processus :

```markdown
| `WeatherAutoTrackJanitor` | `pollMs` | Cleanup legacy (no-op après suppression de `WeatherMarketSelection`) |
```

### 4.7 F8 — Corriger le cycle auto-track dans `code/08-weather-algo.md`

- **Ligne 58** : `13. Timer auto-track (`config.pollMs`) + tick immédiat.` → supprimer (le timer auto-track n'existe plus). Renuméroter les étapes suivantes (14→13, 15→14) ou laisser les numéros si la renumérotation est jugée hors périmètre — **préférer la renumérotation** pour la cohérence.
- **Ligne 67** : `- **Auto-track tick** / **config reload** : ...` → `- **Config reload** : ...`
- **Ligne 81** : `3. `clearInterval` heartbeat + auto-track` → `3. `clearInterval` heartbeat + data-purge`

---

## 5. Validation

| Vérification | Méthode |
|--------------|---------|
| Routes documentées = routes du code | Comparer chaque route de `weather-algo-data.ts` / `weather-algo-history.ts` avec le tableau `api.md` (aucune route manquante ni fantôme) |
| Paramètres de run documentés = schéma Zod | Comparer `api.md:438` avec `backtest/src/params.ts` (tous les champs présents) |
| Warnings documentés = warnings émis | Comparer `backtest.md:76-93` avec les codes `warnOnce`/`setOrUpdateWarning` de `weather-adapter.ts` |
| Aucune référence au janitor auto-track | `rg "WeatherAutoTrackJanitor|auto-track" docs/weather-algo.md docs/code/08-weather-algo.md` → aucun résultat |
| Aucun wording « 6 tables » résiduel | `rg "6 tables" docs/` → aucun résultat (hors historique/plans archivés) |
| Markdown valide | Les tableaux restent bien formés (colonnes alignées) |

---

## 6. Reste à faire en prod

- Aucune migration ni redéploiement nécessaire (documentation uniquement).
- Smoke test doc : relire les sections modifiées pour vérifier la cohérence des tableaux et des liens croisés.
