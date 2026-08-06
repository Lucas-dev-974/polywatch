# RiskConfig consumer matrix

> Generated during P0 Phase A (2026-08-06). **Phase F complete (2026-08-06)** — legacy façade purged.

| File | Package | Status | Notes |
|------|---------|--------|-------|
| `services/risk.service.ts` | core | ✅ F | Isolated getters + `getConfigForAlgo` + kill-switch only |
| `risk/policy.ts` | core | ✅ F | Legacy `getMode*` removed ; per-algo getters on isolated configs |
| `risk/sim-mode-fields.ts` | core | ✅ F | `extract*FromIsolated` without RiskConfig cast |
| `backend/routes/config.ts` | backend | ✅ F | `/api/risk-config` removed ; CLOB/Polygonscan/stats kept |
| `backend/routes/config-per-kind.ts` | backend | ✅ | Per-kind PUT + serialized rotation |
| `frontend/*` | frontend | ✅ F | All callers on `/api/config/*` ; `updateEnvSettings` serializes PUTs |
| `e2e/crypto-algo/helpers/risk-config.ts` | e2e | ✅ F | Uses `CryptoConfigService` + `CopyConfigService` |
| `entities/RiskConfig.ts` | core | ✅ deleted | Table dropped in migration 0088 |
| `risk/risk-config-api.ts` | core | ✅ deleted | Helpers moved to `crypto-config-api.ts` |
| `risk/risk-config-divergence.ts` | core | ✅ deleted | Feature flags `risk_config_*` removed from seed |

## Notes

- Config lives in four tables: `global_config`, `copy_config`, `crypto_config`, `weather_config`.
- Session snapshots still use `SimRiskConfigSnapshot` / `RealRiskConfigSnapshot` JSON shapes built via `extract*FromIsolated`.
- Revisions append to `risk_config_revisions` on each per-kind PUT.
