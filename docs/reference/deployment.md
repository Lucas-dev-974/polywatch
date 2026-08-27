# Déploiement Production

Ce document décrit les étapes de déploiement en production et les vérifications pré-trading réel.

## 1. Prérequis Infrastructure

### 1.1 Secrets (Obligatoire)

Avant d'activer le trading réel, générer des secrets uniques :

```bash
npm run generate-secrets
```

Copier les valeurs dans `.env` :

```env
JWT_SECRET=<généré>
JWT_REFRESH_SECRET=<généré>
SERVICE_TOKEN=<généré>
MASTER_ENCRYPTION_KEY=<généré>
```

⚠️ **Ne jamais utiliser les valeurs par défaut en production** — le trading réel sera bloqué.

### 1.2 Credentials CLOB Polymarket

Le trading réel nécessite des credentials CLOB valides :

1. Créer un wallet sur Polymarket
2. Générer les credentials L1/L2 via l'API Polymarket
3. Stocker les credentials dans la table `clob_credentials` (chiffrés avec `MASTER_ENCRYPTION_KEY`)

### 1.3 Approvals Deposit Wallet

Avant le premier ordre réel, vérifier les approvals on-chain :

```sql
-- Vérifier les approvals pour le deposit wallet
SELECT * FROM wallet_accounts WHERE mode = 'real';
```

Les 5 approvals nécessaires :
- pUSD → CTF Exchange
- pUSD → Exchange V2
- pUSD → NegRisk Exchange V2
- CTF → Exchange V2
- CTF → NegRisk Exchange V2

Vérifier et poser les approvals via
`POST /api/internal/clob-approvals/ensure` (auth `x-service-token`, appelé
aussi par le worker au chargement du contexte CLOB). Il n'existe **pas** de
route publique `/api/wallet/approvals`. L'aperçu portefeuille reste
`GET /api/wallet`.

---

## 2. Configuration Docker

### 2.1 Isolation Réseau

Par défaut, `docker-compose.yml` expose :
- Backend : port 3000 (bind `0.0.0.0`)
- PostgreSQL : port 5432 (bind `127.0.0.1`)
- Redis : port 6379 (bind `127.0.0.1`)
- Services sans port hôte : `worker`, `copy-trading`, `crypto-algo`, `frontend` (5173:80).

> ⚠️ **Note** : `weather-algo` n'est **pas** conteneurisé dans `docker-compose.yml`
> (lancé via `npm run dev:weather-algo` hors Docker en v1). Le diagramme monorepo
> d'`01-architecture.md` liste `weather-algo` comme package mais pas comme service Docker.

Pour la production, restreindre l'exposition :

```yaml
# docker-compose.prod.yml
services:
  backend:
    ports:
      - "127.0.0.1:3000:3000"  # Loopback uniquement
```

### 2.2 TLS / HTTPS

Le backend expose du HTTP plain text. Pour la production :

**Option A — Reverse Proxy (Recommandé)**

Utiliser nginx ou Traefik avec TLS termination :

```nginx
# nginx.conf
server {
    listen 443 ssl http2;
    server_name polywatch.example.com;

    ssl_certificate /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    location / {
        proxy_pass http://backend:3000;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Option B — mTLS Interne**

Pour une isolation maximale, configurer mTLS entre worker et backend (non requis si Docker network isolé).

---

## 3. Dry-Run Trading Réel

Avant d'activer le trading réel, exécuter le dry-run pour valider la stack :

### 3.1 Vérifications Automatiques

```bash
# Via npm script
npm run dry-run:real
```

Ce script vérifie :
1. ✅ Secrets non-défaut
2. ✅ Credentials CLOB présents et valides
3. ✅ Approvals on-chain complets
4. ✅ Connexion WebSocket user channel
5. ✅ Petit ordre FAK (annulé immédiatement)

### 3.2 Vérifications Manuelles

| Check | Commande |
|-------|----------|
| Secrets non-défaut | `grep -E "change-me|0123456789abcdef" .env` (vide = OK) |
| Credentials CLOB | `SELECT COUNT(*) FROM clob_credentials;` (> 0) |
| Approvals | `POST /api/internal/clob-approvals/ensure` (service token) — 5 approvals on-chain |
| WebSocket user | Logs : `WebSocket user channel connected` |
| Mode réel | `SELECT real_trading_enabled FROM global_config;` (`false` par défaut) |

---

## 4. Activation Trading Réel

### 4.1 Séquence d'activation

1. **Vérifier les secrets** (cf. §1.1)
2. **Configurer les credentials CLOB** (cf. §1.2)
3. **Approuver les contrats** (cf. §1.3)
4. **Exécuter le dry-run** (cf. §3)
5. **Activer le mode réel** :

```sql
UPDATE global_config SET real_trading_enabled = true;
```

Ou via l'API : `PUT /api/config/global` avec `{ "realTradingEnabled": true }`.

6. **Appliquer les migrations** (si non déjà fait au démarrage) :

```bash
npm run migrate
```

7. **Démarrer copy-trading + worker** :

```bash
npm run dev:copy-trading   # détection → order-signals
npm run dev:worker         # exécution CLOB + sorties risque
```

### 4.2 Vérification logs

Logs à surveiller au démarrage :

```
[copy-trading] Polywatch copy-trading started
[copy-trading] WebSocket order books connected
[worker] WebSocket user channel connected
[worker] real trading enabled — credentials validated
```

### 4.3 Premier ordre réel

Pour le premier ordre, utiliser un montant minimal :

```sql
UPDATE copy_config SET real_entry_usdc_amount = 5;  -- $5 USD
```

Ou `PUT /api/config/copy` avec `{ "realEntryUsdcAmount": 5 }`.

---

## 5. Checklist Pré-Production

- [ ] Secrets uniques générés et configurés
- [ ] Credentials CLOB valides dans la DB
- [ ] Approvals on-chain complets (5 approvals)
- [ ] Dry-run passé avec succès
- [ ] `real_trading_enabled = false` (activé manuellement après vérifications)
- [ ] Montant minimal pour premier test
- [ ] Logs worker surveillés
- [ ] Reverse proxy TLS configuré (si exposé)

---

## 6. Rollback

En cas de problème :

```bash
# Désactiver le trading réel en base
psql "$DATABASE_URL" -c "UPDATE global_config SET real_trading_enabled = false;"

# Redémarrer les services
docker restart polywatch-worker polywatch-copy-trading polywatch-crypto-algo
```

---

## 7. Monitoring

### 7.1 Métriques Prometheus

Le backend expose `/metrics` (protégé par `x-service-token`) :

```
curl -H "x-service-token: $SERVICE_TOKEN" http://localhost:3000/metrics
```

### 7.2 Logs Critiques

| Log | Action |
|-----|--------|
| `WebSocket user channel connected` | ✅ OK |
| `clob_credentials_missing` | Vérifier credentials CLOB |
| `order_not_matched` | Vérifier liquidité marché |
| `slippage_exceeded` | Augmenter `maxSlippagePercent` |
| `insufficient_cash` | Vérifier balance deposit wallet |

---

## 8. Support

- Architecture : [`architecture.md`](./architecture.md)
- Pipeline : [`pipeline-copy-trading.md`](./pipeline-copy-trading.md)
- API : [`api.md`](./api.md)
- Métriques : [`metrics.md`](./metrics.md)