import fs from 'node:fs';
import path from 'node:path';

// Persisted across server restarts and across every game, not just the
// session that reported it -- "doesn't get selected in the future" means
// globally, not just for the reporter. A flat JSON file is deliberately
// simple: this is a short, slow-growing list (bad-imagery reports), not
// game data that needs querying, so a real database would be overkill.
const FILE_PATH = path.join(process.cwd(), 'data', 'reported-cities.json');

let cache: Set<number> | null = null;

function load(): Set<number> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')) as number[];
    cache = new Set(raw);
  } catch {
    cache = new Set(); // no file yet -- first run, or a fresh checkout
  }
  return cache;
}

export function getReportedIds(): Set<number> {
  return load();
}

export function addReportedId(cityId: number): void {
  const set = load();
  if (set.has(cityId)) return;
  set.add(cityId);
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify([...set].sort((a, b) => a - b), null, 1));
}
