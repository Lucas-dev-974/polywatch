# RiskConfig consumer matrix

> Generated during P0 Phase A (2026-08-06). Updated Phase B (B.1–B.3).

| File | Package | Usage | Fields / API | Replacement target | Phase | Criticality |
|------|---------|-------|--------------|-------------------|-------|-------------|
| `services/risk.service.ts` | core | facade | `composeRiskConfig`, `getConfig`, `updateConfig` | keep until Phase F | — | hot |
| `risk/policy.ts` | core | runtime | legacy getters (`getModeSizingParams`, etc.) | algo-kind wrappers on isolated configs | F | hot |
| `risk/sim-execution-tunables.ts` | core | runtime | sim exec latency / self-impact | `GlobalConfig` | ✅ B.1 | hot |
| `risk/sim-rotation-targets.ts` | core | runtime | rotation keys | `resolveSimRotationTargetsFromConfigs` | ✅ B.1 (legacy deprecated) | warm |
| `risk/crypto-algo-exit.ts` | core | runtime | crypto exit params | `CryptoConfig` | ✅ B.1 | hot |
| `services/reservation.service.ts` | core | runtime | max open positions | algo-kind max-open wrappers | ✅ B.1 | hot |
| `services/simulation-archive.service.ts` | core | runtime | empty-session + decision window | `getGlobalConfig` | ✅ B.2 | warm |
| `services/real-archive.service.ts` | core | runtime | decision window | `getGlobalConfig` | ✅ B.2 | warm |
| `services/simulation-session.service.ts` | core | runtime | `stampSessionConfig` | `extractSimConfigSnapshotFromIsolated` | ✅ B.2 | warm |
| `services/real-session.service.ts` | core | runtime | `stampSessionConfig` | `extractRealConfigSnapshotFromIsolated` | ✅ B.2 | warm |
| `services/simulation.service.ts` | core | runtime | baseline capital | `getConfigForAlgo` | ✅ B.2 | warm |
| `risk/sim-mode-fields.ts` | core | runtime + type | snapshot + rotation helpers | isolated APIs added (legacy kept until F) | ✅ B.2 / F | warm |
| `backend/services/session-rotation.service.ts` | backend | runtime | real rotation diff | `realRotationChangedFromIsolated` | ✅ B.2 | warm |
| `backend/routes/config-per-kind.ts` | backend | runtime | rotation after PUT | isolated bundle + `realRotationChangedFromIsolated` | ✅ B.2 | warm |
| `worker/processors/strategy/close-bid.ts` | worker | runtime | last-closeable age (caller-supplied) | comment → CryptoConfig / algo-kind | ✅ B.3 | hot |
| `weather-algo/strategy/strategy-runner.ts` | weather-algo | runtime | `WeatherConfig` only | no RiskConfig import | ✅ B.3 | hot |
| `risk/risk-config-api.ts` | core | runtime | `presentRiskConfigForApi`, `toRiskConfigEntityUpdate` | `presentIsolatedConfigForApi` | F | cold (API) |
| `entities/RiskConfig.ts` | core | type + facade | composed entity | remove in Phase F | F | — |
| `backend/routes/config.ts` | backend | runtime | legacy merged config API | per-kind routes + isolated presenter | F | cold (API) |
| `frontend/lib/simulation-snapshots.ts` | frontend | type | `SimRiskConfigSnapshot` | keep type, source from isolated API | F | cold |
| `frontend/lib/real-snapshots.ts` | frontend | type | `RealRiskConfigSnapshot` | keep type, source from isolated API | F | cold |
| `frontend/lib/snapshot-config-diff.ts` | frontend | type | snapshot config diff | isolated config shape | F | cold |
| `worker/execution/latency-calibrator.test.ts` | worker | type | test fixtures | `GlobalConfig` fixtures | post-P0 | test |
| `e2e/crypto-algo/helpers/risk-config.ts` | e2e | runtime | writes via `RiskConfig` entity | isolated config services | post-P0 | test |

## Notes

- Table `risk_config` dropped (migration 0088); facade composes from `global_config`, `copy_config`, `crypto_config`, `weather_config`.
- `feature.risk_config_legacy_facade` (**wired**): `true` → `getConfig`/`updateConfig` allowed; `false` → throw `RiskConfigLegacyFacadeDisabledError`. Flag read failures fail-open to `true`.
- `feature.deprecated_fallbacks_enabled` (**wired** in StrategyRunner): `false` → Gamma TTL without cryptoConfig throws.
- `assertNoDivergence` remains a light compose integrity check (log-only by default); Strangler gate is the legacy_facade flag.
- **B.4 (pre-purge)** : runtime consumers B.1–B.3 no longer call `getConfig()` for their hot paths. Leftovers for Phase F are listed above (facade itself, `policy.ts` legacy getters, `config.ts` merged API, frontend types, e2e helpers). Do **not** delete `composeRiskConfig` / facade until Phase F observation window passes.
