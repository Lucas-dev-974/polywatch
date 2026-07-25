#!/bin/bash
# Dry-run script for real trading validation.
# Verifies all prerequisites before enabling real trading.
#
# Usage: npm run dry-run:real
# Or:    ./scripts/dry-run-real-trading.sh

set -e

echo ""
echo "🔍 Polywatch Real Trading Dry-Run"
echo "═════════════════════════════════════════════════"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# Check 1: Secrets
echo "📋 Check 1: Secrets"
echo ""

MASTER_KEY="${MASTER_ENCRYPTION_KEY:-}"
SERVICE_TOKEN="${SERVICE_TOKEN:-}"

# Check for insecure defaults
if [[ "$MASTER_KEY" == "0123456789abcdef0123456789abcdef" ]] || [[ -z "$MASTER_KEY" ]]; then
    echo "   ❌ MASTER_ENCRYPTION_KEY: INSECURE (valeur par défaut)"
    echo ""
    echo "   → Exécutez: npm run generate-secrets"
    echo ""
    FAILED=1
else
    echo "   ✅ MASTER_ENCRYPTION_KEY: OK"
fi

if [[ "$SERVICE_TOKEN" == *"dev-service-token"* ]] || [[ -z "$SERVICE_TOKEN" ]]; then
    echo "   ❌ SERVICE_TOKEN: INSECURE (valeur par défaut)"
    FAILED=1
else
    echo "   ✅ SERVICE_TOKEN: OK"
fi

# Check 2: Database connection
echo ""
echo "📋 Check 2: Base de données"
echo ""

if docker exec polywatch-v07-postgres-1 pg_isready -U polywatch -d polywatch > /dev/null 2>&1; then
    echo "   ✅ Connexion PostgreSQL OK"
else
    echo "   ❌ Connexion PostgreSQL ÉCHEC"
    echo "      Vérifiez que PostgreSQL est démarré"
    FAILED=1
fi

# Check 3: Redis connection
echo ""
echo "📋 Check 3: Redis"
echo ""

if docker exec polywatch-v07-redis-1 redis-cli ping > /dev/null 2>&1; then
    echo "   ✅ Connexion Redis OK"
else
    echo "   ❌ Connexion Redis ÉCHEC"
    echo "      Vérifiez que Redis est démarré"
    FAILED=1
fi

# Check 4: Configuration
echo ""
echo "📋 Check 4: Configuration risque"
echo ""

REAL_ENABLED=$(docker exec polywatch-v07-postgres-1 psql -U polywatch -d polywatch -t -c "SELECT real_trading_enabled FROM risk_config LIMIT 1;" 2>/dev/null | tr -d '[:space:]')

if [[ "$REAL_ENABLED" == "t" ]] || [[ "$REAL_ENABLED" == "true" ]]; then
    echo "   ⚠️  real_trading_enabled: TRUE (ACTIVÉ)"
    echo "      ATTENTION: Le trading réel est activé"
else
    echo "   ✅ real_trading_enabled: false (désactivé par défaut)"
fi

REAL_ENTRY=$(docker exec polywatch-v07-postgres-1 psql -U polywatch -d polywatch -t -c "SELECT real_entry_usdc_amount FROM risk_config LIMIT 1;" 2>/dev/null | tr -d '[:space:]')
echo "   ✅ real_entry_usdc_amount: ${REAL_ENTRY:-10} USDC"

# Check 5: CLOB Credentials
echo ""
echo "📋 Check 5: Credentials CLOB"
echo ""

CRED_COUNT=$(docker exec polywatch-v07-postgres-1 psql -U polywatch -d polywatch -t -c "SELECT COUNT(*) FROM clob_credentials WHERE mode = 'real';" 2>/dev/null | tr -d '[:space:]')

if [[ "$CRED_COUNT" -gt 0 ]] 2>/dev/null; then
    echo "   ✅ $CRED_COUNT credential(s) CLOB configuré(s)"
else
    echo "   ❌ Aucun credential CLOB configuré"
    echo "      Configurez les credentials via l'API /api/wallet/credentials"
    FAILED=1
fi

# Summary
echo ""
echo "═════════════════════════════════════════════════"
echo "📊 RÉSUMÉ"
echo ""

if [[ "$FAILED" -eq 1 ]]; then
    echo -e "${RED}❌ Dry-run ÉCHEC${NC}"
    echo ""
    echo "   Corrigez les erreurs avant d'activer le trading réel."
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ Dry-run RÉUSSI${NC}"
    echo ""
    echo "   Prêt pour le trading réel."
    echo ""
    echo "⚠️  Pour activer le trading réel:"
    echo "   1. Configurez les credentials CLOB (si pas fait)"
    echo "   2. Vérifiez les approvals on-chain: GET /api/wallet/approvals"
    echo "   3. Activez real_trading_enabled dans risk_config"
    echo "   4. Démarrez le worker: npm run dev -w @polywatch/worker"
    echo ""
    exit 0
fi