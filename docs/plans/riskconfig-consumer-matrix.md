# RiskConfig consumer matrix

> Generated during P0 Phase A (2026-08-06). Update as migrations complete.

| File | Package | Usage | Fields / API | Replacement target | Phase | Criticality |
|------|---------|-------|--------------|-------------------|-------|-------------|
| `services/risk.service.ts` | core | facade | `composeRiskConfig`, `getConfig`, `updateConfig` | keep until Phase F | — | hot |
| `risk/policy.ts` | core | runtime | legacy getters (`getModeSizingParams`, etc.) | algo-kind wrappers on isolated configs | B.4 / F | hot |
| `risk/sim-execution-tunables.ts` | core | runtime | sim exec latency / self-impact | `GlobalConfig` | ✅ B.1 done | hot |
| `risk/sim-rotation-targets.ts` | core | runtime | rotation keys | `CopyConfig` + `CryptoConfig` (+ FromConfigs) | ✅ B.1 (legacy deprecated) | warm |
| `risk/crypto-algo-exit.ts` | core | runtime | crypto exit params | `CryptoConfig` | ✅ B.1 done | hot |
| `services/reservation.service.ts` | core | runtime | max open positions | `getCopyMaxOpenPositions` / `getCryptoMaxOpenPositions` | ✅ B.1 done | hot |
| `services/simulation-archive.service.ts` | core | runtime | `extractSimConfigSnapshot(getConfig())` | `extractSimConfigSnapshotFromIsolated` | B.2 | warm |
| `services/real-archive.service.ts` | core | runtime | `extractRealConfigSnapshot(getConfig())` | `extractRealConfigSnapshotFromIsolated` | B.2 | warm |
| `services/simulation-session.service.ts` | core | runtime | `pickRotationKeys`, `SIM_SESSION_ROTATION_KEYS` | isolated keys + `pickRotationKeysFromIsolated` | B.2 | warm |
| `services/real-session.service.ts` | core | runtime | `pickRotationKeys`, `REAL_SESSION_ROTATION_KEYS` | isolated keys + `pickRotationKeysFromIsolated` | B.2 | warm |
| `risk/sim-mode-fields.ts` | core | runtime + type | snapshot extraction, rotation keys | isolated equivalents (keep until F) | B.2 / F | warm |
| `risk/risk-config-api.ts` | core | runtime | `presentRiskConfigForApi`, `toRiskConfigEntityUpdate` | `presentIsolatedConfigForApi` | F | cold (API) |
| `entities/RiskConfig.ts` | core | type + facade | composed entity | remove in Phase F | F | — |
| `backend/routes/config.ts` | backend | runtime | legacy merged config API | per-kind routes + isolated presenter | F | cold (API) |
| `backend/services/session-rotation.service.ts` | backend | type | `RiskConfig` union for rotation diff | isolated config bundle | F | warm |
| `frontend/lib/simulation-snapshots.ts` | frontend | type | `SimRiskConfigSnapshot` | keep type, source from isolated API | F | cold |
| `frontend/lib/real-snapshots.ts` | frontend | type | `RealRiskConfigSnapshot` | keep type, source from isolated API | F | cold |
| `frontend/lib/snapshot-config-diff.ts` | frontend | type | snapshot config diff | isolated config shape | F | cold |
| `worker/processors/strategy/close-bid.ts` | worker | runtime | algo-kind exit tunables via RiskConfig comment | algo-kind wrapper | B.3 | hot |
| `worker/execution/latency-calibrator.test.ts` | worker | type | test fixtures | `GlobalConfig` fixtures | B.1 | test |
| `weather-algo/strategy/strategy-runner.ts` | weather-algo | runtime | `WeatherConfig` only (no RiskConfig runtime) | remove stale type imports if any | B.3 | hot |
| `e2e/crypto-algo/helpers/risk-config.ts` | e2e | runtime | writes via `RiskConfig` entity | isolated config services | post-P0 | test |

## Notes

- Table `risk_config` dropped (migration 0088); facade composes from `global_config`, `copy_config`, `crypto_config`, `weather_config`.
- `feature.risk_config_legacy_facade` (**wired**): `true` → `getConfig`/`updateConfig` allowed; `false` → throw `RiskConfigLegacyFacadeDisabledError`. Flag read failures fail-open to `true`.
- `feature.deprecated_fallbacks_enabled` (**wired** in StrategyRunner): `false` → Gamma TTL without cryptoConfig throws.
- `assertNoDivergence` remains a light compose integrity check (log-only by default); Strangler gate is the legacy_facade flag.
