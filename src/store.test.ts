import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { lemonade } from './games/lemonade.ts'
import { wumpus } from './games/wumpus.ts'
import { known, lookup } from './registry.ts'
import { makeStore } from './store.ts'

const store = () => makeStore(new DatabaseSync(':memory:'))
const NOW = 1_700_000_000_000

describe('the registry', () => {
  it('knows both games and nothing else', () => {
    expect(known()).toEqual(['lemonade', 'wumpus'])
    expect(lookup('wumpus')).toBe(wumpus)
    expect(lookup('doom')).toBeUndefined()
    expect(lookup(42)).toBeUndefined()
  })

  /**
   * There is no default game, and there must not be one.
   *
   * A shim used to read a missing game as lemonade, for bundles that predated
   * this service. Now that nothing posts unlabelled, guessing would be worse
   * than refusing: it would file somebody's score under whichever game
   * happened to be first, silently, and nobody would find out until the board
   * looked wrong. These are the shapes a missing game arrives in.
   */
  it('refuses to guess when nothing says which board', () => {
    for (const missing of [undefined, null, '', 0, false, {}, []]) {
      expect(lookup(missing)).toBeUndefined()
    }
  })
})

/**
 * One table, several boards. The thing that would be embarrassing is a game
 * seeing another game's rows, or ranking them by its own rules, so that is
 * what these check.
 */
describe('keeping the boards apart', () => {
  it('never shows one game another game’s rows', () => {
    const s = store()
    s.insert(lemonade, { name: 'ADA', assets: 4000, days: 9, glasses: 500, broke: false }, NOW)
    s.insert(wumpus, { name: 'GRACE', bagged: 3, arrows: 4, roomsWalked: 22, died: null }, NOW)

    expect(s.board(lemonade).map((r) => r.name)).toEqual(['ADA'])
    expect(s.board(wumpus).map((r) => r.name)).toEqual(['GRACE'])
  })

  it('ranks each board by its own rules', () => {
    const s = store()
    // Lemonade: richest first, then fewest days.
    s.insert(lemonade, { name: 'A', assets: 100, days: 3, glasses: 10, broke: false }, NOW)
    s.insert(lemonade, { name: 'B', assets: 900, days: 9, glasses: 10, broke: false }, NOW)
    s.insert(lemonade, { name: 'C', assets: 900, days: 4, glasses: 10, broke: false }, NOW)
    expect(s.board(lemonade).map((r) => r.name)).toEqual(['C', 'B', 'A'])

    // Wumpus: most bagged, then most arrows left, then fewest rooms.
    s.insert(wumpus, { name: 'X', bagged: 1, arrows: 5, roomsWalked: 2, died: null }, NOW)
    s.insert(wumpus, { name: 'Y', bagged: 4, arrows: 1, roomsWalked: 90, died: 'eaten' }, NOW)
    s.insert(wumpus, { name: 'Z', bagged: 4, arrows: 1, roomsWalked: 40, died: 'eaten' }, NOW)
    expect(s.board(wumpus).map((r) => r.name)).toEqual(['Z', 'Y', 'X'])
  })

  it('trims one board without touching the other', () => {
    const s = store()
    s.insert(lemonade, { name: 'KEEP', assets: 9000, days: 2, glasses: 10, broke: false }, NOW)
    for (let i = 0; i < 3; i++) {
      s.insert(wumpus, { name: `W${i}`, bagged: i, arrows: 1, roomsWalked: 5, died: null }, NOW)
    }
    s.prune(wumpus)
    expect(s.board(lemonade).map((r) => r.name)).toEqual(['KEEP'])
  })

  it('gives every field back under the name its client uses', () => {
    const s = store()
    s.insert(wumpus, { name: 'ADA', bagged: 3, arrows: 2, roomsWalked: 41, died: 'eaten' }, NOW)
    expect(s.board(wumpus)[0]!.fields).toEqual({
      bagged: 3,
      arrows: 2,
      roomsWalked: 41,
      died: 'eaten',
    })
  })
})

describe('what each game will accept', () => {
  it('refuses a lemonade stand that earned more than it could have', () => {
    const v = lemonade.validate({ name: 'X', assets: 100000, days: 2, glasses: 10, broke: false })
    expect(v.ok).toBe(false)
  })

  it('refuses a hunter with more arrows than anyone starts with', () => {
    const v = wumpus.validate({ name: 'X', bagged: 0, arrows: 6, roomsWalked: 5, died: null })
    expect(v.ok).toBe(false)
  })

  it('refuses a hunter who ran out of arrows and kept some', () => {
    const v = wumpus.validate({
      name: 'X',
      bagged: 0,
      arrows: 3,
      roomsWalked: 5,
      died: 'out-of-arrows',
    })
    expect(v.ok).toBe(false)
  })

  it('refuses an ending the game cannot produce', () => {
    const v = wumpus.validate({ name: 'X', bagged: 0, arrows: 1, roomsWalked: 5, died: 'ascended' })
    expect(v.ok).toBe(false)
  })

  it('cleans a name rather than refusing it', () => {
    const v = wumpus.validate({
      name: '  <script>ada</script>  ',
      bagged: 0,
      arrows: 1,
      roomsWalked: 5,
      died: null,
    })
    expect(v.ok).toBe(true)
    // Both tags contribute their letters, and then it is cut to twelve.
    expect(v.ok && v.entry.name).toBe('SCRIPTADASCR')
  })

  it('falls back to ANON rather than storing nothing', () => {
    const v = wumpus.validate({ name: '!!!', bagged: 0, arrows: 1, roomsWalked: 5, died: null })
    expect(v.ok && v.entry.name).toBe('ANON')
  })
})
