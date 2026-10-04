export const DEFAULT_MIN_SCORE = 60;
export const DEFAULT_RETENTION_DAYS = 400;
export const DEFAULT_CANDIDATE_TTL_DAYS = 21;
const MIN_RETENTION_DAYS = 30;

async function readNumber(env: Env, key: string, def: number): Promise<number> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  const n = row ? Number(row.value) : NaN;
  if (!row || row.value.trim() === '' || !Number.isFinite(n)) {
    console.error(`settings.${key} is not a number (${row ? JSON.stringify(row.value) : 'missing'}); using ${def}`);
    return def;
  }
  return n;
}

export const getMinScore = (env: Env) => readNumber(env, 'min_score', DEFAULT_MIN_SCORE);

// 0 や負数だと候補が全部見送りになるので、下限を 1 日にする
export async function getCandidateTtlDays(env: Env): Promise<number> {
  return Math.max(1, Math.floor(await readNumber(env, 'candidate_ttl_days', DEFAULT_CANDIDATE_TTL_DAYS)));
}

// 打ち間違い(0 や負数)で全消ししないよう下限を設ける
export async function getRetentionDays(env: Env): Promise<number> {
  return Math.max(MIN_RETENTION_DAYS, Math.floor(await readNumber(env, 'retention_days', DEFAULT_RETENTION_DAYS)));
}
