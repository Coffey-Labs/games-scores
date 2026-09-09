import { cleanName, isInt, register } from '../registry.ts'

/**
 * Long Range Scan.
 *
 * Bounded on every side, which makes this the easiest of the three to check.
 * A galaxy is eight by eight quadrants holding at most three raiders each, a
 * patrol is issued twenty-five to thirty-five days, and nobody has ever
 * carried an eleventh torpedo. The clock is the interesting one: a patrol
 * that ended because time ran out cannot have time left on it, and that is a
 * claim about two fields at once rather than about either.
 *
 * Days are whole here and shown to a tenth in the game. The board's ranked
 * columns are integers -- see `store.ts`, where that is the whole point of
 * storing them positionally -- and a tie-break finer than a day would be
 * measuring the dice rather than the captain.
 */

const START_TORPEDOES = 10
/** Twenty-five days, plus up to ten. */
const MAX_DAYS = 35
/** Three to a quadrant, sixty-four quadrants, and that is the ceiling. */
const MAX_RAIDERS = 192

const ENDINGS = new Set([
  'mission-complete',
  'out-of-time',
  'destroyed',
  'stranded',
  'resigned',
  'base-destroyed',
])

export const scan = register({
  id: 'scan',
  // Most destroyed, then the days they did not need, then the torpedoes.
  metrics: [
    { key: 'killed', dir: 'desc' },
    { key: 'daysLeft', dir: 'desc' },
    { key: 'torpedoes', dir: 'desc' },
  ],
  extras: ['ending'],

  validate(raw) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'not an object' }
    const e = raw as Record<string, unknown>

    if (!isInt(e.killed, 0, MAX_RAIDERS)) return { ok: false, why: 'killed out of range' }
    if (!isInt(e.daysLeft, 0, MAX_DAYS)) return { ok: false, why: 'days out of range' }
    if (!isInt(e.torpedoes, 0, START_TORPEDOES))
      return { ok: false, why: 'torpedoes out of range' }
    if (e.ending !== null && (typeof e.ending !== 'string' || !ENDINGS.has(e.ending)))
      return { ok: false, why: 'unknown ending' }

    // The fields look independent and are not.
    if (e.ending === 'out-of-time' && e.daysLeft > 0)
      return { ok: false, why: 'out of time with time left' }
    if (e.ending === 'mission-complete' && e.killed === 0)
      return { ok: false, why: 'cleared a galaxy without destroying anything' }

    return {
      ok: true,
      entry: {
        name: cleanName(e.name),
        killed: e.killed,
        daysLeft: e.daysLeft,
        torpedoes: e.torpedoes,
        ending: (e.ending as string | null) ?? null,
      },
    }
  },
})
