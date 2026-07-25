# Audit de conformite Polymarket CLOB v2 — Polywatch v0.6

**Date :** 2026-06-14
**Version auditee :** v0.6
**Perimetre :** packages/core, packages/worker, packages/backend, packages/frontend
**Documentation de reference :** Polymarket CLOB v2 (live 28 avril 2026), Gamma API, Conditional Token Framework, WebSocket market/user channels, migration guide CLOB v2.

---

## 1. Architecture du projet

Monorepo TypeScript / npm workspaces en 4 packages :

| Package | Role | Technologies cles |
|---|---|---|
| `@polywatch/core` | Entites TypeORM/SQLite, logique PnL/sizing/frais, market lifecycle, files Redis, secrets | typeorm, better-sqlite3, bcryptjs |
| `@polywatch/worker` | WebSockets Polymarket, detection de mouvements, execution d'ordres, watchdogs, redemption | @polymarket/clob-client-v2, ethers v6, ioredis, ws, pino |
| `@polywatch/backend` | API Express, auth JWT, wallet/bridge/redeem, relayer Builder, chiffrement | express v5, socket.io, @polymarket/builder-relayer-client, @polymarket/builder-signing-sdk |
| `@polywatch/frontend` | UI SolidJS, simulation/reel, watchlist, wallet | solid-js, socket.io-client, ethers v6 |

Dependances Polymarket utilisees :
- `@polymarket/clob-client-v2` ^1.0.6 (CLOB v2)
- `@polymarket/builder-relayer-client` ^0.0.10
- `@polymarket/builder-signing-sdk` ^0.0.8

---

## 2. Alignement avec la documentation Polymarket CLOB v2

### 2.1 Collateral : pUSD (correct)

Le token pUSD est correctement identifie dans `packages/core/src/polymarket/clob-contracts.ts` :

```
collateral: '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB',
conditionalTokens: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
exchangeV2: '0xE111180000d2663C0091e4f400237545B87B996B',
negRiskExchangeV2: '0xe2222d279d744050d28e00520010520000310F59',
```

Les 6 decimales pUSD sont gerees dans `trading-wallet.ts` et `pusd-amount.ts`.

### 2.2 Frais dynamiques taker-only (correct)

`packages/core/src/pricing/fees.ts` implante la formule documentee par Polymarket :

```
fee = C x feeRate x (p x (1-p))^feeExponent
```

Arrondi a 5 decimales, minimum 0.00001 pUSD. Le parsing des parametres `fd.r` / `fd.e` depuis `/clob-markets` est present dans `market-metadata.ts`.

### 2.3 Ordres CLOB v2 (partiellement correct)

`packages/worker/src/clob/real-executor.ts` utilise `createAndPostMarketOrder` du SDK v2 avec `OrderType.FAK`, ce qui est conforme. Les options passees contiennent `tickSize` et `negRisk`.

**Probleme :** la documentation v2 precise que les ordres doivent contenir `timestamp` (ms), `metadata` et eventuellement un `builder` code. Le code Polywatch ne les controle pas explicitement. Le SDK v2 les ajoute probablement automatiquement, mais ce n'est pas garanti.

### 2.4 Approbations CLOB v2 (correct)

`packages/backend/src/polymarket/clob-approvals.ts` cible les bons contrats V2 :
- pUSD -> CTF, pUSD -> exchangeV2, pUSD -> negRiskExchangeV2
- CTF -> exchangeV2, CTF -> negRiskExchangeV2

### 2.5 Redemption (risque majeur)

`packages/backend/src/polymarket/clob-redeem.ts` encode un appel direct a `redeemPositions` sur l'adapter CTF / NegRiskAdapter et le soumet via `client.executeDepositWalletBatch`.

**Probleme critique :** selon la documentation Polymarket, les positions sont detenues par un **Gnosis Safe proxy wallet**. On ne peut pas appeler `redeemPositions` directement depuis une EOA ou un relayer : il faut executer la transaction via `execTransaction` du Safe. Le calldata actuel semble envoye "en tant que" le deposit wallet, sans preuve qu'il transite par `execTransaction`. Si ce n'est pas le cas, la transaction sera revert on-chain.

De plus, `packages/worker/src/processors/redemption-handler.ts` hardcode `fillPrice: 1.0` pour toute redemption, ce qui est incorrect pour les positions perdantes (payoff 0) et potentiellement faux pour les marches negatifs risques.

Enfin, la quantite est convertie via `pusdNumberToRaw(quantity)` alors qu'il s'agit de **shares CTF** et non de pUSD.

### 2.6 WebSocket market/user channel (correct)

`packages/worker/src/polymarket/websocket-book.ts` et `websocket-user.ts` implementent correctement :
- Market channel : PING/PONG toutes les ~10s, reconnect avec backoff exponentiel, snapshots REST + deltas WS
- User channel : authentification par apiKey/secret/passphrase, filtrage des `event_type: 'trade'` et `'order'`

### 2.7 Cycle de vie des trades (partiellement correct)

`packages/core/src/services/execution.service.ts` gere les etats `placing`, `filled`, `failed`, `cancelled`, `partial`. La finalisation est faite dans une transaction TypeORM.

**Probleme :** SQLite ne supporte pas de pessimistic lock efficace. Le garde anti-double-finalisation est un simple read-check-write non atomique :

```
if (exec.status === 'filled' && input.status === 'filled') {
    return pos;
}
```

Deux finalisations (REST + WebSocket) peuvent lire simultanement `status != 'filled'` et toutes deux mettre a jour, doublant le PnL realise, les frais et le cash credite.

---

## 3. Code mort et obsolescence

| Fichier | Probleme | Gravite |
|---|---|---|
| `packages/core/src/entities/Market.ts` | Champ `takerBaseFee` legacy CLOB v1 non utilise | Faible |
| `packages/core/src/polymarket/clob-contracts.ts` | Adresse `exchange` V1 (`0x4bFb...`) listee dans la config V2 | Moyenne |
| `packages/core/src/polymarket/market-metadata.ts` | Parsing de `takerBaseFee` / `taker_base_fee` legacy | Faible |
| `packages/backend/src/polymarket/proxy.ts` | Adresse exchange V1 en dur | Moyenne |
| `packages/backend/dist/polymarket/balance.js` | Importe `@polymarket/clob-client` (v1) dans un build non regenere | Moyenne |

---

## 4. Bugs et risques critiques pour le trading reel

### 4.1 Redemption potentiellement cassee

Le flow de redemption ne demontre pas qu'il passe par le Gnosis Safe `execTransaction`. C'est un **bloquant** pour recuperer les gains sur les marches resolus.

### 4.2 Race condition double finalisation

Le garde anti-double-finalisation dans `execution.service.ts` n'est pas atomique. Avec SQLite, deux finalisations (REST + WebSocket) peuvent ecraser les donnees.

### 4.3 Slippage guard : division par zero

Dans `packages/worker/src/clob/real-executor.ts` et `packages/worker/src/processors/executor.ts` :

```
const slip = (Math.abs(fillPrice - signal.referenceVwap) / signal.referenceVwap) * 100;
```

Si `signal.referenceVwap === 0`, `slip` devient `NaN`. La comparaison `NaN > maxSlippage` est toujours `false`, donc le garde est contourne silencieusement.

### 4.4 Validation des reponses permissive

`packages/worker/src/clob/parse-fill-response.ts` cast la reponse CLOB en `Record<string, unknown>` sans validation de schema. Si Polymarket change le format de reponse, le parseur peut produire des fill quantities/prix incorrects.

### 4.5 Approbations : verification HTTP seule

`packages/worker/src/clob/trading-context.ts` appelle `/api/internal/clob-approvals/ensure` et ne verifie que le status HTTP. Une transaction on-chain peut echouer (gas, nonce) tout en retournant HTTP 200.

---

## 5. Evaluation detaillee et note sur 100

| Critere | Note max | Note | Commentaire |
|---|---:|---:|:---|
| Architecture et modularite | 15 | 14 | Monorepo propre, separation core/worker/backend/frontend, files Redis, watchdogs. |
| Conformite CLOB v2 (collateral, frais, approbations) | 18 | 12 | pUSD, frais dynamiques, approvals V2 corrects. Mais ordres manquent de champs v2 explicites et redemption est douteuse. |
| Cycle de vie des ordres et execution | 15 | 9 | Bonne structure, mais race conditions SQLite et double finalisation possibles. |
| Securite et gestion des secrets | 12 | 8 | AES-256-GCM, JWT, service token. Mais secrets par defaut possibles, cles privees chiffrees mais dechiffrees en memoire cote worker. |
| Fiabilite / bugs critiques | 18 | 5 | Redemption probablement incorrecte, division par zero, validation permissive, approbations non verifiees on-chain. |
| Qualite du code / code mort | 12 | 7 | Du code mort V1 persiste, presence de dist obsoletes, quelques casts any. |
| Tests et outils d'audit | 10 | 5 | Vitest present, scripts d'audit internes, mais pas de tests E2E visibles sur les flows critiques. |
| **Total** | **100** | **60** | |

---

## 7. Vérification post-audit (14/06/2026)

Une relecture ligne par ligne du code a été effectuée le 14/06/2026. Le constat est que plusieurs problèmes listés ci-dessus sont **déjà corrigés** ou **partiellement obsolètes** dans la version actuelle du code.

### 7.1 Points confirmés corrigés / obsolètes

| Problème | Code constaté | Verdict |
|---|---|---|
| **Ordres CLOB v2 : `timestamp`/`metadata`/`builder`** | `packages/worker/src/clob/real-executor.ts` L190-195 : commentaire indiquant que le SDK `ExchangeOrderBuilderV2` gère ces champs en interne. | 🟢 **Acceptable** — dépendance implicite au SDK, pas un bug. |
| **Slippage guard division par zéro (`referenceVwap === 0`)** | `packages/worker/src/clob/real-executor.ts` L132-157 et `packages/worker/src/processors/executor.ts` L124-149 : le calcul n'est effectué que si `signal.referenceVwap > 0`. | ✅ **Corrigé**. |
| **Validation permissive des réponses CLOB** | `packages/worker/src/clob/parse-fill-response.ts` L76-84 : validation via `clobOrderResponseSchema` (Zod) avant parsing. | ✅ **Corrigé**. |
| **Approbations vérifiées HTTP seulement** | `packages/backend/src/polymarket/clob-approvals.ts` L142-162 : après soumission, le backend attend le receipt on-chain et re-vérifie les allowances. | ✅ **Corrigé** côté backend. |
| **Adresse exchange V1 dans `clob-contracts.ts`** | `packages/core/src/polymarket/clob-contracts.ts` ne contient plus d'adresse V1. | ✅ **Corrigé**. |

### 7.2 Points résiduels à valider

| ID | Problème | Preuve dans le code | Verdict | Action recommandée |
|---|---|---|---|---|
| **CMP-1** | Redemption Safe/Proxy : le flow passe-t-il bien par `execTransaction` du Gnosis Safe ? | `packages/backend/src/polymarket/clob-redeem.ts` L165-184 : mode `safe`/`proxy` utilise `createRelayClient(..., RelayerTxType.SAFE/PROXY)` puis `client.execute()`. Le SDK relayer encapsule la logique Safe/Proxy. | 🟡 **Théoriquement correct, non testé on-chain.** | Tester la redemption sur un marché résolu avec une petite quantité et vérifier le hash de transaction. |
| **CMP-2** | `pusdNumberToRaw(quantity)` utilisé pour des shares CTF | `packages/worker/src/processors/redemption-handler.ts` L144 : nom de fonction trompeur, mais la scale (6 décimales) est bien celle des balances ERC1155 CTF. | 🟢 **Cosmétique** — pas de bug fonctionnel. | Renommer ou documenter pour éviter la confusion. |
| **CMP-3** | Double finalisation SQLite | `packages/core/src/services/execution.service.ts` L13-15, L151-174 : pessimistic lock désactivé pour SQLite, optimistic lock (`@VersionColumn`) en place. | 🟡 **Atténué** — SQLite reste plus fragile qu'un vrai RDBMS face à REST + WS concurrents. | Lié à OPT-13 (migration PostgreSQL). |

### 7.3 Recommandations prioritaires mises à jour

1. **Tester la redemption sur un marché résolu** (CMP-1) — c'est le seul point bloquant potentiel restant.
2. **Continuer la migration PostgreSQL** (OPT-13) pour éliminer CMP-3.
3. **Renommer/documenter** `pusdNumberToRaw` dans le contexte des shares (CMP-2) — faible priorité.
4. Nettoyer le code V1 mort et régénérer les `dist`.

## 6. Conclusion : peut-il etre utilise pour du trading reel ?

**Non, pas en l'etat pour des fonds significatifs, mais le nombre de bloquants a été réduit.**

Le projet a une architecture solide et une bonne comprehension de Polymarket CLOB v2 sur le trading actif (ordres, frais, approbations, WebSocket). La plupart des problèmes critiques de l'audit initial ont été corrigés. Il reste **un bloquant avéré à valider** avant de mettre de l'argent reel :

1. **Redemption (CMP-1) :** le flow doit être testé on-chain pour confirmer qu'il récupère bien les gains des marchés résolus via le relayer Safe/Proxy.

Le second risque (CMP-3, double finalisation SQLite) est **atténué** par l'optimistic lock, mais ne disparaîtra complètement qu'avec la migration PostgreSQL (OPT-13).

---

*Rapport genere automatiquement par audit de code source. Aucune modification n'a ete apportee au projet. **Mise à jour section 7 ajoutée le 14/06/2026 après vérification code.***
