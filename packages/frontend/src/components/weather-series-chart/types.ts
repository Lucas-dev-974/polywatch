import type { WeatherTimelineBucketData } from '../weather-timeline-types';

/** Point de série valide (y non-null) utilisé pour le tracé. */
export interface ChartPoint {
  t: number;
  y: number;
}

/** État du crosshair au survol. */
export interface HoverState {
  t: number;
  svgX: number;
}

/** Marker de position (entrée/sortie) superposé sur le graph. */
export interface SeriesChartMarker {
  /** Timestamp (ms) où placer le marker — aligné sur l'axe temps. */
  t: number;
  /** Prix (0–1) où placer le marker — aligné sur l'axe des prix. */
  y: number;
  label: string;
  kind: 'entry' | 'exit';
}

/** Bucket enrichi de ses segments de points continus. */
export interface SegmentedBucket {
  bucket: WeatherTimelineBucketData;
  segments: ChartPoint[][];
}

/** Ligne de tooltip crosshair. */
export interface TooltipRow {
  label: string;
  color: string;
  price: number;
}
