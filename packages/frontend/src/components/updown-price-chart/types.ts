/** Seuils de position affichés sur le graphique (entrée, SL, TP). */
export interface PositionLevels {
  entryBidVwap: number;
  /** Cost basis per share (entry price + fees/qty) for percent SL/TP overlays. */
  costPerShare: number;
  /** Seuil Stop Loss en % de la mise investie. */
  slPercent?: number | null;
  /** Seuil Take Profit en % de la mise investie. */
  tpPercent?: number | null;
  /** Date d'ouverture de la position en ms (pour le marqueur temporel). */
  openedAtMs?: number | null;
  /** Date de clôture de la position en ms (pour le marqueur de sortie). */
  closedAtMs?: number | null;
  /** Outcome de la position (Up, Down, Yes, etc.) pour aligner le marqueur sur la courbe. */
  outcome?: string | null;
  /** Fill price de la dernière SELL execution (prix de sortie). */
  exitBidVwap?: number | null;
}