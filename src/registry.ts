/**
 * What the service knows about each game.
 *
 * The storage is deliberately generic and the knowledge is deliberately not.
 * Every board ranks on a small number of integers and shows a few more, so
 * rows are stored as three ranked columns and a bag of extras -- but *which*
 * integers, which direction they rank, what is plausible and what the client
 * expects them called are all per-game, and all of it lives here.
 *
 * A board with no accounts cannot prove a score is real. What it can do is
 * refuse the impossible, and "impossible" is a fact about a particular game.
 * Generic storage with no game-specific validation would be a wall anybody can
 * write anything on; this is a wall anybody can write *plausible* things on,
 * which is the most a leaderboard like this has ever offered.
 */

export type Direction = 'desc' | 'asc'

/** One ranked column: where it comes from, and which way is better. */
export interface Metric {
  /** The field name the game's own client uses. */
  key: string
  dir: Direction
}

export interface Game {
  id: string
  /**
   * Up to three, in ranking order. Ties beyond the last are broken by which
   * arrived first, which is the only fair answer left.
   */
  metrics: Metric[]
  /**
   * Check one submitted entry and return it in the game's own field names,
   * or say why not. Everything it returns is trusted from then on, so this is
   * the only place hostile input stops being hostile.
   */
  validate(raw: unknown): { ok: true; entry: Record<string, unknown> } | { ok: false; why: string }
  /**
   * Fields kept for display but never ranked on. Whatever `validate` returned
   * under these names is stored as JSON and handed straight back.
   */
  extras: string[]
}

const registry = new Map<string, Game>()

export function register(game: Game): Game {
  if (game.metrics.length < 1 || game.metrics.length > 3) {
    throw new Error(`${game.id}: a board ranks on one to three columns`)
  }
  registry.set(game.id, game)
  return game
}

export const lookup = (id: unknown): Game | undefined =>
  typeof id === 'string' ? registry.get(id) : undefined

export const known = (): string[] => [...registry.keys()].sort()

// ---------------------------------------------------------------- helpers

export const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

export const NAME_MAX = 12

/** Printable, uppercase, and short enough to fit any of the boards. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return 'ANON'
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 .'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
  return cleaned || 'ANON'
}
