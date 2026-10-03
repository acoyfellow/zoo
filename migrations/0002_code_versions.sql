CREATE TABLE code_versions (
  creature_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  code TEXT NOT NULL,
  source TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (creature_id, version)
);
CREATE INDEX code_versions_ip_time ON code_versions (ip_hash, created_at);
