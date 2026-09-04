//! SQLite-backed persistence. One .sqlite file under the app's data dir.
//!
//! Schema (see apply_migrations() for the full CREATE statements):
//!
//!   memories  (id, kind, content, confidence, ts, source, related_to)
//!   memories_fts (FTS5 virtual table mirroring memories.content)
//!   proposals (id, trigger, reasoning, confidence, expires_at, tone, due_at, created_at)
//!   tasks     (id, title, intent, executor, status, progress, ..., tags JSON, labels JSON, priority, ord)
//!   persona   (key, value, updated_at) -- small KV for mood / emotion / tunables / preset
//!   schema_version
//!
//! We keep `persona` as a KV table so the React-side persona store can hydrate
//! on boot without needing its own per-field migration as the schema evolves.

use crate::error::Result;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRow {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub confidence: f32,
    pub ts: i64,
    pub source: String,
    pub related_to: Option<String>,
}

pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;\
             PRAGMA synchronous = NORMAL;\
             PRAGMA foreign_keys = ON;\
             PRAGMA busy_timeout = 5000;",
        )?;
        let store = Self { conn: Arc::new(Mutex::new(conn)) };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute_batch(include_str!("schema.sql"))?;
        let current: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0),
        )?;
        if current < SCHEMA_VERSION {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                params![SCHEMA_VERSION, chrono::Utc::now().timestamp()],
            )?;
        }
        Ok(())
    }

    pub fn memory_upsert(&self, row: &MemoryRow) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO memories (id, kind, content, confidence, ts, source, related_to)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(id) DO UPDATE SET
                    kind        = excluded.kind,
                    content     = excluded.content,
                    confidence  = excluded.confidence,
                    ts          = excluded.ts,
                    source      = excluded.source,
                    related_to  = excluded.related_to",
            params![row.id, row.kind, row.content, row.confidence,
                     row.ts, row.source, row.related_to],
        )?;
        Ok(())
    }

    pub fn memory_remove(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn memory_search(&self, query: &str, limit: usize) -> Result<Vec<MemoryRow>> {
        let conn = self.conn.lock();
        let q = query.trim();
        let mut out = Vec::new();

        if q.is_empty() {
            let mut stmt = conn.prepare(
                "SELECT id, kind, content, confidence, ts, source, related_to
                 FROM memories ORDER BY ts DESC LIMIT ?1")?;
            let rows = stmt.query_map(params![limit as i64], Self::row_to_memory)?;
            for r in rows { out.push(r?); }
            return Ok(out);
        }

        let mut stmt = conn.prepare(
            "SELECT m.id, m.kind, m.content, m.confidence, m.ts, m.source, m.related_to
             FROM memories m
             WHERE m.rowid IN (
                 SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?1
                 ORDER BY rank LIMIT ?2)
             ORDER BY m.ts DESC")?;
        match stmt.query_map(params![q, limit as i64], Self::row_to_memory) {
            Ok(rows) => { for r in rows { out.push(r?); } }
            Err(_) => {
                let pat = format!("%{}%", q);
                let mut stmt2 = conn.prepare(
                    "SELECT id, kind, content, confidence, ts, source, related_to
                     FROM memories WHERE content LIKE ?1 ORDER BY ts DESC LIMIT ?2")?;
                let rows = stmt2.query_map(params![pat, limit as i64], Self::row_to_memory)?;
                for r in rows { out.push(r?); }
            }
        }
        Ok(out)
    }

    fn row_to_memory(r: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRow> {
        Ok(MemoryRow {
            id: r.get(0)?, kind: r.get(1)?, content: r.get(2)?,
            confidence: r.get(3)?, ts: r.get(4)?,
            source: r.get(5)?, related_to: r.get(6)?,
        })
    }

    pub fn memory_export(&self) -> Result<String> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, kind, content, confidence, ts, source, related_to
             FROM memories ORDER BY ts DESC")?;
        let rows = stmt.query_map([], Self::row_to_memory)?;
        let mut all = Vec::new();
        for r in rows { all.push(r?); }
        Ok(serde_json::to_string(&all)?)
    }

    pub fn memory_clear(&self) -> Result<usize> {
        let conn = self.conn.lock();
        let n = conn.execute("DELETE FROM memories", [])?;
        Ok(n)
    }

    pub fn persona_get(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM persona WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(r) = rows.next()? {
            Ok(Some(r.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn persona_set(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO persona (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, chrono::Utc::now().timestamp()],
        )?;
        Ok(())
    }

    pub fn ping(&self) -> Result<()> { Ok(()) }
}
