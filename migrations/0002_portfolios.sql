ALTER TABLE profile_claims ADD COLUMN story TEXT NOT NULL DEFAULT '';
CREATE TABLE listing_requests (
  github_user_id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
