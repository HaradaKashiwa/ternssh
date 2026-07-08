export interface UserAiSettingsRecord {
  user_id: string;
  api_base_url: string;
  api_key: string;
  model: string;
  updated_at: string;
}

export interface UserAiSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_USER_AI_SETTINGS: UserAiSettings = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "") || DEFAULT_USER_AI_SETTINGS.apiBaseUrl;
}

function toSettings(record: UserAiSettingsRecord | null): UserAiSettings {
  if (!record) return { ...DEFAULT_USER_AI_SETTINGS };
  return {
    apiBaseUrl: normalizeBaseUrl(record.api_base_url),
    apiKey: record.api_key ?? "",
    model: record.model.trim() || DEFAULT_USER_AI_SETTINGS.model,
  };
}

export async function getUserAiSettings(
  db: D1Database,
  userId: string,
): Promise<UserAiSettings> {
  const row = await db
    .prepare(
      `SELECT user_id, api_base_url, api_key, model, updated_at
       FROM user_ai_settings
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<UserAiSettingsRecord>();

  return toSettings(row);
}

export async function updateUserAiSettings(
  db: D1Database,
  userId: string,
  input: UserAiSettings,
): Promise<UserAiSettings> {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const apiKey = input.apiKey;
  const model = input.model.trim() || DEFAULT_USER_AI_SETTINGS.model;

  await db
    .prepare(
      `INSERT INTO user_ai_settings (user_id, api_base_url, api_key, model, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         api_base_url = excluded.api_base_url,
         api_key = excluded.api_key,
         model = excluded.model,
         updated_at = datetime('now')`,
    )
    .bind(userId, apiBaseUrl, apiKey, model)
    .run();

  return getUserAiSettings(db, userId);
}

export async function deleteUserAiSettings(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM user_ai_settings WHERE user_id = ?")
    .bind(userId)
    .run();
}
