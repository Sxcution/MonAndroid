CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adb_device_id TEXT UNIQUE,
  status TEXT,
  resolution TEXT,  
  battery INTEGER DEFAULT 0,
  android_version TEXT,
  last_seen INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS device_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS group_devices (
  group_id TEXT,
  device_id TEXT,
  PRIMARY KEY (group_id, device_id),
  FOREIGN KEY (group_id) REFERENCES device_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  action_type TEXT,
  params TEXT,
  status TEXT,
  result TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT,
  devices_included TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS macros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  actions TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_action_logs_device ON action_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_status ON action_logs(status);
