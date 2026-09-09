import { cleanName, isInt, register } from '../registry.ts'

/**
 * The lemonade stand.
 *
 * These bounds came over from the game's own `server/src/validate.ts` when the
 * board was split out, and they are unchanged. The one thing worth restating
 * is the reasoning behind the cross-field check: a stand that traded for three
 * days cannot have earned a hundred dollars, and the simulation's best
 * possible day is about $12.50, so $25 a day leaves headroom for a run of luck
 * without leaving room for a typed-in number.
 */

const MAX_CENTS_PER_DAY = 2500
const STARTING_ASSETS = 200
const MAX_GLASSES_PER_DAY = 400
const MAX_DAYS = 365

export const lemonade = register({
  id: 'lemonade',
  // Richest first; a tie goes to whoever did it in fewer days.
  metrics: [
    { key: 'assets', dir: 'desc' },
    { key: 'days', dir: 'asc' },
  ],
  extras: ['glasses', 'broke'],

  validate(raw) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'not an object' }
    const e = raw as Record<string, unknown>

    if (!isInt(e.days, 1, MAX_DAYS)) return { ok: false, why: 'days out of range' }
    if (!isInt(e.assets, 0, 10_000_00)) return { ok: false, why: 'assets out of range' }
    if (!isInt(e.glasses, 0, MAX_DAYS * MAX_GLASSES_PER_DAY))
      return { ok: false, why: 'glasses out of range' }
    if (typeof e.broke !== 'boolean') return { ok: false, why: 'broke must be a boolean' }

    if (e.assets > STARTING_ASSETS + e.days * MAX_CENTS_PER_DAY)
      return { ok: false, why: 'assets impossible for that many days' }
    if (e.glasses > e.days * MAX_GLASSES_PER_DAY)
      return { ok: false, why: 'glasses impossible for that many days' }

    return {
      ok: true,
      entry: {
        name: cleanName(e.name),
        assets: e.assets,
        days: e.days,
        glasses: e.glasses,
        broke: e.broke,
      },
    }
  },
})
