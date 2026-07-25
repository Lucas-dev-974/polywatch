# Interrompre la surveillance quand le copy trading est désactivé — Variante B (coupure totale)

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Lorsque le copy trading est désactivé globalement (`simCopyTradingEnabled` **et** `realCopyTradingEnabled` sont `false`), le `MoveDetector` du package `copy-trading` arrête complètement sa boucle de surveillance : timer arrêté, aucune adresse de la watchlist n'est interrogée. Lorsqu'un des deux modes est réactivé (via le frontend qui publie `config-changed` sur Redis), la surveillance redémarre automatiquement.

**Architecture:** La décision est centralisée dans `MoveDetector` via un helper `isAnyCopyTradingEnabled(risk)` du `RiskService`. Au démarrage de chaque cycle, le detector charge la config Risk. Si aucun mode n'est actif, il appelle `stopPolling()` et retourne immédiatement. Le handler Redis `config-changed` dans `copy-trading/index.ts` est étendu pour relancer `startPolling()` si le detector est arrêté et que la config indique qu'au moins un mode est actif.

**Tech Stack:** TypeScript, Node.js, TypeORM (`RiskService`), Redis pub/sub, `safeInterval` / `setTimeout`.

---

## Contexte actuel

- `packages/copy-trading/src/processors/move-detector.ts:184-208` — `pollAll()` charge la watchlist et interroge chaque trader actif toutes les `intervalMs`.
- `packages/copy-trading/src/processors/move-detector.ts:210-249` — `runCycle()` programme les cycles via `setTimeout`.
- `packages/copy-trading/src/index.ts:105-109` et `:144-159` — charge l'intervalle au démarrage et à chaque `config-changed`.
- `packages/core/src/services/risk.service.ts:85-101` — fournit `isSimCopyTradingEnabledForConfig()` et `isRealCopyTradingEnabledForConfig()`.
- `packages/copy-trading/src/processors/copy/copy-risk-gate.ts:82-96` — bloque déjà les entrées quand un mode est désactivé, mais le polling continue.
- Le frontend peut désactiver le copy trading via `/risk-config` (`SimHero.tsx:90-101`, `RealHero.tsx:46-57`).

---

## Task 1: Ajouter un helper global "copy trading activé" dans RiskService

**Objective:** Offrir une source unique de vérité pour savoir si au moins un mode de copy trading est activé.

**Files:**
- Modify: `packages/core/src/services/risk.service.ts`

**Step 1: Vérifier l'absence d'un helper équivalent**

Rechercher dans `packages/core/src/services/risk.service.ts` s'il existe déjà `isCopyTradingEnabled` ou `isAnyCopyTradingEnabled`. Si non, continuer.

**Step 2: Ajouter la méthode statique et instance**

```typescript
  /**
   * Live check of whether any copy-trading mode (sim or real) is enabled.
   * Used by the move detector to decide whether to poll watched addresses.
   */
  async isAnyCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isAnyCopyTradingEnabledForConfig(config);
  }

  /** Pure helper — true if sim OR real copy trading entries are enabled. */
  static isAnyCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.simCopyTradingEnabled || risk.realCopyTradingEnabled;
  }
```

Insérer juste après `isRealCopyTradingEnabledForConfig()` (après la ligne ~101).

**Step 3: Vérifier l'import de RiskConfig**

L'import est déjà présent en haut du fichier (`import { RiskConfig } from '../entities/RiskConfig.js';`).

**Step 4: Vérification type**

Run: `npx tsc --noEmit --project packages/core/tsconfig.json 2>&1 | grep "risk.service"`
Expected: no output.

**Step 5: Commit**

```bash
git add packages/core/src/services/risk.service.ts
git commit -m "feat(core): add isAnyCopyTradingEnabled helper"
```

---

## Task 2: Injecter RiskService dans MoveDetector

**Objective:** Permettre à `MoveDetector` de consulter l'état global du copy trading.

**Files:**
- Modify: `packages/copy-trading/src/processors/move-detector.ts`
- Modify: `packages/copy-trading/src/processors/move-detector.test.ts`
- Modify: `packages/copy-trading/src/index.ts`

### 2.1 Modifier le constructeur

**Step 1: Importer RiskService**

Dans `packages/copy-trading/src/processors/move-detector.ts`, ajouter `RiskService` aux imports `@polywatch/core` :

```typescript
import {
  MoveEventService,
  PollCycleService,
  resolveOutcomeLabel,
  RiskService,
  TraderSnapshot,
  WatchlistService,
} from '@polywatch/core';
```

**Step 2: Ajouter riskService au constructeur**

```typescript
  constructor(
    private readonly ds: DataSource,
    private readonly moveQueue: RedisQueue<MoveEventDto>,
    private readonly riskService: RiskService,
  ) {
    this.pollService = new PollCycleService(ds);
    this.moveEventService = new MoveEventService(ds);
    this.watchlistService = new WatchlistService(ds);
  }
```

### 2.2 Mettre à jour le test unitaire

**Step 3: Mocker RiskService**

Dans `packages/copy-trading/src/processors/move-detector.test.ts` :

```typescript
vi.mock('@polywatch/core', async () => {
  const actual = await vi.importActual('@polywatch/core');
  return {
    ...actual,
    RiskService: vi.fn().mockImplementation(() => ({
      isAnyCopyTradingEnabled: vi.fn().mockResolvedValue(true),
    })),
    PollCycleService: vi.fn().mockImplementation(() => ({
      runPollCycle: vi.fn().mockResolvedValue([]),
      reconcile: vi.fn().mockResolvedValue([]),
    })),
    MoveEventService: vi.fn().mockImplementation(() => ({
      loadUnprocessed: vi.fn().mockResolvedValue([]),
      loadProcessedWithStalePending: vi.fn(),
      resetProcessed: vi.fn().mockResolvedValue(undefined),
    })),
    WatchlistService: vi.fn().mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue([]),
    })),
  };
});
```

**Step 4: Instancier avec riskService**

```typescript
  beforeEach(() => {
    ds = {} as DataSource;
    moveQueue = { enqueue: vi.fn() } as unknown as RedisQueue<MoveEventDto>;
    const riskService = new RiskService(ds);
    detector = new MoveDetector(ds, moveQueue, riskService);
  });
```

### 2.3 Mettre à jour le call site principal

**Step 5: Modifier `packages/copy-trading/src/index.ts`**

`riskService` est déjà créé à la ligne 45. Remplacer :

```typescript
const moveDetector = new MoveDetector(ds, moveQueue);
```

par :

```typescript
const moveDetector = new MoveDetector(ds, moveQueue, riskService);
```

### 2.4 Vérification type

**Step 6: Compiler**

Run: `npx tsc --noEmit --project packages/copy-trading/tsconfig.json 2>&1 | grep -E "move-detector|index.ts"`
Expected: no output.

**Step 7: Commit**

```bash
git add packages/copy-trading/src/processors/move-detector.ts packages/copy-trading/src/processors/move-detector.test.ts packages/copy-trading/src/index.ts
git commit -m "feat(copy-trading): inject RiskService into MoveDetector"
```

---

## Task 3: Arrêter complètement la boucle quand le copy trading est désactivé

**Objective:** Couper le timer et ne plus interroger les adresses lorsque les deux modes sont désactivés.

**Files:**
- Modify: `packages/copy-trading/src/processors/move-detector.ts`

### 3.1 Modifier `runCycle()`

**Step 1: Lire le code actuel**

`packages/copy-trading/src/processors/move-detector.ts:210-249`.

**Step 2: Remplacer par la variante B**

```typescript
  private async runCycle(): Promise<void> {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);

    let enabled: boolean;
    try {
      enabled = await this.riskService.isAnyCopyTradingEnabled();
    } catch (err) {
      log.error({ err }, 'failed to read copy-trading enabled state — skipping cycle');
      enabled = false;
    }

    if (!enabled) {
      log.info('copy trading disabled — stopping surveillance loop');
      this.stopPolling();
      return;
    }

    const startedAt = performance.now();
    try {
      const { moves, traders, skipped } = await this.pollAll();
      this.cyclesCompleted++;
      log.info(
        { moves, traders: traders + skipped, cyclesCompleted: this.cyclesCompleted },
        'poll cycle complete',
      );
    } catch (err) {
      log.error({ err }, 'poll cycle failed');
    }

    if (this.stopped) return;

    const elapsed = performance.now() - startedAt;
    this.lastCycleLatencyMs = elapsed;
    const delay = Math.max(0, this.intervalMs - elapsed);

    if (elapsed > this.intervalMs) {
      log.warn(
        { elapsedMs: elapsed, delayMs: delay, intervalMs: this.intervalMs },
        'poll cycle exceeded target interval — cycle may lag',
      );
    }

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delay);
  }
```

> **Design decision:** La boucle s'arrête net (`stopPolling()`) dès que la config est désactivée. Le redémarrage est entièrement déclenché par le handler Redis `config-changed` dans `index.ts`. Si la config reste désactivée au démarrage du process, le premier cycle s'arrête immédiatement après le premier check.

### 3.2 Ajouter un test pour la coupure

**Step 3: Ajouter un test dans `move-detector.test.ts`**

```typescript
describe('runCycle copy-trading toggle', () => {
  it('stops polling when copy trading is disabled', async () => {
    const riskService = (detector as any).riskService;
    riskService.isAnyCopyTradingEnabled.mockResolvedValue(false);

    detector.startPolling();
    // Wait for the async cycle to complete.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(detector.isRunning()).toBe(false);
    expect((detector as any).stopped).toBe(true);
  });
});
```

Nécessite la méthode `isRunning()` ajoutée dans la task suivante.

### 3.4 Vérification build/test

**Step 4: Compiler**

Run: `npx tsc --noEmit --project packages/copy-trading/tsconfig.json 2>&1 | grep "move-detector"`
Expected: no output.

**Step 5: Tests**

Run: `npx vitest run packages/copy-trading/src/processors/move-detector.test.ts`
Expected: all tests pass.

**Step 6: Commit**

```bash
git add packages/copy-trading/src/processors/move-detector.ts packages/copy-trading/src/processors/move-detector.test.ts
git commit -m "feat(copy-trading): stop move detector polling when copy trading is disabled"
```

---

## Task 4: Exposer `isRunning()` et redémarrer sur `config-changed`

**Objective:** Permettre au handler Redis de relancer la surveillance quand l'utilisateur réactive le copy trading.

**Files:**
- Modify: `packages/copy-trading/src/processors/move-detector.ts`
- Modify: `packages/copy-trading/src/index.ts`

### 4.1 Ajouter `isRunning()`

**Step 1: Ajouter dans `MoveDetector`**

```typescript
  isRunning(): boolean {
    return !this.stopped && this.timer != null;
  }
```

Placer juste après `stopPolling()`.

### 4.2 Adapter le handler `config-changed`

**Step 2: Lire le code actuel**

`packages/copy-trading/src/index.ts:136-159`.

**Step 3: Remplacer le handler**

```typescript
  redisSub.on('message', (channel, message) => {
    if (shuttingDown) return;
    if (channel === 'config-changed') {
      log.info('config changed — reloading watchlist flags & risk config');
      void (async () => {
        WatchlistService.invalidateCache();
        RiskService.invalidateConfigCache();

        try {
          const riskConfig = await riskService.getConfig();
          moveDetector.setIntervalMs(riskConfig.moveDetectorIntervalMs);
        } catch (err) {
          log.warn({ err }, 'failed to reload move detector interval');
        }

        const copyTradingEnabled = await riskService.isAnyCopyTradingEnabled();
        if (copyTradingEnabled && !moveDetector.isRunning()) {
          log.info('copy trading re-enabled — restarting move detector polling');
          moveDetector.startPolling();
        }

        try {
          await syncPendingBookSubscriptions(connectionManager);
        } catch (err) {
          log.warn({ err }, 'pending book sync after config-changed failed');
        }
      })();
      return;
    }

    if (channel === SIMULATION_RESET_CHANNEL) {
      const payload = parseSimulationResetPayload(message);
      log.info(
        { sessionStartedAt: payload?.sessionStartedAt ?? null },
        'simulation-reset received — copy-trading continues polling',
      );
    }
  });
```

### 4.3 Vérifier le démarrage initial

**Step 4: Garder `moveDetector.startPolling()` au boot**

La ligne `moveDetector.startPolling();` à `packages/copy-trading/src/index.ts:111` reste inchangée. Même si le copy trading est désactivé au démarrage, le premier cycle va charger la config, constater l'état désactivé, logger `copy trading disabled — stopping surveillance loop` et s'arrêter. Le process reste vivant.

### 4.4 Build & tests

**Step 5: Compiler**

Run: `npx tsc --noEmit --project packages/copy-trading/tsconfig.json 2>&1 | grep "index.ts"`
Expected: no output.

**Step 6: Tests package copy-trading**

Run: `npm test --workspace=packages/copy-trading`
Expected: all tests pass.

**Step 7: Commit**

```bash
git add packages/copy-trading/src/processors/move-detector.ts packages/copy-trading/src/index.ts
git commit -m "feat(copy-trading): restart polling on config-changed when disabled"
```

---

## Task 5: (Optionnel mais recommandé) Éviter d'itérer la watchlist quand aucun trader n'est actif

**Objective:** Garantir qu'un appel direct à `pollAll()` ne fasse pas de travail inutile.

**Files:**
- Modify: `packages/copy-trading/src/processors/move-detector.ts`

### 5.1 Vérifier la garde existante

Dans `pollAll()` :

```typescript
    const traders = watchlist.filter(
      (e) => e.active || e.simEnabled || e.realEnabled,
    );
    const skipped = watchlist.length - traders.length;
    if (traders.length === 0) return { moves: 0, traders: 0, skipped };
```

Si cette garde existe déjà (elle est présente à la lecture initiale), cette task est purement une vérification.

### 5.2 Commit (si modification)

```bash
git add packages/copy-trading/src/processors/move-detector.ts
git commit -m "refactor(copy-trading): early return in pollAll when no active traders"
```

---

## Task 6: Mettre à jour la documentation

**Objective:** Documenter le nouveau comportement.

**Files:**
- Modify: `docs/code/05-copy-trading.md`
- Modify: `docs/frontend.md` si pertinent

### 6.1 Ajouter un paragraphe dans `docs/code/05-copy-trading.md`

```markdown
### Désactivation globale du copy trading (Variante B)

Le `MoveDetector` interrompt **complètement** sa boucle de surveillance lorsque `simCopyTradingEnabled` **et** `realCopyTradingEnabled` sont tous deux désactivés dans `RiskConfig` :

- Le timer interne est arrêté (`stopPolling()`).
- Aucune requête n'est envoyée à l'API Polymarket Data pour les adresses de la watchlist.
- Le process `copy-trading` reste actif et continue de consommer les événements déjà en file Redis.

Dès qu'un `config-changed` Redis est émis et que l'un des toggles `simCopyTradingEnabled` / `realCopyTradingEnabled` est réactivé, le handler Redis relance `moveDetector.startPolling()` et la surveillance reprend au prochain cycle.
```

### 6.2 Commit

```bash
git add docs/code/05-copy-trading.md docs/frontend.md
git commit -m "docs: document full move-detector stop on disabled copy trading"
```

---

## Task 7: Validation finale

**Objective:** S'assurer que l'intégration compile et que les tests passent.

**Step 1: Build complet**

Run: `npm run build`
Expected: success.

**Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

**Step 3: Tests ciblés**

Run: `npm test --workspace=packages/copy-trading`
Expected: success.

**Step 4: Vérifier la cohérence des appels**

Rechercher tous les appels à `new MoveDetector(...)` dans le repo.

```bash
grep -R "new MoveDetector" packages/
```

Expected: un seul résultat, dans `packages/copy-trading/src/index.ts`, avec 3 arguments.

**Step 5: Smoke test manuel (si un env local est disponible)**

1. Démarrer le backend + worker + copy-trading.
2. Désactiver "Copy trading" dans l'onglet Sim (ou Real) — ou les deux.
3. Observer le log `copy trading disabled — stopping surveillance loop`.
4. Vérifier qu'aucun log `poll cycle complete` n'apparaît ensuite.
5. Réactiver le copy trading.
6. Observer `copy trading re-enabled — restarting move detector polling` puis `poll cycle complete`.

---

## Risques et tradeoffs

### Risques
- **Messages déjà en file `MOVE_EVENTS`** : le consommateur continue de tourner. Les signaux d'entrée sont rejetés par `copy-risk-gate`. Les signaux de sortie (`CLOSED`/`DECREASED`) continuent d'être traités : c'est généralement souhaitable pour fermer les positions existantes, mais cela signifie aussi que la "surveillance" n'est pas totalement figée côté consommateur.
- **Sorties manquées pendant la pause** : si un trader ferme une position pendant l'arrêt du detector, le prochain poll après réactivation détectera le delta et émettra le mouvement. Il n'y a pas de perte de données tant que l'API Polymarket conserve l'historique de positions.
- **Appel `startPolling()` multiple** : si `config-changed` est publié plusieurs fois alors que le detector tourne déjà, `isRunning()` retourne `true` et empêche le double démarrage.

### Tradeoffs
- **Variante A vs B** : la variante A gardait un timer vide pour simplifier le redémarrage. La variante B coupe proprement le timer mais repose sur `config-changed` pour réveiller le detector. C'est plus économe en ressources et plus explicite.
- **Rechargement de la config à chaque cycle** : cela ajoute un `SELECT` sur `risk_config` à chaque intervalle. `RiskService.getConfig()` est mis en cache ; s'assurer que le cache est invalidé sur `config-changed` (déjà fait dans `copy-trading/index.ts`).

### Questions ouvertes
1. Faut-il aussi couper le consommateur Redis `MOVE_EVENTS` quand le copy trading est désactivé ? Réponse actuelle : non, car il faut drainer les messages et permettre les sorties éventuelles.
2. Faut-il couper `syncPendingBookSubscriptions` et la connexion WebSocket Polymarket pendant la pause ? Option future pour économiser encore plus de ressources réseau.
3. Le frontend doit-il afficher un statut "surveillance interrompue" ? Pertinent pour la clarté utilisateur.
