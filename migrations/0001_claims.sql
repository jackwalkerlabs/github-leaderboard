CREATE TABLE profile_claims (
  github_user_id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  featured_projects TEXT NOT NULL DEFAULT '[]',
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
