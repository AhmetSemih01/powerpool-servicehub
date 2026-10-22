CREATE TABLE registration_challenges (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, value TEXT NOT NULL, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE INDEX registration_expiry ON registration_challenges(expires);
CREATE TABLE registration_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
CREATE TABLE account_emails (email TEXT PRIMARY KEY, user_key TEXT UNIQUE NOT NULL);
