# Plan — Correctifs stratégie crypto-algo : garde spread mono-token, repli Gamma bloquant, mélange de tokens WS

**Date** : 2026-07-09
**Dernière mise à jour** : 2026-07-09
**Version cible** : v1.1
**Statut** : Implémenté
**Tags** : `crypto-algo`, `naive-momentum`, `price-feed`, `strategy-runner`, `spread`, `gamma`
**Références** :
- Audit BDD marché XRP 5m `0x906dcb…8fc77` (« XRP Up or Down - July 9, 10:15AM-10:20AM ET », fenêtre 16:15 → 16:20 UTC+2)
- Plan complémentaire : `2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md`

---

## 1. Contexte — cas de référence XRP 5m

Marché suivi de bout en bout par l'algo (sélection `algo_market_selections#7691` active pendant toute la fenêtre, 287 ticks `algo_price_ticks` avec `ws_healthy = true`), marché tradable (`accepting_orders = t`), config active (`crypto_algo_enabled = t`, stratégie `naive-momentum`). Le prix Up passe de ~0.51 à ~0.32 en 12 s puis s'effondre vers 0 ; Down reste liquide (spread 1–1.8 %) toute la fenêtre.

Résultat : **0 signal émis** (aucun tick avec `last_signal_outcome`), 0 réservation, 0 position. Le blocage est entièrement dans la couche stratégie — le pipeline d'entrée n'a jamais été invoqué.

Trois bugs se relaient pour neutraliser toute entrée :

| # | Bug | Effet sur le cas XRP |
|---|-----|----------------------|
| A1 | Garde spread évaluée uniquement sur le token Up | Dès 16:16, spread Up 15→75 % (token quasi sans valeur) > max 10 % pour 5m → abstention systématique, alors que Down (le token à acheter) était liquide |
| A2 | Repli Gamma sur déviation WS/Gamma > 0.05 | Première minute : mid WS 0.17–0.36 (signal NO valide) mais Gamma stale ~0.5 → déviation > 0.05 → repli sur 0.5 → zone neutre → abstention |
| A3 | Le top-of-book forwardé aux évaluations WS est celui du token qui a bougé (possiblement Down) | ~50 % des évaluations comparaient le mid **Down** (~0.68–0.92) au prix YES Gamma : déviation aberrante, garde spread sur le mauvais token |

---

## 2. Bug A1 — Garde spread évaluée sur le mauvais token

### 2.1 Diagnostic

- `NaiveMomentumStrategy.evaluate` (`packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`, lignes 148–156) : la garde `spreadPercent > maxSpread` et l'ajustement de seuil `calculateThreshold` utilisent `ctx.topOfBook`, unique et implicitement YES/Up.
- `CryptoAlgoPriceFeed.getTopOfBookForCondition` (`packages/crypto-algo/src/price-feed.ts`) ne lit que `tokenIdYes`.
- Conséquence structurelle : sur un marché qui a déjà basculé fort vers Down, le spread **en pourcentage** du token Up explose mécaniquement (1 ¢ d'écart sur un ask à 0.02 = 50 %) → l'algo ne peut structurellement jamais acheter Down après le mouvement.

### 2.2 Correctif

1. **`StrategyContext` à deux carnets** (`packages/crypto-algo/src/strategy/strategy.ts`) :
   - Remplacer `topOfBook?: TopOfBookData` par `books?: { up: TopOfBookData | null; down: TopOfBookData | null }`.
   - Enrichir `TopOfBookData` : `assetId: string` et `updatedAt: number` (epoch ms) — nécessaires ici et posent la base du plan complémentaire (fraîcheur).
2. **Alimentation** : les deux chemins d'évaluation construisent `ctx.books` via `priceFeed.getOutcomeBooks(conditionId)` (méthode existante, déjà utilisée par le tick recorder).
3. **Stratégie** (`naive-momentum.strategy.ts`) :
   - Déterminer d'abord la direction candidate à partir du prix (YES si `price > threshold`, NO si `price < 1 - threshold`).
   - Appliquer la garde spread et l'ajustement de seuil sur **le carnet du token que le signal achèterait** (`books.up` pour YES, `books.down` pour NO).
   - Si le carnet du token cible est absent → comportement conservateur actuel (garde non appliquée, prix Gamma seul), sans blocage par le carnet de l'autre token.

### 2.3 Point d'attention

L'ajustement de seuil dépend désormais de la direction → l'ordre de calcul change : prix → direction candidate → seuil ajusté par le spread du token cible → confirmation. Pour éviter une oscillation aux bornes (prix proche du seuil, spreads très différents entre Up et Down), la confirmation utilise le seuil ajusté de la direction candidate uniquement ; si le prix ne confirme plus après ajustement → abstention (pas de bascule vers l'autre direction dans la même évaluation).

---

## 3. Bug A2 — Repli Gamma qui neutralise le prix WebSocket frais

### 3.1 Diagnostic

`selectPrice` (`naive-momentum.strategy.ts`, lignes 197–216) rejette le mid WS dès que `|wsMid - gammaYes| ≥ 0.05` et retombe sur le prix Gamma. Or Gamma traîne près de 0.5 sur les marchés 5m (constaté en live : `yesPrice: 0.525` avec `spreadPercent: 50` dans le runtime-status pendant l'audit). Plus le marché bouge (précisément quand un signal momentum devrait exister), plus la déviation est grande, plus l'évaluation est épinglée sur le prix stale → zone neutre → abstention. Le garde-fou inverse la hiérarchie de fiabilité des sources.

### 3.2 Correctif

1. **WS = source primaire** : si le carnet du token YES est présent, bilatéral (`bid > 0` et `ask > 0`) et frais (`updatedAt` ≤ `MAX_BOOK_AGE_MS`, défaut 15 000 ms), utiliser le mid WS. Pas de comparaison bloquante avec Gamma.
2. **Gamma = fallback** : utilisé uniquement quand le carnet WS est absent, unilatéral ou périmé.
3. **Log de santé** : conserver un `log.warn` quand `|wsMid - gammaYes| ≥ 0.05` (diagnostic de retard Gamma), sans effet sur la décision. Supprimer le paramètre de config `maxPriceDeviation` devenu inutilisé (ou le conserver uniquement pour le seuil du warn).
4. **Validations par chemin** :
   - Chemin Gamma : garder `validateOutcomePrices` (somme YES+NO ≈ 1.0).
   - Chemin WS : valider `bid ≤ ask` et bornes [0, 1] ; la validation de somme Gamma ne doit pas bloquer un signal pris sur prix WS (Gamma stale peut échouer la validation alors que le carnet est sain). Déplacer l'appel `validateOutcomePrices` après la sélection de source, appliqué seulement si la source est Gamma.

---

## 4. Bug A3 — Mélange de tokens dans les évaluations WS-déclenchées

### 4.1 Diagnostic

Chaîne : `connectionManager.setOnBookUpdate(assetId)` → `priceFeed.dispatchBookUpdate(assetId)` → `handleBookUpdate` construit le top-of-book **de cet asset** (Up ou Down) → `triggerEvaluation(conditionId, assetId, topOfBook)` → `StrategyRunner.handlePriceUpdate` → `evaluateSelection(selection, topOfBook)` → la stratégie traite `ctx.topOfBook.midPrice` comme le mid **YES**.

Quand l'update vient du token Down : mid ~0.7–0.9 interprété comme prix YES, déviation Gamma aberrante (repli A2), garde spread évaluée sur le mauvais carnet. Environ une évaluation WS sur deux est corrompue.

### 4.2 Correctif

1. `PriceFeed.triggerEvaluation` / `PriceUpdateCallback` : l'update WS devient un **déclencheur pur** — le callback ne transporte plus le carnet brut (signature réduite à `(conditionId, assetId)` ; l'assetId reste utile pour les logs).
2. `StrategyRunner.handlePriceUpdate` : re-résout les deux carnets par `priceFeed.getOutcomeBooks(conditionId)` et construit `ctx.books` (même chemin que A1).
3. `StrategyRunner.tick()` (polling) : construit `ctx.books` par le même appel → un seul format de contexte pour les deux chemins, plus de divergence WS/polling.
4. Le debounce 5 s par condition (`price-feed.ts`) est conservé tel quel — il porte déjà sur `conditionId`, pas sur l'asset.

---

## 5. Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `packages/crypto-algo/src/strategy/strategy.ts` | `TopOfBookData` +`assetId`/`updatedAt` ; `StrategyContext.books` remplace `topOfBook` |
| `packages/crypto-algo/src/price-feed.ts` | `getOutcomeBooks` expose `updatedAt`/`assetId` ; `PriceUpdateCallback` sans carnet brut |
| `packages/crypto-algo/src/strategy/strategy-runner.ts` | `handlePriceUpdate` + `tick()` construisent `ctx.books` via `getOutcomeBooks` |
| `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts` | Direction candidate d'abord ; garde spread + seuil sur le token cible ; WS primaire, Gamma fallback ; validations par chemin |
| `packages/crypto-algo/src/strategy/constants.ts` | Inchangé (les plafonds par intervalle restent ; leur unité évolue dans le plan complémentaire B5) |

Consommateurs de `StrategyContext` à vérifier lors de l'implémentation : implémentations de stratégies et leurs tests (seule `naive-momentum` existe à ce jour).

---

## 6. Tests

### 6.1 Unitaires stratégie (`naive-momentum.strategy.test.ts`)

| Cas | Attendu |
|-----|---------|
| Up effondré (mid 0.02, spread 50 %), Down liquide (mid 0.98, spread 1 %), Gamma à jour | Signal NO émis — la garde spread s'applique au carnet Down |
| Gamma stale 0.5, carnet Up frais mid 0.30, spread 3 % | Signal NO émis — prix WS prioritaire malgré déviation 0.20 |
| Carnet WS périmé (updatedAt > 15 s), Gamma 0.30 | Signal NO émis via Gamma (fallback) |
| Carnet WS absent, Gamma 0.5 | Abstention (zone neutre) — comportement inchangé |
| Prix en zone neutre après ajustement de seuil du token cible | Abstention, pas de bascule de direction |
| Somme Gamma invalide mais source = WS frais | Signal émis (validation somme non bloquante sur chemin WS) |

### 6.2 Runner (`strategy-runner`)

- Update WS provenant du token **Down** → le contexte transmis à la stratégie contient `books.up` et `books.down` corrects (pas le carnet Down en position YES).
- Chemins WS et polling produisent un contexte identique pour un même état de carnet.

### 6.3 Non-régression — rejeu XRP

Test alimenté par les valeurs réelles des ticks BDD du cas de référence (16:15:12 → 16:19:59) : avec Gamma simulé stale à 0.5, la stratégie corrigée doit émettre un signal NO dans la première minute (mid Up ~0.32, spreads Up ~3 % et Down ~1.7 %), là où la version actuelle s'abstient sur toute la fenêtre.

---

## 7. Hors périmètre

- Fraîcheur systématique des carnets, carnets unilatéraux, observabilité des abstentions, unité de mesure du spread, TTL Gamma : plan complémentaire `2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md`.
- Design de la stratégie (niveau vs vrai momentum) : idem, section B7 du plan complémentaire.

---

## 8. Implémentation réalisée (2026-07-09)

| Bug | Statut | Changements |
|-----|--------|-------------|
| A1 | ✅ | `StrategyContext.books { up, down }` ; garde spread + seuil sur token cible |
| A2 | ✅ | WS primaire si frais/bilatéral ; Gamma fallback ; warn non bloquant |
| A3 | ✅ | WS = déclencheur seul ; `getOutcomeBooks` dans runner (WS + polling) |

**Fichiers** : `strategy.ts`, `price-feed.ts`, `strategy-runner.ts`, `naive-momentum.strategy.ts`, `naive-momentum.strategy.test.ts`.

**Tests** : 18+ cas unitaires stratégie ; rejeu scénarios XRP (Up effondré / Down liquide, Gamma stale, token mixup).

**Suite** : Plan B (`2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md`) puis tunables UI (`2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md`).
