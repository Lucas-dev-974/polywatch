export interface CityGroup<T> {
  city: string;
  key: string;
  items: T[];
}

/**
 * Group items by city using a string accessor.
 * Items with null/empty city are placed under "Autres".
 * Sorted alphabetically, "Autres" last.
 */
export function groupByCity<T>(
  items: T[],
  getCity: (item: T) => string | null,
): CityGroup<T>[] {
  const map = new Map<string, CityGroup<T>>();

  for (const item of items) {
    const rawCity = getCity(item);
    const key = rawCity ? rawCity.trim().toLowerCase() : 'autres';
    const displayCity = rawCity?.trim() || 'Autres';

    let group = map.get(key);
    if (!group) {
      group = { city: displayCity, key, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.key === 'autres') return 1;
    if (b.key === 'autres') return -1;
    return a.city.localeCompare(b.city);
  });

  return groups;
}
