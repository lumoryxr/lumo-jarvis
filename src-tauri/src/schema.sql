-- Lumo JARVIS SQLite schema. Embedded via include_str!().
-- Versioned via the `schema_version` table; bump SCHEMA_VERSION in
-- store.rs when adding migrations here.

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    content     TEXT NOT NULL,
    confidence  REAL NOT NULL,
    ts          INTEGER NOT NULL,
    source      TEXT NOT NULL,
    related_to  TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content='memories',
    content_rowid='rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content)
        VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content)
        VALUES('delete', old.rowid, old.content);
    INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS proposals (
    id           TEXT PRIMARY KEY,
    trigger      TEXT NOT NULL,
    reasoning    TEXT NOT NULL,
    confidence   REAL NOT NULL,
    expires_at   INTEGER NOT NULL,
    tone         TEXT,
    due_at       INTEGER,
    created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    intent      TEXT NOT NULL,
    executor    TEXT NOT NULL,
    status      TEXT NOT NULL,
    progress    REAL NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    project     TEXT,
    tags        TEXT NOT NULL,
    labels      TEXT NOT NULL,
    priority    INTEGER NOT NULL,
    ord         INTEGER NOT NULL,
    external_id TEXT,
    result      TEXT,
    steps       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);
