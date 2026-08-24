/** Seuils de position affichés sur le graphique (entrée, SL, TP). */
export interface PositionLevels {
  entryBidVwap: number;
  /** Seuil Stop Loss en points bid. */
  slBidPoints?: number | null;
  /** Seuil Take Profit en points bid. */
  tpBidPoints?: number | null;
  /** Date d'ouverture de la position en ms (pour le marqueur temporel). */
  openedAtMs?: number | null;
  /** Date de clôture de la position en ms (pour le marqueur de sortie). */
  closedAtMs?: number | null;
  /** Outcome de la position (Up, Down, Yes, etc.) pour aligner le marqueur sur la courbe. */
  outcome?: string | null;
  /** Fill price de la dernière SELL execution (prix de sortie). */
  exitBidVwap?: number | null;
}
