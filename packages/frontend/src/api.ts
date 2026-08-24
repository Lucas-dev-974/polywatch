// Baril d'export de la couche API. Le coeur HTTP, les configs, le backtest,
// les données weather-algo et crypto-algo vivent dans des modules par domaine
// (voir ./http, ./config, ./backtest, ./weather, ./crypto) — ce baril préserve
// toutes les signatures d'import existantes : `import { api } from '../api'`.
//
// Attention : ce baril n'ajoute AUCUN mock Vitest — aucun test frontend ne
// mappe `vi.mock('../api')`. Si un jour un test mappe le baril, importez les
// modules par domaine directement dans le composant testé.

export * from './api/http';
export * from './api/config';
export * from './api/backtest';
export * from './api/weather';
export * from './api/crypto';
