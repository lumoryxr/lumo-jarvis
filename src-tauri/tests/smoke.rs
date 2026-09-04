//! Smoke test for the Store. Runs against a tempdir SQLite file.

use lumo_jarvis_lib::store::{Store, MemoryRow};
use tempfile::tempdir;

#[test]
fn store_roundtrip() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("lumo.sqlite");
    let store = Store::open(&path).expect("open");

    let row = MemoryRow {
        id: "abc".into(),
        kind: "fact".into(),
        content: "user is Lin".into(),
        confidence: 0.95,
        ts: 1_700_000_000,
        source: "told".into(),
        related_to: None,
    };
    store.memory_upsert(&row).expect("upsert");

    let results = store.memory_search("Lin", 10).expect("search");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, "abc");

    let all = store.memory_search("", 10).expect("search all");
    assert_eq!(all.len(), 1);

    store.memory_remove("abc").expect("remove");
    let after = store.memory_search("Lin", 10).expect("search after");
    assert_eq!(after.len(), 0);
}

#[test]
fn persona_kv_roundtrip() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("lumo.sqlite");
    let store = Store::open(&path).expect("open");
    store.persona_set("mood", r#"{"valence":0.4}"#).expect("set");
    let v = store.persona_get("mood").expect("get");
    assert_eq!(v.as_deref(), Some(r#"{"valence":0.4}"#));
}
