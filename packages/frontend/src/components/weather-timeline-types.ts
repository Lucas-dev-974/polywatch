import type { JSX } from 'solid-js';

export interface WeatherTimelineDateEntry {
  key: string;
  label: string;
}

export interface WeatherTimelineSeriesPoint {
  t: number;
  y: number | null;
}

export interface WeatherTimelineBucketData {
  /** Libellé court affiché dans la légende (ex. `10°`). */
  label: string;
  /** Libellé complet affiché dans le tooltip (ex. `≥ 10°`). */
  fullLabel: string;
  series: WeatherTimelineSeriesPoint[];
}

export interface WeatherTimelineCityData<TCity> {
  key: string;
  bucketCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
  buckets: WeatherTimelineBucketData[];
  /** Donnée brute d'origine, exposée aux render props spécifiques. */
  raw: TCity;
}

export interface WeatherTimelineSideOption {
  value: string;
  label: string;
}

export interface WeatherTimelineSource<TCity extends object> {
  /** Clé de persistance de la date sélectionnée. */
  dateKey: string;
  /** Clé de persistance du nombre de points max. */
  maxTicksKey: string;
  /** Clé de persistance du côté sélectionné (optionnel — absente pour bucket ticks). */
  sideKey?: string;
  sideDefault?: string;
  sideOptions?: WeatherTimelineSideOption[];
  /** Clé de persistance du seuil de prix minimum (optionnel — absente si non configurable). */
  minPriceKey?: string;
  /** Seuil de prix minimum par défaut (en dollars, ex. 0.1 = 10¢). */
  minPriceDefault?: number;
  /** Clé de persistance du filtre d'intervalle (optionnel — absent si non configurable). */
  fidelityKey?: string;
  /** Options d'intervalle (ex. 15 min, 1 h). */
  fidelityOptions?: WeatherTimelineSideOption[];
  /** Intervalle par défaut (vide = tous). */
  fidelityDefault?: string;
  /** Intervalle obligatoire : masque l'option « Tous » et impose une sélection non vide. */
  fidelityRequired?: boolean;
  /** Unité singulière pour les libellés de stats (ex. `tick`, `point`). */
  unitLabel: string;
  dialogTitleId: string;
  fetchDates: () => Promise<WeatherTimelineDateEntry[]>;
  fetchTimeline: (dateKey: string, maxTicks: number, fidelity?: string) => Promise<TCity[]>;
  toCityData: (city: TCity, side: string | null) => WeatherTimelineCityData<TCity>;
  renderCityCardExtra?: (city: TCity) => JSX.Element;
  renderChartHeader: (
    city: TCity,
    side: string | null,
    totalPoints: number,
  ) => JSX.Element;
  renderDialogSummary: (city: TCity, side: string | null) => JSX.Element;
}
