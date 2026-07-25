# Audit — Protocoles Polymarket

| Document | Description |
|----------|-------------|
| [audit-avant.canvas.tsx](./audit-avant.canvas.tsx) | État **avant correctifs** (10 juin 2026) — 4 critiques, 8 moyens |
| [audit-corrige.canvas.tsx](./audit-corrige.canvas.tsx) | État **après correctifs** (patches Phase A+B+C+D1, canal WS user) |

## Ouvrir dans Cursor

Les canvases interactifs sont aussi disponibles dans le dossier IDE :

- [audit-protocoles-polymarket-avant.canvas.tsx](C:\Users\lcsystem\.cursor\projects\c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v0-3-Setup-RealTrading\canvases\audit-protocoles-polymarket-avant.canvas.tsx)
- [audit-protocoles-polymarket-corrige.canvas.tsx](C:\Users\lcsystem\.cursor\projects\c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v0-3-Setup-RealTrading\canvases\audit-protocoles-polymarket-corrige.canvas.tsx)

## Correctifs appliqués (résumé)

| ID | Fichier principal | Statut |
|----|-------------------|--------|
| C1 | `packages/worker/src/clob/parse-fill-response.ts` | Corrigé |
| C2 | `packages/backend/src/polymarket/clob-redeem.ts` | Corrigé |
| C3 | `packages/worker/src/clob/startup-reconciler.ts` | Corrigé (réconciliation) |
| C4 | `packages/core/src/config/secrets.ts` | Corrigé |
| B1–C5 | voir plan `patchs_critiques_polymarket` | Corrigé |
| D1 | `packages/worker/src/polymarket/websocket-user.ts` | Canal WS user async |
