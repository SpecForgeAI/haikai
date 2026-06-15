-- Deep Dependency Analysis — SQLite schema
-- One database per snapshot at <snapshot>/_depgraph.sqlite
-- All tables projected from the snapshot's TSV outputs (idempotent, no LLM).

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ─── files ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL UNIQUE,           -- repo-relative, fwd slashes
    language    TEXT,
    byte_size   INTEGER,
    n_symbols   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

-- ─── symbols ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS symbols (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,              -- bare name (e.g. "validate_user")
    qualified_name  TEXT NOT NULL,              -- canonical id (e.g. "src.auth.validate_user")
    kind            TEXT NOT NULL,              -- class | function | method | variable | interface | ...
    file_id         INTEGER NOT NULL REFERENCES files(id),
    line            INTEGER,
    language        TEXT,
    UNIQUE (qualified_name, file_id)
);
CREATE INDEX IF NOT EXISTS idx_symbols_qname ON symbols(qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_name  ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file  ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_kind  ON symbols(kind);

-- ─── imports ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS imports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id         INTEGER NOT NULL REFERENCES files(id),
    package         TEXT NOT NULL,              -- e.g. "org.springframework.web"
    imported_name   TEXT                        -- specific symbol if known
);
CREATE INDEX IF NOT EXISTS idx_imports_file    ON imports(file_id);
CREATE INDEX IF NOT EXISTS idx_imports_package ON imports(package);

-- ─── calls ────────────────────────────────────────────────────────────────
-- caller_symbol_id may be NULL when the caller couldn't be resolved to a symbol
-- (e.g. file-level statement). callee_qualified_name is always populated even
-- when callee_symbol_id is NULL (cross-file calls that didn't resolve).
CREATE TABLE IF NOT EXISTS calls (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_symbol_id         INTEGER REFERENCES symbols(id),
    callee_symbol_id         INTEGER REFERENCES symbols(id),
    callee_qualified_name    TEXT NOT NULL,
    confidence               REAL DEFAULT 1.0,
    file_id                  INTEGER REFERENCES files(id)
);
CREATE INDEX IF NOT EXISTS idx_calls_caller       ON calls(caller_symbol_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee_id    ON calls(callee_symbol_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee_qname ON calls(callee_qualified_name);
CREATE INDEX IF NOT EXISTS idx_calls_file         ON calls(file_id);

-- ─── inheritance ──────────────────────────────────────────────────────────
-- kind: extends | implements | mixin | uses
CREATE TABLE IF NOT EXISTS inheritance (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    child_symbol_id     INTEGER NOT NULL REFERENCES symbols(id),
    parent_symbol_id    INTEGER REFERENCES symbols(id),
    parent_qualified_name TEXT NOT NULL,
    kind                TEXT NOT NULL DEFAULT 'extends'
);
CREATE INDEX IF NOT EXISTS idx_inh_child  ON inheritance(child_symbol_id);
CREATE INDEX IF NOT EXISTS idx_inh_parent ON inheritance(parent_symbol_id);
CREATE INDEX IF NOT EXISTS idx_inh_parent_qname ON inheritance(parent_qualified_name);

-- ─── endpoints ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS endpoints (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    operation           TEXT NOT NULL,          -- GET | POST | ANY | DYNAMIC | ...
    path                TEXT NOT NULL,
    framework           TEXT,
    handler_symbol_id   INTEGER REFERENCES symbols(id),
    file_id             INTEGER REFERENCES files(id),
    line                INTEGER
);
CREATE INDEX IF NOT EXISTS idx_endpoints_handler ON endpoints(handler_symbol_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_path    ON endpoints(path);
CREATE INDEX IF NOT EXISTS idx_endpoints_fw      ON endpoints(framework);

-- ─── interactions ─────────────────────────────────────────────────────────
-- mechanism: db_query | db_write | http_outbound | queue_publish | queue_consume | ...
-- direction: OUTBOUND | INBOUND
CREATE TABLE IF NOT EXISTS interactions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    source_symbol_id    INTEGER REFERENCES symbols(id),
    target              TEXT,                   -- e.g. table name, URL pattern
    mechanism           TEXT NOT NULL,
    direction           TEXT NOT NULL DEFAULT 'OUTBOUND',
    data_hint           TEXT,
    file_id             INTEGER REFERENCES files(id),
    line                INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interactions_source ON interactions(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_interactions_mech   ON interactions(mechanism);

-- ─── meta ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
