# Plan : Résoudre l'erreur `ECONNREFUSED` au démarrage du worker

**Date :** 2026-06-14  
**Auteur :** Assistant Polywatch  
**Statut :** ✅ **Implémenté et vérifié dans le code le 14/06/2026**

> Ce plan n'est plus une issue ouverte. Les modifications correspondantes sont présentes dans :
> - `packages/backend/src/index.ts` (publication `backend-ready`)
> - `packages/worker/src/index.ts` (attente du signal + refresh automatique)
> - `packages/worker/src/clob/backend-readiness.ts` (helper Redis)
> - `package.json` (retrait de `wait-on` pour `dev:worker`)
>
> Voir `audits/open-issues.md` section 10 pour le tableau de traçabilité.

---

## 1. Problème observé

Au démarrage de `npm run dev`, le worker tente de récupérer ses credentials CLOB via l'endpoint interne du backend :

```
GET http://localhost:3000/api/internal/clob-credentials
```

L'erreur suivante apparaît régulièrement :

```
TypeError: fetch failed: AggregateError [ECONNREFUSED]
  at fetchInternalClobCredentials (packages/worker/src/clob/credentials.ts:10)
  at buildTradingContext (packages/worker/src/clob/trading-context.ts:53)
  at loadTradingContext (packages/worker/src/clob/trading-context.ts:157)
  at main (packages/worker/src/index.ts:108)
```

Cela se produit car le worker est lancé en parallèle avec le backend. Même si `wait-on` vérifie `/health`, en mode dev (`tsx watch`) le backend peut redémarrer ou mettre du temps à écouter sur le port 3000. Le retry HTTP existant (30 tentatives × 1s) n'est pas toujours suffisant, notamment après un redémarrage à chaud.

---

## 2. Analyse de la situation actuelle

### 2.1 Architecture existante

- Le backend expose `/api/internal/clob-credentials` (route dans `packages/backend/src/routes/internal.ts`).
- Le worker appelle cette route depuis `packages/worker/src/clob/credentials.ts`.
- Le worker et le backend partagent déjà une instance Redis (`ioredis`).
- Le backend publie déjà des événements Redis (`config-changed`) quand la watchlist ou la config changent (`packages/backend/src/redis.ts`).
- Le worker s'abonne déjà à `config-changed` dans `packages/worker/src/index.ts`.

### 2.2 Redis est disponible

Vérification effectuée : `packages/backend/src/redis.ts` utilise `getRedis().publish('config-changed', ...)` depuis les routes `config.ts` et `watchlist.ts`. Redis est donc déjà opérationnel et fiable dans la stack.

### 2.3 Pourquoi ne pas lire directement dans la DB SQLite ?

Cette option a été écartée pour les raisons suivantes :

- Couplage fort avec le schéma du backend.
- Duplication de la logique métier (`evaluateLiveTradingReadiness`, résolution d'adresses, déchiffrement `signerPkEnc`).
- Risque d'aggraver les erreurs `database is locked` déjà observées sur SQLite.
- Perte du contrôle d'accès centralisé aux secrets.

La solution retenue est donc **d'utiliser Redis comme signal de readiness**, tout en gardant l'API interne comme source unique des credentials.

---

## 3. Solution proposée : Redis backend-ready probe

### 3.1 Principe

1. **Backend** : après avoir démarré et écouté sur son port HTTP, publie un message sur le canal Redis `backend-ready` avec un payload contenant un timestamp et le PID.
2. **Worker** : avant d'appeler l'API interne, s'abonne au canal `backend-ready` et attend le signal. Si le signal arrive, il appelle `/api/internal/clob-credentials`. Si le signal n'arrive pas dans le délai imparti, il tente l'appel en fallback puis échoue proprement.

### 3.2 Flux de démarrage

```
Backend startup
  → DB init
  → Routes / middleware
  → server.listen(port)
  → PUBLISH backend-ready { ready: true, at, pid }

Worker startup
  → DB init
  → Redis connections
  → SUBSCRIBE backend-ready
  → await waitForBackendReady(timeout)
  → fetchInternalClobCredentials()
  → buildTradingContext()
  → suite du worker
```

### 3.3 Gestion des redémarrages backend (mode dev)

Le worker écoute en permanence `backend-ready`. Si le backend redémarre (par exemple via `tsx watch`), il republie le signal. Le worker peut alors invalider son cache `TradingContext` et le recharger, puis reconnecter le canal utilisateur Polymarket.

---

## 4. Plan d'implémentation

### Phase 1 — Backend : publier `backend-ready`

**Fichiers :**
- `packages/backend/src/index.ts`
- `packages/backend/src/redis.ts` (vérifier l'import/export)

**Tâches :**
1. Importer `getRedis` dans `packages/backend/src/index.ts`.
2. Dans le callback de `server.listen`, publier :
   ```json
   { "ready": true, "at": 178145..., "pid": 12345 }
   ```
3. Ajouter un log structuré `backend_ready_published`.

### Phase 2 — Worker : attendre le signal Redis

**Fichiers :**
- `packages/worker/src/clob/backend-readiness.ts` (nouveau)
- `packages/worker/src/clob/credentials.ts`
- `packages/worker/src/index.ts`
- `packages/worker/src/constants.ts`
- `packages/worker/src/clob/trading-context.ts`

**Tâches :**
1. Créer `waitForBackendReady(redis, timeoutMs)` dans un nouveau fichier.
   - S'abonne au canal `backend-ready`.
   - Résout dès réception du signal.
   - Timeout configuré via `BACKEND_READY_TIMEOUT_MS` (défaut 60 000 ms).
2. Ajouter `BACKEND_READY_TIMEOUT_MS` dans `packages/worker/src/constants.ts`.
3. Dans `packages/worker/src/index.ts`, avant `loadTradingContext()`, appeler `waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS)`.
4. Adapter `fetchInternalClobCredentials` pour que son retry ne s'enclenche qu'après le signal backend-ready.
5. Dans l'écouteur `redisSub.on('message')`, ajouter le canal `backend-ready` pour invalider le cache et recharger le contexte (avec debounce de 5s).

### Phase 3 — Simplification du script de dev

**Fichier :**
- `package.json`

**Tâche :**
- Supprimer le `wait-on` HTTP du script `dev:worker`. Le worker gère lui-même l'attente via Redis.
- Conserver `wait-on` pour `dev:frontend` (proxy Vite).

### Phase 4 — Tests et validation

1. Relancer `npm run dev` et vérifier qu'aucun `ECONNREFUSED` n'apparaît.
2. Vérifier dans les logs la séquence :
   - `[backend] backend_ready_published`
   - `[worker] backend ready signal received`
   - `[worker] clob approvals ensured`
   - `[worker] Polywatch worker started`
3. Tester un redémarrage backend (`tsx watch`) et vérifier que le worker recharge le contexte.

---

## 5. Fichiers impactés

| Fichier | Changement |
|---|---|
| `packages/backend/src/index.ts` | Publier `backend-ready` après `server.listen` |
| `packages/worker/src/clob/backend-readiness.ts` | Nouveau helper d'attente Redis |
| `packages/worker/src/clob/credentials.ts` | Retry conditionné par le signal Redis |
| `packages/worker/src/index.ts` | Appel de `waitForBackendReady` avant `loadTradingContext`, réaction au signal |
| `packages/worker/src/constants.ts` | Ajout de `BACKEND_READY_TIMEOUT_MS` |
| `packages/worker/src/clob/trading-context.ts` | Invalider/récharger au signal `backend-ready` |
| `package.json` | Retirer `wait-on` du script `dev:worker` |

---

## 6. Risques et mitigations

| Risque | Mitigation |
|---|---|
| Redis non démarré au startup du worker | Laisser un fallback vers le retry HTTP existant. Le worker échoue proprement si vraiment rien n'est disponible. |
| Signal `backend-ready` perdu | Ajouter une clé volatile `backend-ready` (SET TTL 60s) publiée par le backend, vérifiée par le worker avant l'abonnement. |
| Reconnexions en boucle en dev | Debounce 5s sur le traitement du signal `backend-ready` côté worker. |
| Couplage temporel backend/worker | Le signal est un événement explicite, pas une attente aveugle ; l'API interne reste la source unique des secrets. |

---

## 7. Conclusion

L'utilisation d'un canal Redis `backend-ready` permet de supprimer la dépendance fragile au démarrage HTTP du backend, sans introduire d'accès direct à la base SQLite. Cette approche s'appuie sur l'infrastructure Redis déjà en place, reste cohérente avec le mécanisme existant `config-changed`, et améliore la robustesse du démarrage en dev comme en production.
