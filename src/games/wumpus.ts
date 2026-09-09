import { cleanName, isInt, register } from '../registry.ts'

/**
 * Hunt the wumpus.
 *
 * Easier to bound than the lemonade stand, because almost nothing in it is
 * open-ended. You start with five arrows and gain at most one per kill, capped
 * at five; the four ways a hunt can end are the only four there are; and a
 * hunter who ran out of arrows cannot have any left. Each of those is a claim
 * this can check.
 */

const STARTING_ARROWS = 5
const MAX_BAGGED = 999
const MAX_ROOMS = 100_000

const DEATHS = new Set(['eaten', 'fell-in-a-pit', 'shot-yourself', 'out-of-arrows'])

export const wumpus = register({
  id: 'wumpus',
  // Most bagged, then arrows they never needed, then rooms they never walked.
  metrics: [
    { key: 'bagged', dir: 'desc' },
    { key: 'arrows', dir: 'desc' },
    { key: 'roomsWalked', dir: 'asc' },
  ],
  extras: ['died'],

  validate(raw) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'not an object' }
    const e = raw as Record<string, unknown>

    if (!isInt(e.bagged, 0, MAX_BAGGED)) return { ok: false, why: 'bagged out of range' }
    if (!isInt(e.arrows, 0, STARTING_ARROWS)) return { ok: false, why: 'arrows out of range' }
    if (!isInt(e.roomsWalked, 0, MAX_ROOMS)) return { ok: false, why: 'rooms out of range' }
    if (e.died !== null && (typeof e.died !== 'string' || !DEATHS.has(e.died)))
      return { ok: false, why: 'unknown ending' }

    // The two fields look independent and are not.
    if (e.died === 'out-of-arrows' && e.arrows > 0)
      return { ok: false, why: 'out of arrows with arrows left' }
    if (e.bagged > 1 && e.roomsWalked === 0)
      return { ok: false, why: 'bagged more than one without moving' }

    return {
      ok: true,
      entry: {
        name: cleanName(e.name),
        bagged: e.bagged,
        arrows: e.arrows,
        roomsWalked: e.roomsWalked,
        died: (e.died as string | null) ?? null,
      },
    }
  },
})
