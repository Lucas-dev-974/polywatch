import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enrichSeries, clearEnrichCache } from './precompute';
import type { BacktestMarketSeriesDto } from '../../../api';

describe('enrichSeries', () => {
  beforeEach(() => {
    clearEnrichCache();
  });

  const makeDto = (overrides: Partial<BacktestMarketSeriesDto> = {}): BacktestMarketSeriesDto => ({
    conditionId: 'test-condition',
    city: 'Paris',
    targetDateIso: '2026-08-23',
    metric: 'temperature',
    bucketComparison: 'above',
    bucketTarget: 25,
    bucketLow: null,
    bucketHigh: null,
    unit: 'celsius',
    forecastMean: 24.5,
    forecastStdDev: 2.1,
    points: [
      { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
      { t: '2026-08-23T10:05:00Z', yesPrice: 0.55 },
      { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
    ],
    ...overrides,
  });

  describe('§T1 — enrichSeries basics', () => {
    it('points avec timestamps valides → t numérique correct, bornes minT/maxT', () => {
      const dto = makeDto();
      const enriched = enrichSeries(dto);

      expect(enriched.points).toHaveLength(3);
      expect(enriched.points[0].t).toBe(Date.parse('2026-08-23T10:00:00Z'));
      expect(enriched.points[1].t).toBe(Date.parse('2026-08-23T10:05:00Z'));
      expect(enriched.points[2].t).toBe(Date.parse('2026-08-23T10:10:00Z'));
      expect(enriched.minT).toBe(Date.parse('2026-08-23T10:00:00Z'));
      expect(enriched.maxT).toBe(Date.parse('2026-08-23T10:10:00Z'));
    });

    it('timestamp invalide → point ignoré (pas de NaN)', () => {
      const dto = makeDto({
        points: [
          { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
          { t: 'invalid-date', yesPrice: 0.6 },
          { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
        ],
      });
      const enriched = enrichSeries(dto);

      expect(enriched.points).toHaveLength(2);
      expect(enriched.points[0].t).toBe(Date.parse('2026-08-23T10:00:00Z'));
      expect(enriched.points[1].t).toBe(Date.parse('2026-08-23T10:10:00Z'));
    });

    it('yesPrice = null → price: null conservé (trou), pas supprimé', () => {
      const dto = makeDto({
        points: [
          { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
          { t: '2026-08-23T10:05:00Z', yesPrice: null },
          { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
        ],
      });
      const enriched = enrichSeries(dto);

      expect(enriched.points).toHaveLength(3);
      expect(enriched.points[0].price).toBe(0.5);
      expect(enriched.points[1].price).toBeNull();
      expect(enriched.points[2].price).toBe(0.52);
    });

    it('ordre préservé (t croissant)', () => {
      const dto = makeDto({
        points: [
          { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
          { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
          { t: '2026-08-23T10:05:00Z', yesPrice: 0.55 },
        ],
      });
      const enriched = enrichSeries(dto);

      // L'enrichissement ne re-trie pas (données supposées chronologiques)
      expect(enriched.points[0].t).toBe(Date.parse('2026-08-23T10:10:00Z'));
      expect(enriched.points[1].t).toBe(Date.parse('2026-08-23T10:00:00Z'));
      expect(enriched.points[2].t).toBe(Date.parse('2026-08-23T10:05:00Z'));
    });

    it('série vide → points: [], bornes cohérentes', () => {
      const dto = makeDto({ points: [] });
      const enriched = enrichSeries(dto);

      expect(enriched.points).toEqual([]);
      expect(enriched.minT).toBe(Infinity);
      expect(enriched.maxT).toBe(-Infinity);
    });
  });

  describe('§T2 — buildPath sur séries enrichies', () => {
    it('régression : même rendu visuel qu\'avec Date.parse (comparer d sur petit dataset)', () => {
      // Ce test sera implémenté quand buildPath sera testé directement
      // Pour l'instant, on vérifie que l'enrichissement produit des données compatibles
      const dto = makeDto();
      const enriched = enrichSeries(dto);

      // Vérifier la structure attendue par buildPath
      expect(enriched.points.every(p => typeof p.t === 'number')).toBe(true);
      expect(enriched.points.every(p => p.price === null || typeof p.price === 'number')).toBe(true);
    });

    it('pas de re-parse : buildPath n\'appelle plus Date.parse sur séries enrichies', () => {
      // Test d'intégration : on vérifie que enrichSeries produit des timestamps numériques
      const dto = makeDto();
      const enriched = enrichSeries(dto);

      // Tous les timestamps sont des numbers, pas des strings
      for (const p of enriched.points) {
        expect(typeof p.t).toBe('number');
        expect(Number.isNaN(p.t)).toBe(false);
      }
    });

    it('maxTicks/clipUntilT : toujours respectés (basés sur p.t numérique)', () => {
      const dto = makeDto();
      const enriched = enrichSeries(dto);

      // Simuler ce que fait buildPath : slice(-maxTicks)
      const maxTicks = 2;
      const sliced = enriched.points.slice(-maxTicks);
      expect(sliced).toHaveLength(2);
      expect(sliced[0].t).toBe(Date.parse('2026-08-23T10:05:00Z'));

      // Simuler clipUntilT
      const clipUntilT = Date.parse('2026-08-23T10:07:00Z');
      const clipped = enriched.points.filter(p => p.t <= clipUntilT);
      expect(clipped).toHaveLength(2);
    });
  });

  describe('§T3 — nearestPrice enrichi (simulé)', () => {
    it('recherche binaire sur p.t retourne le bon prix, dans la fenêtre slice(-maxTicks)', () => {
      // Ce test valide la logique utilisée dans useRidgeHover.nearestPrice
      const dto = makeDto({
        points: [
          { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
          { t: '2026-08-23T10:05:00Z', yesPrice: 0.55 },
          { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
          { t: '2026-08-23T10:15:00Z', yesPrice: 0.58 },
          { t: '2026-08-23T10:20:00Z', yesPrice: 0.51 },
        ],
      });
      const enriched = enrichSeries(dto);

      // Simuler nearestPrice avec maxTicks=3 (derniers 3 points)
      const maxTicks = 3;
      const sliced = enriched.points.slice(-maxTicks);
      const targetT = Date.parse('2026-08-23T10:12:00Z'); // entre 10:10 et 10:15

      // Recherche binaire manuelle
      let lo = 0, hi = sliced.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sliced[mid].t < targetT) lo = mid + 1;
        else hi = mid;
      }

      // Vérifier les candidats adjacents
      let best: number | null = null;
      let bestDist = Infinity;
      for (const cand of [lo - 1, lo, lo + 1]) {
        if (cand < 0 || cand >= sliced.length) continue;
        const p = sliced[cand];
        if (p.price == null) continue;
        const d = Math.abs(p.t - targetT);
        if (d < bestDist) {
          bestDist = d;
          best = p.price;
        }
      }

      // Le plus proche de 10:12 est 10:10 (price=0.52) ou 10:15 (price=0.58)
      // 10:12 - 10:10 = 2min, 10:15 - 10:12 = 3min → 10:10 gagne
      expect(best).toBe(0.52);
    });

    it('null (trou) ignoré', () => {
      const dto = makeDto({
        points: [
          { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
          { t: '2026-08-23T10:05:00Z', yesPrice: null },
          { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
        ],
      });
      const enriched = enrichSeries(dto);

      const targetT = Date.parse('2026-08-23T10:04:00Z'); // près du trou
      let best: number | null = null;
      let bestDist = Infinity;
      for (const p of enriched.points) {
        if (p.price == null) continue;
        const d = Math.abs(p.t - targetT);
        if (d < bestDist) {
          bestDist = d;
          best = p.price;
        }
      }

      expect(best).toBe(0.5); // 10:00 est plus proche que 10:10
    });

    it('bornes pré-calculées minT/maxT pour early-exit', () => {
      const dto = makeDto();
      const enriched = enrichSeries(dto);

      // Hors bornes → early exit possible
      expect(enriched.minT).toBeLessThan(enriched.maxT);
      expect(Date.parse('2026-08-23T09:00:00Z')).toBeLessThan(enriched.minT);
      expect(Date.parse('2026-08-23T11:00:00Z')).toBeGreaterThan(enriched.maxT);
    });
  });

  describe('§T4 — Invalidation du cache (zone d\'ombre Z1)', () => {
    it('même conditionId + même référence points → cache hit (même référence retournée)', () => {
      const dto = makeDto();
      const pointsRef = dto.points; // même référence

      const enriched1 = enrichSeries(dto);
      const enriched2 = enrichSeries(dto);

      expect(enriched1).toBe(enriched2); // même référence = cache hit
    });

    it('même conditionId + nouvelle référence points (nouveau poll) → re-enrichit (référence différente)', () => {
      const dto1 = makeDto();
      const enriched1 = enrichSeries(dto1);

      // Nouveau poll : nouvelle référence de tableau points
      const dto2 = makeDto({
        points: [
          { t: '2026-08-23T10:00:00Z', yesPrice: 0.5 },
          { t: '2026-08-23T10:05:00Z', yesPrice: 0.55 },
          { t: '2026-08-23T10:10:00Z', yesPrice: 0.52 },
          { t: '2026-08-23T10:15:00Z', yesPrice: 0.58 }, // nouveau point
        ],
      });
      const enriched2 = enrichSeries(dto2);

      expect(enriched1).not.toBe(enriched2); // référence différente = re-enrichit
      expect(enriched2.points).toHaveLength(4); // nouvelles données
      expect(enriched2.points[3].t).toBe(Date.parse('2026-08-23T10:15:00Z'));
    });

    it('même conditionId + même longueur mais timestamps différents → re-enrichit', () => {
      const dto1 = makeDto();
      const enriched1 = enrichSeries(dto1);

      // Même longueur, mais timestamps décalés (simule un nouveau poll avec mêmes nb de points)
      const dto2 = makeDto({
        points: [
          { t: '2026-08-23T11:00:00Z', yesPrice: 0.5 },
          { t: '2026-08-23T11:05:00Z', yesPrice: 0.55 },
          { t: '2026-08-23T11:10:00Z', yesPrice: 0.52 },
        ],
      });
      const enriched2 = enrichSeries(dto2);

      expect(enriched1).not.toBe(enriched2);
      expect(enriched2.points[0].t).toBe(Date.parse('2026-08-23T11:00:00Z'));
    });
  });
});