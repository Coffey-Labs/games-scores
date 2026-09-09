import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Game } from './registry.ts'

/**
 * One table for every board.
 *
 * Three ranked integer columns and a JSON bag, because every leaderboard here
 * is "sort by a couple of numbers, show a couple more". Storing each game's
 * fields under their own names would mean a migration every time a game is
 * added; storing them positionally means the registry decides what m1 is and
 * the database never has to care.
 *
 * `m3` is nullable: a game that ranks on two columns leaves it empty, and
 * SQLite sorts NULLs consistently within a single game's rows because they are
 * either all null or none are.
 */

export interface Row {
  id: string
  name: string
  at: number
  /** The game's own field names, ready to hand back to its client. */
  fields: Record<string, unknown>
}

/** Rows kept per game. The board only ever shows the top of this. */
const KEEP_ROWS = 500
export const BOARD_LIMIT = 50

/** Open a file. The service does this once, at boot. */
export function openStore(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true })
  return makeStore(new DatabaseSync(dbPath))
}

/**
 * The reader and writer, over a handle somebody else opened.
 *
 * Split out from `openStore` so tests can point it at a database they built
 * themselves -- in particular the one the migration has just finished with.
 * A test that reimplemented the ordering to check the ordering would pass
 * whether or not this file was right, which is no test at all.
 */
export function makeStore(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      game       TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      m1         INTEGER NOT NULL,
      m2         INTEGER,
      m3         INTEGER,
      extra      TEXT    NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scores_game ON scores (game, created_at);
  `)

  /**
   * `ORDER BY` is built from the game rather than parameterised, because a
   * column name and a direction cannot be bound as parameters. Nothing from a
   * request reaches it: the directions come from a literal union and the
   * column names are the fixed strings m1/m2/m3, so the only thing the caller
   * influences is *which registered game*, and an unregistered one never gets
   * this far.
   */
  const orderFor = (game: Game): string => {
    const cols = game.metrics
      .map((m, i) => `m${i + 1} ${m.dir === 'desc' ? 'DESC' : 'ASC'}`)
      .join(', ')
    return `${cols}, created_at ASC`
  }

  const toRow = (game: Game, r: Record<string, unknown>): Row => {
    const fields: Record<string, unknown> = {}
    game.metrics.forEach((m, i) => {
      fields[m.key] = r[`m${i + 1}`] as number
    })
    // Anything that was only ever for display comes back out of the bag.
    const extra = JSON.parse(String(r.extra ?? '{}')) as Record<string, unknown>
    for (const key of game.extras) fields[key] = extra[key] ?? null
    return { id: String(r.id), name: r.name as string, at: r.created_at as number, fields }
  }

  return {
    db,

    board(game: Game, limit = BOARD_LIMIT): Row[] {
      const rows = db
        .prepare(
          `SELECT id, name, m1, m2, m3, extra, created_at
             FROM scores WHERE game = ? ORDER BY ${orderFor(game)} LIMIT ?`,
        )
        .all(game.id, limit) as Record<string, unknown>[]
      return rows.map((r) => toRow(game, r))
    },

    insert(game: Game, entry: Record<string, unknown>, now: number): string {
      const m = game.metrics.map((metric) => entry[metric.key] as number)
      const extra: Record<string, unknown> = {}
      for (const key of game.extras) extra[key] = entry[key] ?? null

      const info = db
        .prepare(
          `INSERT INTO scores (game, name, m1, m2, m3, extra, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          game.id,
          String(entry.name),
          m[0]!,
          m[1] ?? null,
          m[2] ?? null,
          JSON.stringify(extra),
          now,
        )
      return String(info.lastInsertRowid)
    },

    /** Trim one game's rows without touching anybody else's. */
    prune(game: Game): void {
      db.prepare(
        `DELETE FROM scores WHERE game = ? AND id NOT IN (
           SELECT id FROM scores WHERE game = ? ORDER BY ${orderFor(game)} LIMIT ?
         )`,
      ).run(game.id, game.id, KEEP_ROWS)
    },

    close: () => db.close(),
  }
}

export type Store = ReturnType<typeof openStore>
