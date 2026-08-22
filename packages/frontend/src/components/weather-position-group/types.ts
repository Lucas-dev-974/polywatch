import type { WeatherPosition } from '../../hooks/useWeatherAlgoPositions';

export interface WeatherPositionDateGroup {
  targetDate: string;
  positions: WeatherPosition[];
}

export interface WeatherPositionCityGroup {
  city: string;
  dates: WeatherPositionDateGroup[];
}

/** Handler partagé pour ouvrir le dialogue graphique d'une position. */
export type OpenChartHandler = (pos: WeatherPosition) => void;

/** Handler partagé pour clôturer une position (facultatif). */
export type ClosePositionHandler = (id: number) => void;
