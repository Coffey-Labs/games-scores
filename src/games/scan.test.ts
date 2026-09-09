import { describe, expect, it } from 'vitest'
import { scan } from './scan.ts'

/**
 * The cross-field rules are the ones worth a test: a single column out of
 * range is a one-line check that reads correctly, and two columns that
 * contradict each other is where a board with no accounts actually earns its
 * keep.
 */

const good = { name: 'ADA', killed: 4, daysLeft: 9, torpedoes: 3, ending: 'resigned' }

const why = (over: Record<string, unknown>) => {
  const r = scan.validate({ ...good, ...over })
  return r.ok ? null : r.why
}

describe('a plausible patrol', () => {
  it('is taken, and comes back in the game’s own field names', () => {
    const r = scan.validate(good)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entry).toEqual({
        name: 'ADA',
        killed: 4,
        daysLeft: 9,
        torpedoes: 3,
        ending: 'resigned',
      })
    }
  })

  it('may have ended with nothing left, or with everything left', () => {
    expect(why({ killed: 0, daysLeft: 0, torpedoes: 0, ending: 'destroyed' })).toBeNull()
    expect(why({ killed: 0, daysLeft: 35, torpedoes: 10, ending: 'resigned' })).toBeNull()
  })
})

describe('the impossible', () => {
  it('refuses days and torpedoes nobody was issued', () => {
    expect(why({ daysLeft: 36 })).toBe('days out of range')
    expect(why({ torpedoes: 11 })).toBe('torpedoes out of range')
    expect(why({ killed: 193 })).toBe('killed out of range')
  })

  it('refuses a fraction of a day, because the columns are integers', () => {
    expect(why({ daysLeft: 9.4 })).toBe('days out of range')
  })

  it('refuses an ending nobody could have had', () => {
    expect(why({ ending: 'ascended' })).toBe('unknown ending')
  })

  it('refuses running out of time with time on the clock', () => {
    expect(why({ ending: 'out-of-time', daysLeft: 4 })).toBe('out of time with time left')
    expect(why({ ending: 'out-of-time', daysLeft: 0 })).toBeNull()
  })

  it('refuses clearing a galaxy that never had anything in it', () => {
    expect(why({ ending: 'mission-complete', killed: 0 })).toBe(
      'cleared a galaxy without destroying anything',
    )
  })
})
