import type { BacktestMarketSeriesDto, BacktestPositionDto } from '../../../api';

/** Point de série enrichi : timestamp pré-parsé (ms) + géométrie native. */
export interface EnrichedPoint {
  /** Timestamp numérique (Date.parse) — pré-calculé, ne se re-parse jamais. */
  t: number;
  /** Prix YES brut (0..1 ou null si trou). */
  price: number | null;
}

export interface EnrichedSeries {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  forecastMean: number | null;
  forecastStdDev: number | null;
  points: EnrichedPoint[];   // triés par t croissant
  /** Bornes pour accès rapide / early-exit. */
  minT: number;
  maxT: number;
}

/** Série (bucket) enrichie de sa couleur et de sa position éventuelle. */
export interface BucketLine {
  series: BacktestMarketSeriesDto;
  /** Version enrichie (timestamps numériques, bornes) — pour le chemin de rendu chaud. */
  enriched?: EnrichedSeries;
  color: string;
  position: BacktestPositionDto | null;
}

/** Une row du ridge plot : un groupe ville + date cible, contenant plusieurs buckets. */
export interface VoieGroup {
  city: string | null;
  date: string;
  /** Prévision météo enregistrée pour la date cible (du dernier snapshot). */
  forecastMean: number | null;
  forecastStdDev: number | null;
  buckets: BucketLine[];
  /** Buckets ayant une position, précalculés pour éviter un .filter() à chaque rendu. */
  positionBuckets: BucketLine[];
}

/**
 * Voie visible dans la fenêtre de virtualisation, associée à son index global
 * dans la liste complète des voies. L'index global est nécessaire pour le
 * positionnement vertical (`scale().top(globalIndex)`) et la comparaison de
 * hover, car l'index du `<For>` est local au sous-ensemble rendu.
 */
export interface VisibleVoie {
  voie: VoieGroup;
  globalIndex: number;
}

/** Géométrie pure (pixels) dérivée du viewport et de la largeur du plot. */
export interface RidgeScale {
  minT: number;
  maxT: number;
  spanT: number;
  plotW: number;
  /** Convertit un timestamp (ms) en abscisse pixel. */
  xPos: (t: number) => number;
  /** Convertit un prix (0–1) et le top d'une row en ordonnée pixel. */
  yPos: (price: number, voieTop: number) => number;
  /** Top pixel de la row d'indice i. */
  top: (i: number) => number;
}

/** Ligne de la légende affichée dans le tooltip. */
export interface TooltipBucket {
  color: string;
  label: string;
  price: number | null;
  /** Nombre total de ticks enregistrés pour ce bucket. */
  tickCount: number;
  position: BacktestPositionDto | null;
}

export interface TooltipInfo {
  city: string;
  date: string;
  forecastMean: number | null;
  forecastStdDev: number | null;
  cursorLabel: string;
  buckets: TooltipBucket[];
  hasPositions: boolean;
  positionBuckets: TooltipBucket[];
}
