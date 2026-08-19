import type { BacktestMarketSeriesDto, BacktestPositionDto } from '../../../api';

/** Série (bucket) enrichie de sa couleur et de sa position éventuelle. */
export interface BucketLine {
  series: BacktestMarketSeriesDto;
  color: string;
  position: BacktestPositionDto | null;
}

/** Une row du ridge plot : un groupe ville + date cible, contenant plusieurs buckets. */
export interface VoieGroup {
  city: string | null;
  date: string;
  buckets: BucketLine[];
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
  position: BacktestPositionDto | null;
}

export interface TooltipInfo {
  city: string;
  date: string;
  cursorLabel: string;
  buckets: TooltipBucket[];
  hasPositions: boolean;
  positionBuckets: TooltipBucket[];
}
