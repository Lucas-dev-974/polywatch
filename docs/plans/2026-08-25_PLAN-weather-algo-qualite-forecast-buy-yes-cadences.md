# Plan — Weather algo : qualité forecast, BUY YES uniquement, cadences asymétriques

**Date** : 2026-08-25
**Auteur** : Assistant IA
**Statut** : 🟡 **En attente d'implémentation** — vague **B** (code `resolveWeatherDate`) + vague **E** (docs) du [plan maître](./2026-08-25_PLAN-weather-algo-implementation-master.md)
**Référence audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)
**Constats couverts** : #12 (BUY YES uniquement), #13 (std = désaccord de modèles, pas l'erreur vraie), #15 (cadences asymétriques)

---

## 📋 Contexte

Trois constats de l'audit concernent la nature même de la thèse de trading et sa fidélité :

- **#12** : l'algo n'ouvre que BUY YES. Un edge négatif (marché trop cher vs forecast) n'ouvre jamais de BUY NO. Moitié de la surface d'edge ignorée.
- **#13** : le std dev forecast est calculé sur 5 modèles Open-Meteo (désaccord entre modèles). Si les modèles sont biaisés ensemble, le std est faible et le seuil dynamique baisse à tort. Le geocode prend le 1er hit (Paris, TX possible). `resolveWeatherDate` prend l'année civile courante (fragile autour du 31/12).
- **#15** : drift / bucket au plus toutes les `pollMs` (défaut 30 min). SL/TP au tick worker. WS Polymarket connecté mais ne déclenche pas l'eval (poll-driven). Une position peut déraper sur SL entre deux polls sans que le runner le voie.

**Décisions produit** :
- #12 : hors scope par design — laisser BUY YES uniquement, documenter.

---

## Phase 1 — Documenter BUY YES uniquement (constat #12)

### Décision produit

Hors scope par design. L'algo n'ouvre que BUY YES (un edge négatif n'ouvre jamais de BUY NO). C'est un choix assumé, pas un bug.

### Patch

1. **Documenter** dans `docs/weather-algo.md` (section §3 stratégies) et `docs/code/08-weather-algo.md` (section stratégies) :

> **BUY YES uniquement** : l'algo n'ouvre que des positions BUY YES, même si l'edge est négatif (marché trop cher vs forecast). C'est un choix par design — la surface d'edge négatif (BUY NO) n'est pas exploitée. Une stratégie BUY NO serait une évolution future, hors scope actuel.

2. **Documenter dans l'interface** `WeatherSignal` (`strategy.ts:9`) : le champ `side: 'BUY'` et `outcome: 'YES' | 'NO'` — préciser que `outcome: 'NO'` n'est jamais émis par les stratégies weather actuelles.

3. **Ne pas modifier le code** — c'est une documentation, pas un changement fonctionnel.

### Fichiers touchés

- `docs/weather-algo.md`
- `docs/code/08-weather-algo.md`

---

## Phase 2 — Améliorer la qualité du forecast (constat #13)

### Problème

Trois sous-constats :

#### 2.1 — Std = désaccord de modèles, pas l'erreur vraie

`buildForecastFromModelResults` (`weather-api-client.ts:160-180`) calcule le std sur 5 modèles Open-Meteo. Si les modèles sont biaisés ensemble (ex. tous prévoient 2 °C de trop), le std est faible et `resolveDynamicMinEdge` (`weather-edge.ts:30`) baisse le seuil dynamique à tort. Le std mesure l'**incertitude inter-modèles**, pas l'**erreur de prévision**.

#### 2.2 — Geocode : 1er hit ambigu

`geocodeCity` (`weather-api-client.ts:32-55`) prend le 1er résultat de l'API Open-Meteo geocoding. "Paris" peut retourner Paris, TX avant Paris, France. Pas de filtre pays / population.

#### 2.3 — `resolveWeatherDate` : année civile courante (**pas** display-only)

Le commentaire JSDoc de `resolveWeatherDate` dit « display/logging only ». **C'est faux.** `resolveMarketTargetDateIso` (`weather-market-discovery.ts` ~527) parse la question **en premier** via `resolveWeatherDate`, et ne tombe sur `market.endDate` qu'ensuite. Le runner groupe et fetch le forecast sur ce `dateKey`. Autour du 31/12, « January 1 » peut basculer d'année et **changer la paire ville+date live**.

À livrer **avec ou avant** la Phase 1 du plan date-unique (sinon l'autorité `dateKey` reste fausse au rollover).

### Patch

#### 2.1 — Documenter la limite du std inter-modèles

1. **Documenter** dans `code/08-weather-algo.md` : le std dev forecast mesure l'incertitude **inter-modèles** (désaccord entre GFS / ECMWF / ICON / JMA / MeteoFrance), pas l'erreur absolue de prévision. Si tous les modèles sont biaisés ensemble, le std est faible et le seuil dynamique baisse. C'est une limitation connue.

2. **Étudier** (plan futur, hors ce patch) : ajouter une marge d'erreur systématique (ex. `max(forecastStdDev, MIN_STD_FLOOR)`) pour éviter un seuil dynamique trop bas quand le std est faible. `MIN_STD_FLOOR` serait un tunable (défaut 1.0 °C ?).

#### 2.2 — Améliorer le geocode

1. **Ajouter un filtre de confiance** au geocode. Open-Meteo geocoding retourne `country_code`, `population`, `admin1` (état/région). Préférer le résultat avec la plus grande `population` si plusieurs résultats :

```ts
// weather-api-client.ts — geocodeCity
const url = `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(city)}&count=5&language=en&format=json`;
// ...
const results = data.results ?? [];
if (results.length === 0) return null;
// Trier par population décroissante (fallback sur le 1er si population absente)
results.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
const r = results[0]!;
```

2. **Vérifier** que les villes surveillées (auto-track rules) sont des grandes villes (population élevée) — sinon ajouter un champ `country` aux `WeatherAutoTrackRule` pour désambiguïser.

#### 2.3 — Corriger `resolveWeatherDate` (code, pas seulement la doc)

1. Passer une **année de référence** (année UTC de `market.endDate` si dispo, sinon `now`). Signature du type `resolveWeatherDate(dateString, referenceYear?: number)`.
2. `resolveMarketTargetDateIso` **et** `resolveGroupTargetDate` : année UTC de `market.endDate` (premier marché du groupe qui en a une).
3. Corriger le JSDoc (retirer « display/logging only »).
4. Autres appelants : uniquement ces deux + tests. Signature optionnelle `referenceYear?: number` = `getUTCFullYear()` si omis (rétrocompat tests unitaires du parser).

Hors scope ici : `MIN_STD_FLOOR` (plan futur). Geocode : tri population uniquement ; pas de champ `country` sur `WeatherAutoTrackRule` dans ce patch.

### Fichiers touchés

- `packages/core/src/weather/weather-api-client.ts` (geocode, count=5, sort population)
- `packages/core/src/weather/question-parser.ts` (`resolveWeatherDate` + année de référence)
- `packages/core/src/weather/weather-market-discovery.ts` (`resolveMarketTargetDateIso`)
- `docs/code/08-weather-algo.md` (limitation std inter-modèles, geocode, dateKey)
- Tests : `weather-api-client.test.ts`, `question-parser` / `weather-market-discovery` (rollover 31/12)

---

## Phase 3 — Documenter les cadences asymétriques (constat #15)

### Problème

- Drift / bucket-exit au plus toutes les `pollMs` (défaut 30 min) — évalué par `WeatherExitEvaluator` au début de chaque cycle.
- SL / TP / trailing au tick worker — évalué par `PositionExitEvaluator` du worker sur chaque tick de carnet.
- WS Polymarket connecté au boot mais ne déclenche pas l'eval (poll-driven).

Conséquence : une position peut déraper sur SL entre deux polls sans que le runner le voie (le worker le voit via les ticks). Ce n'est pas un bug — c'est le design — mais c'est non documenté.

### Patch

1. **Documenter** dans `docs/weather-algo.md` (section §2 processus) et `docs/code/08-weather-algo.md` (section processus) :

> **Cadences asymétriques** :
> - **Drift / bucket-exit** : évalués au début de chaque cycle runner (poll `weatherAlgoPollMs`, défaut 30 min).
> - **SL / TP / trailing** : évalués au tick par le worker (carnet), indépendamment du poll runner.
> - **WS Polymarket** : connecté au boot pour les prix exécutables, mais ne déclenche pas l'eval weather (poll-driven).
>
> Conséquence : une position peut déraper sur SL entre deux polls sans que le runner le voie. Le worker le voit via les ticks et ferme la position. Ce design sépare les sorties « thèse forecast » (poll) des sorties « risque » (tick).

2. **Ne pas modifier le code** — c'est une documentation, pas un changement fonctionnel. Si on veut unifier (eval drift au tick), c'est une refonte majeure hors scope.

### Fichiers touchés

- `docs/weather-algo.md`
- `docs/code/08-weather-algo.md`

---

## Checklist de validation

### Phase 1 (BUY YES uniquement)
- [ ] `weather-algo.md` : section BUY YES uniquement documentée
- [ ] `code/08-weather-algo.md` : idem
- [ ] `strategy.ts` : commentaire sur `side: 'BUY'` / `outcome`

### Phase 2 (qualité forecast)
- [ ] Geocode : `count=5` + tri par population
- [ ] `weather-api-client.test.ts` : test multi-résultats → plus grande population
- [ ] Doc : limitation std inter-modèles documentée
- [ ] `resolveWeatherDate(dateString, referenceYear)` dans `resolveMarketTargetDateIso` **et** `resolveGroupTargetDate`
- [ ] Test rollover 31/12 (+ test parser sans year → année courante)
- [ ] JSDoc corrigé (plus display-only)
- [ ] Étude `MIN_STD_FLOOR` (plan futur, hors ce patch)

### Phase 3 (cadences asymétriques)
- [ ] `weather-algo.md` : section cadences asymétriques documentée
- [ ] `code/08-weather-algo.md` : idem

---

## Références

- Audit : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md) §4 #12, #13, #15
- Canvas : [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx)