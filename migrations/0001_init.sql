CREATE TABLE creatures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  code TEXT NOT NULL,
  model TEXT NOT NULL,
  parent_a TEXT,
  parent_b TEXT,
  ip_hash TEXT NOT NULL,
  fate TEXT NOT NULL DEFAULT 'alive',
  created_at INTEGER NOT NULL
);
CREATE INDEX creatures_ip_time ON creatures (ip_hash, created_at);
CREATE TABLE encounters (
  id TEXT PRIMARY KEY,
  a_id TEXT NOT NULL,
  b_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  probabilities TEXT NOT NULL,
  child_id TEXT,
  created_at INTEGER NOT NULL
);
