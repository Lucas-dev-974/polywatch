-- Drop legacy PNL columns from copied_positions (post v0.7 PNL cleanup).
--
-- Removed from application code:
--   peak_pnl_percent              — superseded by peak_closure_pnl_percent (trailing)
--   last_valid_trigger_pnl_percent — never read; dead field
--
-- Prefer the idempotent runner (handles column detection):
--   npm run db:drop-legacy-pnl-columns
--
-- Or run manually after stopping backend/worker.

-- ── SQLite (3.35+, used by better-sqlite3) ──────────────────────────────────

ALTER TABLE copied_positions DROP COLUMN peak_pnl_percent;
ALTER TABLE copied_positions DROP COLUMN last_valid_trigger_pnl_percent;

-- ── PostgreSQL ───────────────────────────────────────────────────────────────
-- Uncomment if using DATABASE_URL / Postgres:

-- ALTER TABLE copied_positions DROP COLUMN IF EXISTS peak_pnl_percent;
-- ALTER TABLE copied_positions DROP COLUMN IF EXISTS last_valid_trigger_pnl_percent;

-- Verify (SQLite):
--   PRAGMA table_info(copied_positions);
-- Verify (PostgreSQL):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'copied_positions'
--     AND column_name IN ('peak_pnl_percent', 'last_valid_trigger_pnl_percent');
