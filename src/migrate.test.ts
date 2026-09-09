import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateLemonade } from './migrate.ts'
import { lemonade } from './games/lemonade.ts'
import { makeStore } from './store.ts'

/**
 * The migration runs exactly once, against the only copy of a board that real
 * people are on. It is not a thing to find out about in production, so it is
 * exercised here against a database built to the old shape -- the shape the
 * lemonade stand's own service created, column for column.
 */

const OLD_SCHEMA = `
  CREATE TABLE scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    assets     INTEGER NOT NULL,
    days       INTEGER NOT NULL,
    glasses    INTEGER NOT NULL,
    seed       INTEGER NOT NULL,
    broke      INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`

/** A database as the old service would have left it. */
function oldDatabase(rows: [string, number, number, number, number, number, number][]) {
  const db = new DatabaseSync(':memory:')
  db.exec(OLD_SCHEMA)
  const insert = db.prepare(
    `INSERT INTO scores (name, assets, days, glasses, seed, broke, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows) insert.run(...r)
  return db
}

const SAMPLE: [string, number, number, number, number, number, number][] = [
  // name, assets, days, glasses, seed, broke, created_at
  ['ADA', 4635, 12, 800, 111, 0, 1_700_000_000_000],
  ['GRACE', 4635, 9, 640, 222, 0, 1_700_000_001_000],
  ['ALAN', 120, 4, 90, 333, 1, 1_700_000_002_000],
]

describe('bringing the lemonade board across', () => {
  it('moves every row', () => {
    const db = oldDatabase(SAMPLE)
    const result = migrateLemonade(db)
    expect(result.migrated).toBe(true)
    expect(result.rows).toBe(SAMPLE.length)

    const count = db.prepare(`SELECT COUNT(*) AS n FROM scores`).get() as { n: number }
    expect(count.n).toBe(SAMPLE.length)
  })

  it('files them all under lemonade', () => {
    const db = oldDatabase(SAMPLE)
    migrateLemonade(db)
    const games = db.prepare(`SELECT DISTINCT game FROM scores`).all() as { game: string }[]
    expect(games.map((g) => g.game)).toEqual(['lemonade'])
  })

  /**
   * The point of the whole exercise: the board has to come back out ranked
   * the way it went in. GRACE and ADA are tied on assets, and GRACE took
   * fewer days, so GRACE was above ADA before and must be above ADA after.
   */
  it('keeps the order the board was already in', () => {
    const db = oldDatabase(SAMPLE)
    migrateLemonade(db)
    // The real reader, over the migrated database.
    const board = makeStore(db).board(lemonade)
    expect(board.map((r) => r.name)).toEqual(['GRACE', 'ADA', 'ALAN'])
  })

  it('hands the fields back under the names the client expects', () => {
    const db = oldDatabase(SAMPLE)
    migrateLemonade(db)
    const [top] = makeStore(db).board(lemonade)
    expect(top!.fields).toEqual({ assets: 4635, days: 9, glasses: 640, broke: false })
  })

  /** Nothing is thrown away; the old table is still there under a new name. */
  it('keeps the old table rather than dropping it', () => {
    const db = oldDatabase(SAMPLE)
    const result = migrateLemonade(db)
    expect(result.keptAs).toBe('scores_lemonade_v1')
    const kept = db.prepare(`SELECT COUNT(*) AS n FROM scores_lemonade_v1`).get() as { n: number }
    expect(kept.n).toBe(SAMPLE.length)
  })

  it('does nothing to a database that has already been migrated', () => {
    const db = oldDatabase(SAMPLE)
    migrateLemonade(db)
    const again = migrateLemonade(db)
    expect(again.migrated).toBe(false)
    const count = db.prepare(`SELECT COUNT(*) AS n FROM scores`).get() as { n: number }
    expect(count.n).toBe(SAMPLE.length)
  })

  it('does nothing to a database that was never the old shape', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrateLemonade(db).migrated).toBe(false)
  })
})
