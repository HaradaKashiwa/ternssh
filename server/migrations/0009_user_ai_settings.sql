CREATE TABLE user_ai_settings (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  api_key      TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
