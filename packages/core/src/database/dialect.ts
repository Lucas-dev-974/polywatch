// This file previously held the dialect abstraction (sqlite | postgres).
// SQLite has been removed — the project is PostgreSQL-only now.
// The file is kept as an empty marker to avoid breaking imports during transition.
// Safe to delete once all imports of DatabaseDialect/inferDialect are removed.
export {};