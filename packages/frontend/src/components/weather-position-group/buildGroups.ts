import type { WeatherPosition } from '../../hooks/useWeatherAlgoPositions';
import type { WeatherPositionCityGroup, WeatherPositionDateGroup } from './types';

export function buildWeatherPositionGroups(
  list: WeatherPosition[],
): WeatherPositionCityGroup[] {
  const byCity = new Map<string, Map<string, WeatherPosition[]>>();
  for (const pos of list) {
    const city = pos.weatherForecast?.city ?? '—';
    const targetDate = pos.weatherForecast?.targetDate ?? '';
    let cityMap = byCity.get(city);
    if (!cityMap) {
      cityMap = new Map();
      byCity.set(city, cityMap);
    }
    let group = cityMap.get(targetDate);
    if (!group) {
      group = [];
      cityMap.set(targetDate, group);
    }
    group.push(pos);
  }
  const groups: WeatherPositionCityGroup[] = [];
  for (const [city, cityMap] of byCity) {
    const dates: WeatherPositionDateGroup[] = [];
    for (const [targetDate, positions] of cityMap) {
      dates.push({ targetDate, positions });
    }
    dates.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    groups.push({ city, dates });
  }
  groups.sort((a, b) => a.city.localeCompare(b.city));
  return groups;
}
