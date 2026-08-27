#!/usr/bin/env bash
#
# Réorganise packages/frontend/src/components/ en sous-dossiers par domaine.
#
# Usage :
#   bash reorganize-components.sh <lot>
#   lot ∈ { charts, settings, dialogs, pages }
#
# Pour chaque lot :
#   1. git mv des fichiers vers le dossier cible
#   2. réécriture des imports relatifs dans TOUS les fichiers .ts/.tsx de src
#      (via perl, qui préserve les fins de ligne CRLF)
#   3. affiche un récapitulatif
#
# La réécriture d'imports est déléguée à rewrite-imports.pl, qui résout chaque
# chemin relatif, vérifie si la cible est un fichier déplacé (table de
# correspondance), et recalcule le chemin relatif vers le nouveau dossier.
# On matche le nom complet du fichier (avec séparateur de chemin) pour éviter
# les faux positifs (ex: SimSnapshotDialog vs SimSnapshotSettingsDialog).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$ROOT/packages/frontend/src"
COMP="$SRC/components"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOT="${1:-}"
if [[ -z "$LOT" ]]; then
  echo "Usage: bash reorganize-components.sh <charts|settings|dialogs|pages>" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Table de correspondance : fichier (sans extension) -> dossier cible
# ---------------------------------------------------------------------------
charts=(
  BacktestEquityChart TimeSeriesLineChart TraderActivityTimelineChart
  TraderCapitalEvolutionChart TraderFundingTimelineChart TraderMarketBreakdownChart
  TraderPnlEvolutionChart UpDownPriceChart SimAnalyticsCategoryChart
  SimSnapshotEquityChart WeatherSeriesChart WeatherBucketTimelineView
  WeatherClobTimelineView WeatherTimelineView
)
settings=(
  env-settings-types crypto-algo-settings-types sim-execution-settings-types
  settings-fields settings-sections
)
dialogs=(
  ClobCredentialsDialog CryptoAlgoOptimizeReportDialog CryptoAlgoSettingsDialog
  EnvSettingsDialog MarketChartDialog MarketSyncSettingsDialog NewSessionResetDialog
  PolygonscanSettingsDialog PusdTransferDialog RealPeriodCloseDialog
  RealSessionArchiveDialog RealSnapshotDialog RealSnapshotSettingsDialog
  SimExecutionSettingsDialog SimSessionArchiveDialog SimSnapshotDetailDialog
  SimSnapshotDialog SimSnapshotSettingsDialog SnapshotDialog SystemConfigDialog
  WalletAccountsDialog WeatherPositionMarketChartDialog
)
pages=(
  SimulationPage RealHero Leaderboard MarketsPage WalletPage CryptoAlgoPage
  WeatherAlgoPage SystemPage Login ReportsPage MetricsDashboardPage E2eTestsPage
  TraderProfilePage SnapshotsPage SystemOverviewPage CryptoAlgoMonitorPage
)

case "$LOT" in
  charts)   FILES=("${charts[@]}");   DIR="charts";;
  settings) FILES=("${settings[@]}"); DIR="settings";;
  dialogs)  FILES=("${dialogs[@]}");  DIR="dialogs";;
  pages)    FILES=("${pages[@]}");    DIR="pages";;
  *) echo "Lot inconnu: $LOT" >&2; exit 1;;
esac

# ---------------------------------------------------------------------------
# 1. git mv
# ---------------------------------------------------------------------------
echo "==> Lot '$LOT' : déplacement de ${#FILES[@]} fichiers vers $DIR/"
mkdir -p "$COMP/$DIR"
for f in "${FILES[@]}"; do
  if [[ -f "$COMP/$f.tsx" ]]; then
    git -C "$ROOT" mv "$COMP/$f.tsx" "$COMP/$DIR/$f.tsx"
  elif [[ -f "$COMP/$f.ts" ]]; then
    git -C "$ROOT" mv "$COMP/$f.ts" "$COMP/$DIR/$f.ts"
  else
    echo "!! introuvable: $f" >&2
  fi
done

# ---------------------------------------------------------------------------
# 2. Réécriture des imports relatifs (perl, préserve CRLF)
# ---------------------------------------------------------------------------
# Construit le mapping pour le lot courant uniquement (les autres lots ne
# sont pas encore déplacés, on ne doit pas réécrire leurs imports).
MAPFILE="$(mktemp)"
for f in "${FILES[@]}"; do
  echo "$f|$DIR" >> "$MAPFILE"
done

echo "==> Réécriture des imports relatifs dans $SRC"
perl "$SCRIPT_DIR/rewrite-imports.pl" "$MAPFILE" "$SRC" "$DIR"
rm -f "$MAPFILE"

echo "==> Lot '$LOT' terminé. Lancez ensuite : npx tsc --noEmit -p packages/frontend/tsconfig.json"
