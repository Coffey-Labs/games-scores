import type { DatabaseSync } from 'node:sqlite'

/**
 * Bringing the lemonade stand's board across.
 *
 * The volume this service mounts already holds a database, and it holds real
 * scores that real people set. It was written by the game's own scores
 * service, which had one table shaped for one game:
 *
 *   scores(id, name, assets, days, glasses, seed, broke, created_at)
 *
 * This service wants the generic shape instead. So on the first boot against
 * an old database, the rows are copied across and the old table is *renamed
 * rather than dropped*.
 *
 * Renamed, because the whole point of a leaderboard is that it is the only
 * copy. `scores_lemonade_v1` costs a few kilobytes and is the difference
 * between a bad migration being an afternoon and being a shrug and an apology
 * to everybody who was on the board. Delete it by hand, later, once the new
 * board has been up long enough to be believed.
 *
 * Idempotent: it looks for the old shape, and an already-migrated database
 * does not have it.
 */

const OLD = 'scores'
const KEPT = 'scores_lemonade_v1'

interface TableInfo {
  name: string
}

const tables = (db: DatabaseSync): string[] =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as TableInfo[]).map(
    (t) => t.name,
  )

const columns = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

/** The old table is the one with `assets` in it and no `game`. */
function needsMigrating(db: DatabaseSync): boolean {
  if (!tables(db).includes(OLD)) return false
  const cols = columns(db, OLD)
  return cols.includes('assets') && !cols.includes('game')
}

export interface MigrationResult {
  migrated: boolean
  rows: number
  keptAs?: string
}

/**
 * Must run before the new schema is created, because both want the name
 * `scores`. Returns what it did so the caller can say so in the log -- a
 * migration that happens silently is one nobody notices went wrong.
 */
export function migrateLemonade(db: DatabaseSync): MigrationResult {
  if (!needsMigrating(db)) return { migrated: false, rows: 0 }

  const old = db
    .prepare(`SELECT id, name, assets, days, glasses, broke, created_at FROM ${OLD}`)
    .all() as Record<string, unknown>[]

  // One transaction: either every score comes across or the old table is
  // still sitting there untouched under its original name.
  db.exec('BEGIN')
  try {
    db.exec(`ALTER TABLE ${OLD} RENAME TO ${KEPT}`)
    db.exec(`
      CREATE TABLE scores (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        game       TEXT    NOT NULL,
        name       TEXT    NOT NULL,
        m1         INTEGER NOT NULL,
        m2         INTEGER,
        m3         INTEGER,
        extra      TEXT    NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
    `)

    const insert = db.prepare(
      `INSERT INTO scores (game, name, m1, m2, m3, extra, created_at)
       VALUES ('lemonade', ?, ?, ?, NULL, ?, ?)`,
    )
    for (const r of old) {
      // m1 = assets, m2 = days: the order the lemonade board has always
      // ranked in. glasses and broke were shown, never ranked, so they go in
      // the bag. `seed` is dropped -- it was recorded and never read back,
      // and a migration is the right moment to stop carrying it.
      insert.run(
        String(r.name),
        Number(r.assets),
        Number(r.days),
        JSON.stringify({ glasses: Number(r.glasses), broke: r.broke === 1 }),
        Number(r.created_at),
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { migrated: true, rows: old.length, keptAs: KEPT }
}
