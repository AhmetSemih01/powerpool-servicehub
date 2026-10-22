ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin';
CREATE INDEX sessions_user ON sessions(user_id);
