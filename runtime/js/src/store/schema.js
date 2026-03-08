const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS message_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  peer_id TEXT NOT NULL,
  message_id TEXT,
  msg_ts INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  preview TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MQTT',
  a2a_message_id TEXT,
  target_session_id TEXT,
  target_session_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_event_msg_id
  ON message_event(message_id)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_event_peer_hash
  ON message_event(peer_id, hash);

CREATE TABLE IF NOT EXISTS push_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_outbox_status_retry
  ON push_outbox(status, next_retry_at);

CREATE TABLE IF NOT EXISTS a2a_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  trace_id TEXT,
  target_agent_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  qos INTEGER NOT NULL DEFAULT 1,
  envelope_json TEXT NOT NULL,
  source_session_id TEXT,
  source_session_key TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_a2a_outbox_status_retry
  ON a2a_outbox(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_a2a_outbox_target_trace
  ON a2a_outbox(target_agent_id, trace_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_a2a_outbox_target_updated
  ON a2a_outbox(target_agent_id, updated_at);

CREATE TABLE IF NOT EXISTS peer_session_route (
  peer_id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT,
  session_key TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_peer_session_route_updated
  ON peer_session_route(updated_at);

CREATE TABLE IF NOT EXISTS consumer_ack (
  consumer_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  acked_at INTEGER NOT NULL,
  PRIMARY KEY (consumer_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_consumer_ack_event_id
  ON consumer_ack(event_id);

CREATE TABLE IF NOT EXISTS summary_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  session_key TEXT,
  channel TEXT NOT NULL,
  to_target TEXT NOT NULL,
  account_id TEXT,
  thread_id TEXT,
  summary_text TEXT NOT NULL,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summary_outbox_status_retry
  ON summary_outbox(status, next_retry_at);
`;

function columnExists(db, tableName, columnName) {
  const stmt = db.prepare(`PRAGMA table_info(${tableName});`);
  const rows = stmt.all();
  return rows.some((row) => String(row.name) === columnName);
}

function tableExists(db, tableName) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`
  ).get(tableName);
  return row != null;
}

function applySchema(db) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec(SCHEMA_SQL);

  if (!columnExists(db, "message_event", "source")) {
    db.exec("ALTER TABLE message_event ADD COLUMN source TEXT NOT NULL DEFAULT 'IM';");
  }
  if (!columnExists(db, "message_event", "a2a_message_id")) {
    db.exec("ALTER TABLE message_event ADD COLUMN a2a_message_id TEXT;");
  }
  if (!columnExists(db, "message_event", "target_session_id")) {
    db.exec("ALTER TABLE message_event ADD COLUMN target_session_id TEXT;");
  }
  if (!columnExists(db, "message_event", "target_session_key")) {
    db.exec("ALTER TABLE message_event ADD COLUMN target_session_key TEXT;");
  }
  if (columnExists(db, "message_event", "a2a_message_id")) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_message_event_a2a_message_id
        ON message_event(a2a_message_id)
        WHERE a2a_message_id IS NOT NULL;
    `);
  }
  if (!columnExists(db, "a2a_outbox", "trace_id")) {
    db.exec("ALTER TABLE a2a_outbox ADD COLUMN trace_id TEXT;");
  }
  if (!columnExists(db, "a2a_outbox", "source_session_id")) {
    db.exec("ALTER TABLE a2a_outbox ADD COLUMN source_session_id TEXT;");
  }
  if (!columnExists(db, "a2a_outbox", "source_session_key")) {
    db.exec("ALTER TABLE a2a_outbox ADD COLUMN source_session_key TEXT;");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_a2a_outbox_target_trace
      ON a2a_outbox(target_agent_id, trace_id, updated_at);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_a2a_outbox_target_updated
      ON a2a_outbox(target_agent_id, updated_at);
  `);

  // summary_outbox migration for existing databases
  if (!tableExists(db, "summary_outbox")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS summary_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        session_key TEXT,
        channel TEXT NOT NULL,
        to_target TEXT NOT NULL,
        account_id TEXT,
        thread_id TEXT,
        summary_text TEXT NOT NULL,
        media_url TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_summary_outbox_status_retry
        ON summary_outbox(status, next_retry_at);
    `);
  } else if (!columnExists(db, "summary_outbox", "media_url")) {
    db.exec("ALTER TABLE summary_outbox ADD COLUMN media_url TEXT;");
  }
}

module.exports = {
  applySchema,
};
