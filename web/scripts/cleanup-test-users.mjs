// Remove the throwaway accounts (and everything hanging off them) that the
// verification scripts created in the local dev DB.
import { DatabaseSync } from 'node:sqlite';
import { GAME_DB } from './env.mjs';
const db = new DatabaseSync(GAME_DB);

const pattern = "username LIKE 'alice\\_%' ESCAPE '\\' OR username LIKE 't\\_%' ESCAPE '\\' OR username LIKE 'mailer\\_%' ESCAPE '\\'";
const users = db.prepare(`SELECT id, username FROM users WHERE ${pattern}`).all();
console.log(`removing ${users.length} test account(s): ${users.map((u) => u.username).join(', ')}`);

for (const u of users) {
  db.prepare('DELETE FROM game_results WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
}

const left = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const results = db.prepare('SELECT COUNT(*) AS n FROM game_results').get().n;
console.log(`remaining: ${left} user(s), ${results} game result(s)`);
db.close();
