import { DatabaseSync } from 'node:sqlite';

// Direct ESM `node:sqlite` import, not a nested `require` -- see grader.ts's
// comment on why Turbopack's CJS interop breaks on that specific combination.

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = process.env.GAME_DB_PATH;
  if (!dbPath) throw new Error('GAME_DB_PATH env var is not set (see web/.env.local)');
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_created_at ON games (created_at);
    CREATE TABLE IF NOT EXISTS lobbies (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lobbies_created_at ON lobbies (created_at);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    -- Partial index: NULL emails don't collide, so accounts without one are
    -- unconstrained while a real address can only ever belong to one user.
    CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL;

    -- Only sha256(token) is ever stored, so a dump of this table can't be
    -- replayed as a live session cookie.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens (user_id);

    -- A finished game's record. Deliberately a self-contained snapshot rather
    -- than a reference into the games table: that's what lets the prune sweep
    -- drop old sessions without taking leaderboard entries or profile history
    -- with them.
    CREATE TABLE IF NOT EXISTS game_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_population INTEGER NOT NULL,
      only_coast INTEGER NOT NULL,
      total_ms INTEGER NOT NULL,
      eligible INTEGER NOT NULL,
      rounds_json TEXT NOT NULL,
      finished_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS game_results_user ON game_results (user_id, finished_at);
    CREATE INDEX IF NOT EXISTS game_results_board
      ON game_results (target_population, only_coast, eligible, total_ms);
  `);

  // join_code postdates the original lobbies table -- CREATE TABLE IF NOT
  // EXISTS above won't add it to an already-existing table, so migrate it in.
  const lobbyCols = db.prepare('PRAGMA table_info(lobbies)').all() as { name: string }[];
  if (!lobbyCols.some((c) => c.name === 'join_code')) {
    db.exec('ALTER TABLE lobbies ADD COLUMN join_code TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS lobbies_join_code ON lobbies (join_code)');
  }

  pruneOnce(db);
  return db;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export function putGame(id: string, data: string, createdAt: number): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO games (id, data, created_at) VALUES (?, ?, ?)')
    .run(id, data, createdAt);
}

export function readGame(id: string): string | null {
  const row = getDb().prepare('SELECT data FROM games WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row?.data ?? null;
}

// ---------------------------------------------------------------------------
// Duel lobbies
// ---------------------------------------------------------------------------

export function putLobby(id: string, data: string, createdAt: number, joinCode: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO lobbies (id, data, created_at, join_code) VALUES (?, ?, ?, ?)')
    .run(id, data, createdAt, joinCode);
}

export function readLobby(id: string): string | null {
  const row = getDb().prepare('SELECT data FROM lobbies WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row?.data ?? null;
}

export function readLobbyByJoinCode(joinCode: string): string | null {
  const row = getDb().prepare('SELECT data FROM lobbies WHERE join_code = ?').get(joinCode) as
    | { data: string }
    | undefined;
  return row?.data ?? null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  username_lower: string;
  password_hash: string;
  email: string | null;
  email_verified: number;
  created_at: number;
}

export function insertUser(user: UserRow): void {
  getDb()
    .prepare(
      `INSERT INTO users (id, username, username_lower, password_hash, email, email_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      user.id,
      user.username,
      user.username_lower,
      user.password_hash,
      user.email,
      user.email_verified,
      user.created_at
    );
}

export function readUserByUsername(usernameLower: string): UserRow | null {
  return (getDb().prepare('SELECT * FROM users WHERE username_lower = ?').get(usernameLower) ??
    null) as UserRow | null;
}

export function readUserById(id: string): UserRow | null {
  return (getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null) as UserRow | null;
}

/** Case-insensitive: addresses are matched lowercased everywhere, so
 * `Bob@x.com` and `bob@x.com` can't become two accounts. */
export function readUserByEmail(email: string): UserRow | null {
  return (getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) ?? null) as UserRow | null;
}

export function updateUserEmail(userId: string, email: string | null, verified: boolean): void {
  getDb()
    .prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ?')
    .run(email, verified ? 1 : 0, userId);
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function insertSession(
  tokenHash: string,
  userId: string,
  createdAt: number,
  expiresAt: number
): void {
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, createdAt, expiresAt);
}

export function readSessionUser(tokenHash: string, now: number): UserRow | null {
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, now);
  return (row ?? null) as UserRow | null;
}

export function deleteSession(tokenHash: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/** Every device, not just this one -- what a password reset is for. */
export function deleteSessionsForUser(userId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---------------------------------------------------------------------------
// Email tokens
// ---------------------------------------------------------------------------

export interface EmailTokenRow {
  token_hash: string;
  user_id: string;
  kind: string;
  email: string;
  expires_at: number;
  used_at: number | null;
}

export function insertEmailToken(row: EmailTokenRow): void {
  getDb()
    .prepare(
      `INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(row.token_hash, row.user_id, row.kind, row.email, row.expires_at, row.used_at);
}

export function readEmailToken(tokenHash: string): EmailTokenRow | null {
  return (getDb().prepare('SELECT * FROM email_tokens WHERE token_hash = ?').get(tokenHash) ??
    null) as EmailTokenRow | null;
}

export function markEmailTokenUsed(tokenHash: string, usedAt: number): void {
  getDb().prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?').run(usedAt, tokenHash);
}

/** Supersedes any outstanding token of the same kind, so requesting a second
 * reset link immediately invalidates the first. */
export function deleteEmailTokens(userId: string, kind: string): void {
  getDb().prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
}

// ---------------------------------------------------------------------------
// Game results
// ---------------------------------------------------------------------------

export interface GameResultRow {
  id: string;
  user_id: string;
  target_population: number;
  only_coast: number;
  total_ms: number;
  eligible: number;
  rounds_json: string;
  finished_at: number;
}

export function insertGameResult(row: GameResultRow): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO game_results
       (id, user_id, target_population, only_coast, total_ms, eligible, rounds_json, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.user_id,
      row.target_population,
      row.only_coast,
      row.total_ms,
      row.eligible,
      row.rounds_json,
      row.finished_at
    );
}

export function readGameResult(id: string): (GameResultRow & { username: string }) | null {
  const row = getDb()
    .prepare(
      `SELECT r.*, u.username FROM game_results r JOIN users u ON u.id = r.user_id WHERE r.id = ?`
    )
    .get(id);
  return (row ?? null) as (GameResultRow & { username: string }) | null;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  total_ms: number;
  finished_at: number;
}

export function readLeaderboard(
  targetPopulation: number,
  onlyCoast: boolean,
  limit: number
): LeaderboardEntry[] {
  return getDb()
    .prepare(
      `SELECT r.id, u.username, r.total_ms, r.finished_at
       FROM game_results r JOIN users u ON u.id = r.user_id
       WHERE r.target_population = ? AND r.only_coast = ? AND r.eligible = 1
       ORDER BY r.total_ms ASC LIMIT ?`
    )
    .all(targetPopulation, onlyCoast ? 1 : 0, limit) as unknown as LeaderboardEntry[];
}

export function readUserResults(userId: string, limit: number): GameResultRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM game_results WHERE user_id = ? ORDER BY finished_at DESC LIMIT ?`
    )
    .all(userId, limit) as unknown as GameResultRow[];
}

export interface UserStats {
  games: number;
  eligible: number;
  avg_ms: number | null;
  best_ms: number | null;
}

export function readUserStats(userId: string): UserStats {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS games,
              SUM(eligible) AS eligible,
              AVG(total_ms) AS avg_ms,
              MIN(CASE WHEN eligible = 1 THEN total_ms END) AS best_ms
       FROM game_results WHERE user_id = ?`
    )
    .get(userId) as { games: number; eligible: number | null; avg_ms: number | null; best_ms: number | null };
  return {
    games: row.games,
    eligible: row.eligible ?? 0,
    avg_ms: row.avg_ms,
    best_ms: row.best_ms,
  };
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

const LOBBY_TTL_MS = 24 * 60 * 60 * 1000; // duels are finished within minutes
const GAME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // also the "Share Cities" link lifetime

// `games` and `lobbies` grew unbounded from day one, which is where the
// volume's ~94MB went. Dropping a game row does NOT affect leaderboards,
// result pages, or profile history -- game_results rows are self-contained
// snapshots by design (see the CREATE TABLE comment above). The one real
// consequence is that a "Share Cities" link stops working after 30 days.
function pruneOnce(database: DatabaseSync): void {
  const now = Date.now();
  try {
    database.prepare('DELETE FROM lobbies WHERE created_at < ?').run(now - LOBBY_TTL_MS);
    database.prepare('DELETE FROM games WHERE created_at < ?').run(now - GAME_TTL_MS);
    database.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    database.prepare('DELETE FROM email_tokens WHERE expires_at < ?').run(now);
    // Deleting rows only frees pages back to SQLite's own freelist -- the file
    // itself stays at its high-water mark until a VACUUM rewrites it, which is
    // the part that actually gives disk back to the volume.
    database.exec('VACUUM');
  } catch (e) {
    // A prune failure must never take the app down with it -- the data it
    // removes is disposable by definition.
    console.warn('prune sweep failed:', e);
  }
}

/** Re-runs the sweep if a day has passed. Cheap enough to call per request;
 * the process is long-lived on Railway, so startup-only would never fire
 * again on a server that stays up for weeks. */
let lastPruneAt = Date.now();
export function pruneIfDue(): void {
  if (Date.now() - lastPruneAt < 24 * 60 * 60 * 1000) return;
  lastPruneAt = Date.now();
  pruneOnce(getDb());
}
