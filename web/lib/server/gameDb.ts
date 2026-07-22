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
  `);
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
