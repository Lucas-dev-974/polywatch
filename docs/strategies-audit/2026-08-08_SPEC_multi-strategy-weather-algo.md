# Spécification — Multi-stratégies Weather Algo

**Date** : 2026-08-08
**Statut** : **Partiellement implémenté** (2026-08-09) — étape 1 livrée ; stratégies avancées = futur
**Scope** : Ajouter des stratégies au weather algo + sélection configurable via l'UI
**Référence audit** : [`2026-08-08_audit-weather-forecast-strategy.md`](./2026-08-08_audit-weather-forecast-strategy.md)
**Référence plan livré** : [`../weather-algo-audits-plans/2026-08-09_PLAN-weather-multi-strategy-extensible.md`](../weather-algo-audits-plans/2026-08-09_PLAN-weather-multi-strategy-extensible.md)
**Référence canvas** : [`weather-algo-audit.canvas.tsx`](../../.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-audit.canvas.tsx)

### État d'avancement (2026-08-09)

| Élément | État |
|---|---|
| Mécanisme multi-stratégies (catalogue, `weatherAlgoStrategies`, onglet UI, `evaluateGroup`, first-wins) | ✅ livré |
| `weather-forecast` (best-edge) + `weather-forecast-aligned` | ✅ livré |
| `weather-spread` / `weather-convergence` / `weather-arbitrage` | ❌ futur — sections ci-dessous restent la spec cible |

---

## 1. Contexte

Au moment de la rédaction, le weather algo n'avait qu'une stratégie (`weather-forecast`) avec un win rate de 11.96% et un PnL net de -18.45 USDC. L'audit a identifié que la stratégie forecast est valide conceptuellement mais souffre de défauts structurels : bucket-exits répétitifs, sensibilité à l'incertitude du forecast, et pas de couverture.

Cette spec décrit l'ajout de stratégies avancées (`weather-spread`, `weather-convergence`, `weather-arbitrage`) et le mécanisme de sélection configurable via l'UI. Le mécanisme + les deux variantes forecast sont livrés (voir plan 2026-08-09) ; le reste de ce document reste la cible produit.

---

## 2. Stratégies existantes et proposées

### 2.1 Stratégie existante — `weather-forecast` (value bet directionnel)

**ID** : `weather-forecast`
**Statut** : implémentée (`packages/weather-algo/src/strategy/weather-forecast.strategy.ts`)
**Logique** : compare la probabilité forecast YES (via distribution normale CDF) avec le prix marché. BUY YES si `edge > seuil dynamique` ET `forecastProb ≥ minForecastProb`.
**Faiblesse** : exposition totale à l'incertitude du forecast, bucket-exits fréquents.

### 2.2 Nouvelle stratégie — `weather-spread` (couverture directionnelle)

**ID** : `weather-spread`
**Logique** :
1. Calculer la distribution de probabilité sur tous les paliers d'une ville via `buildTempProbabilityDistribution` (déjà dans `packages/core/src/weather/forecast-distribution.ts`)
2. Identifier le palier P1 avec la plus haute probabilité (le "mode")
3. Identifier le palier P2 adjacent avec la seconde plus haute probabilité
4. BUY YES sur P1 si `P1_forecastProb - P1_marketPrice > minEdge`
5. BUY NO sur P2 si `P2_marketPrice - P2_forecastProb > minEdge` (le marché surévalue P2)
6. PnL net = `P1_gain + P2_couverture` — limité mais moins volatile

**Avantage vs forecast** : si la température tombe dans P1, P1 gagne et P2 expire (couverture gratuite). Si elle tombe dans P2, P1 perd mais P2 gagne (perte limitée à la différence).

**Données requises** : déjà disponibles — `buildTempProbabilityDistribution`, `computeMarketImpliedProbabilities`, `market.outcomePrices` (YES et NO).

**Sorties** : pre-close sur P1 + pre-close sur P2 (indépendants). Pas de trailing (trade couvert, pas directionnel). Pas de bucket-exit (les deux jambes sont gérées indépendamment jusqu'à pre-close ou résolution).

**Nouveaux paramètres config** :
- `weatherAlgoSpreadEnabled` (boolean, défaut `false`)
- `weatherAlgoSpreadMaxGap` (number, défaut `2`) — distance max entre P1 et P2 en °C
- `weatherAlgoSpreadMinNetEdge` (number, défaut `0.08`) — edge net minimum sur le spread combiné

**Effort** : ~150 lignes stratégie + ~50 lignes config/policy

### 2.3 Nouvelle stratégie — `weather-convergence` (momentum forecast)

**ID** : `weather-convergence`
**Logique** :
1. À chaque poll, stocker `forecastMean` et `forecastStdDev` dans un historique Redis (TTL 24h, clé `weather-forecast-history:{city}:{date}`)
2. Comparer le forecast actuel au précédent : `delta = forecastMean_now - forecastMean_prev`
3. Calculer la distance au centre du bucket : `dist_now = |forecastMean_now - bucketCentre|` et `dist_prev = |forecastMean_prev - bucketCentre|`
4. Signal si : `dist_now < dist_prev` (convergence) **ET** `dist_now < forecastStdDev` (forecast dans la zone de confiance) **ET** `edge > minEdge`
5. Abstention si `dist_now > dist_prev` (divergence — le forecast s'éloigne du bucket)

**Avantage vs forecast** : n'entre que si le forecast **se rapproche** du bucket → réduit drastiquement les bucket-exits. Capture la momentum du forecast : un forecast qui converge a une probabilité YES croissante que le marché n'a pas encore price-in.

**Données requises** : `forecastService.getOrFetch` (déjà disponible). Ajouter un historique Redis léger (clé TTL 24h avec les 2-3 derniers polls).

**Sorties** : bucket-exit standard (`close_and_reenter`), mais beaucoup plus rare car on n'entre que sur convergence. Trailing activé.

**Nouveaux paramètres config** :
- `weatherAlgoConvergenceEnabled` (boolean, défaut `false`)
- `weatherAlgoConvergenceMinDelta` (number, défaut `0.1`) — delta minimum de convergence (°C) pour valider le signal
- `weatherAlgoConvergenceHistoryTtlMs` (number, défaut `86400000`) — TTL de l'historique Redis (24h)

**Effort** : ~120 lignes stratégie + ~30 lignes Redis history + ~40 lignes config

### 2.4 Nouvelle stratégie — `weather-arbitrage` (mispricing inter-paliers)

**ID** : `weather-arbitrage`
**Logique** :
1. Pour une ville/date, récupérer tous les paliers et leurs prix YES : `prices = [P1_yes, P2_yes, ..., Pn_yes]`
2. Calculer `sum = Σ Pi_yes` — devrait être ~1.0 (les paliers couvrent tout l'espace de température, mutuellement exclusifs)
3. Si `sum > 1.0 + tolerance` : le marché surévalue l'ensemble → BUY NO sur le palier le plus surévalué (celui où `Pi_yes - forecastProb_i` est le plus négatif)
4. Si `sum < 1.0 - tolerance` : le marché sous-évalue l'ensemble → BUY YES sur le palier le plus sous-évalué (celui où `forecastProb_i - Pi_yes` est le plus positif)
5. L'arbitrage est market-neutral : on ne parie pas sur la température réelle, on parie sur la correction de l'inefficience du marché

**Avantage vs forecast** : insensible à l'incertitude du forecast. Même si le forecast se trompe, l'arbitrage peut être gagnant si le marché corrige l'incohérence. Pas de bucket-exit (pas de suivi forecast).

**Données requises** : déjà disponibles — tous les paliers d'une ville sont découverts par `discoverWeatherMarkets` et groupés par date dans `evaluateCityFollowDateGroup`. Les prix YES sont dans `market.outcomePrices[0].price`.

**Adaptation du runner nécessaire** : actuellement le runner passe un seul bucket (le aligné au forecast) à la stratégie. Pour `weather-arbitrage`, il faut passer **tous les buckets** d'une ville/date à la stratégie pour qu'elle calcule le `sum`. L'interface `WeatherStrategy.evaluate` prend un `market` (un seul bucket) — il faudra soit ajouter une méthode `evaluateGroup(markets, ctx)` à l'interface, soit passer les buckets via le `ctx`.

**Sorties** : sortie quand `|sum - 1.0| < tolerance/2` (le mispricing se résorbe). Pre-close standard. Pas de bucket-exit. Pas de trailing (pas directionnel).

**Nouveaux paramètres config** :
- `weatherAlgoArbitrageEnabled` (boolean, défaut `false`)
- `weatherAlgoArbitrageTolerance` (number, défaut `0.05`) — écart minimum de `sum` vs 1.0 pour déclencher (5%)
- `weatherAlgoArbitrageMinEdge` (number, défaut `0.05`) — edge minimum sur le palier sélectionné

**Effort** : ~200 lignes stratégie + ~50 lignes config + adaptation du runner (~50 lignes)

---

## 3. Catalogue des stratégies

| ID | Nom affiché UI | Description courte | Directionnel | Sensible forecast | Bucket-exit | Trailing |
|---|---|---|---|---|---|---|
| `weather-forecast` | Forecast (value bet) | BUY YES si edge forecast > seuil | Oui | Oui (statique) | Oui | Oui |
| `weather-spread` | Spread (couverture) | BUY YES P1 + BUY NO P2 adjacent | Oui (couvert) | Oui (centrage) | Non | Non |
| `weather-convergence` | Convergence (momentum) | BUY YES si forecast converge vers bucket | Oui | Oui (dynamique) | Oui (rare) | Oui |
| `weather-arbitrage` | Arbitrage (mispricing) | BUY YES/NO sur palier mal pricé si Σ ≠ 1.0 | Non | Non | Non | Non |

---

## 4. Configuration

### 4.1 Nouvelle colonne `WeatherConfig`

Ajouter une colonne `weather_algo_strategies` à l'entité `WeatherConfig` (`packages/core/src/entities/WeatherConfig.ts`), suivant le même pattern que `cryptoAlgoStrategies` du crypto-algo.

```typescript
@Column({ type: 'text', name: 'weather_algo_strategies', default: '["weather-forecast"]' })
weatherAlgoStrategies!: string;
```

**Stockage** : JSON string (array d'IDs de stratégies), désérialisé en `string[]` par l'API.

**Défaut** : `["weather-forecast"]` — rétro-compatible (la stratégie existante reste active).

### 4.2 Migration TypeORM

```typescript
// AddWeatherAlgoStrategies1700000000093.ts
export class AddWeatherAlgoStrategies1700000000093 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE weather_config
      ADD COLUMN weather_algo_strategies text NOT NULL DEFAULT '["weather-forecast"]'
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN weather_algo_strategies`);
  }
}
```

### 4.3 API — présentation et sérialisation

Adapter `packages/core/src/risk/weather-config-api.ts` pour désérialiser/sérialiser `weatherAlgoStrategies` comme `string[]` (même pattern que `weatherAlgoAllowedMarketTags`).

```typescript
// WeatherConfigApi : weatherAlgoStrategies devient string[]
export type WeatherConfigApi = Omit<WeatherConfig, 'weatherAlgoAllowedMarketTags' | 'weatherAlgoStrategies'> & {
  weatherAlgoAllowedMarketTags: string[];
  weatherAlgoStrategies: string[];
};
```

### 4.4 Paramètres spécifiques par stratégie

Tous les nouveaux paramètres sont des colonnes sur `WeatherConfig` (une seule table, pas de sous-table). Chaque stratégie a son préfixe pour éviter les collisions.

| Colonne | Type | Défaut | Stratégie |
|---|---|---|---|
| `weather_algo_strategies` | text (JSON array) | `["weather-forecast"]` | Toutes |
| `weather_algo_spread_enabled` | boolean | `false` | spread |
| `weather_algo_spread_max_gap` | real | `2` | spread |
| `weather_algo_spread_min_net_edge` | real | `0.08` | spread |
| `weather_algo_convergence_enabled` | boolean | `false` | convergence |
| `weather_algo_convergence_min_delta` | real | `0.1` | convergence |
| `weather_algo_convergence_history_ttl_ms` | integer | `86400000` | convergence |
| `weather_algo_arbitrage_enabled` | boolean | `false` | arbitrage |
| `weather_algo_arbitrage_tolerance` | real | `0.05` | arbitrage |
| `weather_algo_arbitrage_min_edge` | real | `0.05` | arbitrage |

**Note** : les toggles `*_enabled` sont redondants avec la présence dans `weatherAlgoStrategies`, mais suivent le pattern existant (`weatherAlgoSlEnabled`, etc.) pour la cohérence UI. Le runner utilise `weatherAlgoStrategies` comme source de vérité ; les `*_enabled` sont des raccourcis UI.

### 4.5 Validation

Côté backend (`packages/backend/src/routes/config-per-kind.ts`), valider que :
- `weatherAlgoStrategies` est un array de strings
- Chaque ID est dans le catalogue valide : `["weather-forecast", "weather-spread", "weather-convergence", "weather-arbitrage"]`
- Au moins une stratégie est activée (sinon l'algo ne produit aucun signal)

---

## 5. Sélection au runtime

### 5.1 Registry

Le `WeatherStrategyRegistry` (`packages/weather-algo/src/strategy/registry.ts`) enregistre déjà toutes les stratégies au boot. Aucun changement : les 4 stratégies sont enregistrées statiquement.

### 5.2 Runner — filtrage par config

Dans `WeatherStrategyRunner.runEvaluationCycle`, après `this.registry.getAll()`, filtrer les stratégies par `weatherAlgoStrategies` :

```typescript
// Avant (actuel) : toutes les stratégies du registry évaluent chaque bucket
const strategies = this.registry.getAll();

// Après : seules les stratégies activées dans la config évaluent
const allStrategies = this.registry.getAll();
const enabledIds = JSON.parse(this.risk.weatherAlgoStrategies ?? '["weather-forecast"]');
const strategies = allStrategies.filter((s) => enabledIds.includes(s.id));
```

**Comportement first-wins** : dans `evaluateCityFollowDateGroup`, les stratégies sont évaluées dans l'ordre du registry pour chaque bucket. La première qui émet un signal gagne (déjà le cas — `break` après `result.kind === 'signal'`). L'ordre du registry détermine la priorité.

### 5.3 Adaptation pour `weather-arbitrage`

`weather-arbitrage` a besoin de **tous les buckets** d'une ville/date, pas seulement le bucket aligné au forecast. Deux options :

**Option A — étendre l'interface** : ajouter une méthode optionnelle `evaluateGroup(markets, ctx)` à `WeatherStrategy` :

```typescript
export interface WeatherStrategy {
  readonly id: string;
  evaluate(market: MarketListItemDto, ctx: WeatherEvaluationContext): Promise<WeatherEvaluationResult>;
  /** Optionnel : évaluation sur le groupe complet de buckets d'une ville/date. */
  evaluateGroup?(markets: MarketListItemDto[], ctx: WeatherEvaluationContext): Promise<WeatherEvaluationResult>;
  setRiskConfig?(risk: WeatherConfig): void;
}
```

Le runner appelle `evaluateGroup` si elle existe, sinon fallback sur `evaluate` par bucket (comportement actuel).

**Option B — passer les buckets via le ctx** : étendre `WeatherEvaluationContext` avec un champ optionnel `allBuckets?: MarketListItemDto[]`. Moins propre mais moins de changement d'interface.

**Recommandation** : Option A (plus explicite, ne casse pas les stratégies existantes).

---

## 6. UI

### 6.1 Onglet Paramètres Weather Algo — section Stratégies

Ajouter une section **"Stratégies activées"** dans `WeatherAlgoSettingsTab.tsx` (`packages/frontend/src/components/WeatherAlgoSettingsTab.tsx`), juste après la section "Activation" (avant "Polling & anti-churn").

Suivre le pattern exact du crypto-algo (`CryptoAlgoSettingsGeneralTab.tsx` lignes 28-53) :

```tsx
const WEATHER_ALGO_STRATEGIES: { id: string; label: string; hint: string }[] = [
  { id: 'weather-forecast', label: 'Forecast (value bet)', hint: 'BUY YES si edge forecast > seuil' },
  { id: 'weather-spread', label: 'Spread (couverture)', hint: 'BUY YES P1 + BUY NO P2 adjacent' },
  { id: 'weather-convergence', label: 'Convergence (momentum)', hint: 'BUY YES si forecast converge vers bucket' },
  { id: 'weather-arbitrage', label: 'Arbitrage (mispricing)', hint: 'BUY YES/NO si Σ prix paliers ≠ 1.0' },
];
```

Rendu : checkbox group (comme crypto-algo), ordre = priorité d'évaluation (first-wins).

```tsx
<div class="form-field">
  <label>Stratégies activées (catalogue)</label>
  <p class="form-hint">
    Ordre = priorité d'évaluation (first-wins). Une seule stratégie active à la fois recommandée en sim.
    Les stratégies non reconnues sont ignorées.
  </p>
  <div class="settings-checkbox-group">
    <For each={WEATHER_ALGO_STRATEGIES}>
      {(strategy) => (
        <label class="checkbox-tag">
          <input
            type="checkbox"
            checked={c().weatherAlgoStrategies.includes(strategy.id)}
            onChange={(e) => {
              const current = c().weatherAlgoStrategies;
              const next = e.currentTarget.checked
                ? [...current, strategy.id]
                : current.filter((s) => s !== strategy.id);
              update('weatherAlgoStrategies', next);
            }}
          />
          <span>{strategy.label}</span>
          <span class="checkbox-tag-hint">{strategy.hint}</span>
        </label>
      )}
    </For>
  </div>
</div>
```

### 6.2 Sections conditionnelles par stratégie

Ajouter une section repliable par stratégie active, avec ses paramètres spécifiques. Visible uniquement si la stratégie est cochée.

```tsx
<Show when={c().weatherAlgoStrategies.includes('weather-spread')}>
  <h3 class="settings-subheading">Spread (couverture)</h3>
  <NumberField
    label="Écart max P1-P2 (°C)"
    value={c().weatherAlgoSpreadMaxGap}
    min={1}
    max={10}
    step={0.5}
    hint="Distance max entre le palier principal et le palier de couverture."
    onChange={(value) => update('weatherAlgoSpreadMaxGap', value)}
  />
  <NumberField
    label="Edge net minimum"
    value={c().weatherAlgoSpreadMinNetEdge}
    min={0.01}
    max={0.30}
    step={0.01}
    hint="Edge combiné minimum (edge P1 + edge P2) pour déclencher le spread."
    onChange={(value) => update('weatherAlgoSpreadMinNetEdge', value)}
  />
</Show>

<Show when={c().weatherAlgoStrategies.includes('weather-convergence')}>
  <h3 class="settings-subheading">Convergence (momentum)</h3>
  <NumberField
    label="Delta min convergence (°C)"
    value={c().weatherAlgoConvergenceMinDelta}
    min={0.01}
    max={5}
    step={0.05}
    hint="Rapprochement minimum du forecast vers le bucket entre 2 polls pour valider le signal."
    onChange={(value) => update('weatherAlgoConvergenceMinDelta', value)}
  />
  <NumberField
    label="TTL historique forecast (ms)"
    value={c().weatherAlgoConvergenceHistoryTtlMs}
    min={3600000}
    max={604800000}
    step={3600000}
    hint="Durée de rétention de l'historique des forecasts en Redis."
    onChange={(value) => update('weatherAlgoConvergenceHistoryTtlMs', value)}
  />
</Show>

<Show when={c().weatherAlgoStrategies.includes('weather-arbitrage')}>
  <h3 class="settings-subheading">Arbitrage (mispricing)</h3>
  <NumberField
    label="Tolérance Σ vs 1.0"
    value={c().weatherAlgoArbitrageTolerance}
    min={0.01}
    max={0.20}
    step={0.01}
    hint="Écart minimum entre la somme des prix YES et 1.0 pour déclencher l'arbitrage."
    onChange={(value) => update('weatherAlgoArbitrageTolerance', value)}
  />
  <NumberField
    label="Edge minimum palier"
    value={c().weatherAlgoArbitrageMinEdge}
    min={0.01}
    max={0.30}
    step={0.01}
    hint="Edge minimum sur le palier sélectionné (forecastProb vs marketPrice)."
    onChange={(value) => update('weatherAlgoArbitrageMinEdge', value)}
  />
</Show>
```

### 6.3 Types frontend

Étendre `WeatherConfig` dans `packages/frontend/src/api.ts` :

```typescript
export interface WeatherConfig {
  // ... champs existants ...
  weatherAlgoStrategies: string[];
  weatherAlgoSpreadMaxGap: number;
  weatherAlgoSpreadMinNetEdge: number;
  weatherAlgoConvergenceMinDelta: number;
  weatherAlgoConvergenceHistoryTtlMs: number;
  weatherAlgoArbitrageTolerance: number;
  weatherAlgoArbitrageMinEdge: number;
}
```

Étendre `updateWeatherConfig` dans `WeatherAlgoSettingsTab.tsx` pour inclure les nouveaux champs dans le payload `saveConfig`.

### 6.4 Affichage runtime status

Dans le panel de statut weather-algo (frontend), afficher la/les stratégie(s) active(s) avec un badge. Le runtime status Redis (`weather-algo:runtime-status`) pourrait inclure le champ `activeStrategies: string[]`.

---

## 7. Plan d'implémentation

### Phase 1 — Foundation (config + registry + UI selection)

| Tâche | Fichier | Effort |
|---|---|---|
| Migration `AddWeatherAlgoStrategies` | `packages/core/src/migrations/` | 30 min |
| Colonne `weatherAlgoStrategies` sur `WeatherConfig` | `packages/core/src/entities/WeatherConfig.ts` | 15 min |
| API présentation/sérialisation `weatherAlgoStrategies` | `packages/core/src/risk/weather-config-api.ts` | 30 min |
| Validation backend (catalogue valide) | `packages/backend/src/routes/config-per-kind.ts` | 30 min |
| Type frontend `WeatherConfig` + `fetchWeatherConfig` | `packages/frontend/src/api.ts` | 15 min |
| UI section "Stratégies activées" (checkbox group) | `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx` | 45 min |
| Runner — filtrage par `weatherAlgoStrategies` | `packages/weather-algo/src/strategy/strategy-runner.ts` | 30 min |

**Total Phase 1** : ~3h. Permet de sélectionner `weather-forecast` uniquement (comportement inchangé) et de préparer l'infrastructure pour les 3 nouvelles stratégies.

### Phase 2 — Stratégie `weather-convergence`

| Tâche | Fichier | Effort |
|---|---|---|
| Implémentation `WeatherConvergenceStrategy` | `packages/weather-algo/src/strategy/weather-convergence.strategy.ts` | 2h |
| Historique Redis forecast | `packages/core/src/redis/weather-forecast-history.ts` | 1h |
| Colonnes config convergence | `packages/core/src/entities/WeatherConfig.ts` + migration | 30 min |
| UI section convergence (conditionnelle) | `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx` | 30 min |
| Tests unitaires | `packages/weather-algo/src/strategy/weather-convergence.strategy.test.ts` | 1h |
| Enregistrement registry | `packages/weather-algo/src/strategy/registry.ts` | 5 min |

**Total Phase 2** : ~5h.

### Phase 3 — Stratégie `weather-spread`

| Tâche | Fichier | Effort |
|---|---|---|
| Implémentation `WeatherSpreadStrategy` | `packages/weather-algo/src/strategy/weather-spread.strategy.ts` | 2h |
| Adaptation entry-pipeline (2 ordres par signal) | `packages/weather-algo/src/processors/weather-entry-pipeline.ts` | 1h |
| Colonnes config spread | `packages/core/src/entities/WeatherConfig.ts` + migration | 30 min |
| UI section spread (conditionnelle) | `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx` | 30 min |
| Tests unitaires | `packages/weather-algo/src/strategy/weather-spread.strategy.test.ts` | 1h |

**Total Phase 3** : ~5h.

### Phase 4 — Stratégie `weather-arbitrage`

| Tâche | Fichier | Effort |
|---|---|---|
| Extension interface `evaluateGroup` | `packages/weather-algo/src/strategy/strategy.ts` | 15 min |
| Implémentation `WeatherArbitrageStrategy` | `packages/weather-algo/src/strategy/weather-arbitrage.strategy.ts` | 2h |
| Adaptation runner (passer tous les buckets) | `packages/weather-algo/src/strategy/strategy-runner.ts` | 1h |
| Colonnes config arbitrage | `packages/core/src/entities/WeatherConfig.ts` + migration | 30 min |
| UI section arbitrage (conditionnelle) | `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx` | 30 min |
| Tests unitaires | `packages/weather-algo/src/strategy/weather-arbitrage.strategy.test.ts` | 1h |

**Total Phase 4** : ~5h.

### Total global : ~18h

---

## 8. Tests

### 8.1 Tests unitaires par stratégie

Chaque stratégie a son fichier de test (`*.strategy.test.ts`) couvrant :
- Signal émis quand les conditions sont remplies
- Abstention quand edge insuffisant
- Abstention quand forecast diverge (convergence)
- Abstention quand Σ ≈ 1.0 (arbitrage)
- Abstention quand pas de bucket adjacent (spread)

### 8.2 Test d'intégration runner

Tester que `WeatherStrategyRunner` :
- N'évalue que les stratégies dans `weatherAlgoStrategies`
- Respecte l'ordre first-wins
- Émet au plus un signal par ville

### 8.3 Test E2E

Étendre `e2e/weather-algo/weather-algo.e2e.test.ts` :
- Activer `weather-convergence` uniquement → vérifier que les signaux ont `strategyId: 'weather-convergence'`
- Activer `weather-forecast` + `weather-convergence` → vérifier first-wins (forecast évalue en premier)

---

## 9. Compatibilité et migration

### Rétro-compatibilité

- `weatherAlgoStrategies` défaut = `["weather-forecast"]` → aucune changement de comportement pour les sessions existantes
- Les stratégies non implémentées dans le registry sont ignorées silencieusement (warn log)
- L'UI n'affiche que les stratégies du catalogue hardcoded (les IDs inconnus sont ignorés)

### Migration données

- La migration ajoute la colonne avec défaut `["weather-forecast"]` — pas de backfill nécessaire
- Les sessions sim en cours continuent avec `weather-forecast` uniquement
- Les config revisions (`RiskConfigRevision`) incluent automatiquement la nouvelle colonne

### Risques

| Risque | Mitigation |
|---|---|
| `weather-arbitrage` nécessite adaptation du runner | Phase 4 isolée, ne casse pas les stratégies existantes |
| `weather-spread` émet 2 ordres par signal | Adapter entry-pipeline (Phase 3) |
| `weather-convergence` dépend de Redis history | TTL 24h auto-expirant, pas de cleanup manuel |
| Performance — 4 stratégies évaluent chaque bucket | First-wins + filtrage par config, coût négligeable |

---

## 10. Diagramme de flux (cible)

```
WeatherAlgoStrategies = ["weather-forecast", "weather-convergence", "weather-spread", "weather-arbitrage"]
                                         │
                                         ▼
                            WeatherStrategyRunner
                            (filtrage par config)
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              weather-forecast    weather-convergence    weather-arbitrage
              (evaluate)          (evaluate + Redis)     (evaluateGroup*)
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
                              First-wins → WeatherSignal
                                         │
                                         ▼
                          runWeatherEntryPipeline
                                         │
                                         ▼
                          worker Executor → order
```

*`evaluateGroup` pour arbitrage — les autres utilisent `evaluate` standard.

---

## 11. Ordre de priorité d'implémentation

Recommandé : implémenter dans l'ordre suivant, chaque phase étant indépendamment testable et déployable.

1. **Phase 1** (foundation) — infrastructure config + UI selection + runner filtering. Permet de sélectionner uniquement `weather-forecast` (comportement inchangé).
2. **Phase 2** (`weather-convergence`) — corrige le problème #1 de l'audit (bucket-exits). Effort minimal, impact maximal.
3. **Phase 3** (`weather-spread`) — réduit la volatilité. Utile pour les villes à std dev élevé.
4. **Phase 4** (`weather-arbitrage`) — diversification décorrélée du forecast. La plus complexe.

Chaque phase peut être validée en sim avant de passer à la suivante. Critères de validation identiques à ceux de l'audit : win rate, PnL net, exit attempts, 0 position stuck.