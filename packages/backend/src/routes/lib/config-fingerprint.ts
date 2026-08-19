import type { WeatherConfig } from '@polywatch/core';

export function computeConfigFingerprint(config: WeatherConfig): string {
  const relevant = Object.keys(config as unknown as Record<string, unknown>)
    .filter((k) => k.startsWith('weatherAlgo'))
    .sort()
    .map((k) => `${k}=${String((config as unknown as Record<string, unknown>)[k])}`)
    .join('|');
  let hash = 0;
  for (let i = 0; i < relevant.length; i++) {
    hash = (hash << 5) - hash + relevant.charCodeAt(i);
    hash |= 0;
  }
  return `cfg:${Math.abs(hash).toString(36)}`;
}
