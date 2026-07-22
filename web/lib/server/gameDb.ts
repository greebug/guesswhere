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
  `);

  // join_code postdates the original lobbies table -- CREATE TABLE IF NOT
  // EXISTS above won't add it to an already-existing table, so migrate it in.
  const lobbyCols = db.prepare('PRAGMA table_info(lobbies)').all() as { name: string }[];
  if (!lobbyCols.some((c) => c.name === 'join_code')) {
    db.exec('ALTER TABLE lobbies ADD COLUMN join_code TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS lobbies_join_code ON lobbies (join_code)');
  }
  return db;
}

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
