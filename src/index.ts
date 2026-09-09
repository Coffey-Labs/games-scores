import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrateLemonade } from './migrate.ts'
import { known, lookup, type Game } from './registry.ts'
import { BOARD_LIMIT, openStore, type Row } from './store.ts'

// Registering is the import's side effect; the registry is the only index.
import './games/lemonade.ts'
import './games/scan.ts'
import './games/wumpus.ts'

const PORT = Number(process.env.PORT ?? 5184)
const DB_PATH = process.env.DB_PATH ?? './data/scores.db'
/** Behind nginx the socket address is the proxy, so take the forwarded hop. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
const MAX_BODY_BYTES = 4096
const MAX_ENTRIES_PER_POST = 4

/**
 * The board that games.jcoffey.dev shares.
 *
 * One process, one SQLite file, one container, however many games. Each game
 * describes its own board in `src/games/`; everything here is the part that
 * does not vary.
 */

// The migration has to happen before the store creates its own `scores`.
mkdirSync(dirname(DB_PATH), { recursive: true })
const migration = (() => {
  const db = new DatabaseSync(DB_PATH)
  try {
    return migrateLemonade(db)
  } finally {
    db.close()
  }
})()

const store = openStore(DB_PATH)

// ---------------------------------------------------------------- throttle

interface Bucket {
  count: number
  resetAt: number
}
const posts = new Map<string, Bucket>()
const POST_WINDOW_MS = 60 * 60 * 1000
/*
 * Per address, per hour, across every game. Generous on purpose: a classroom,
 * an office or a household all arrive from one address. What keeps rubbish off
 * the boards is each game's plausibility check, not this -- this only stops
 * the database being hammered.
 */
const POST_LIMIT = 120

function overPostLimit(ip: string): boolean {
  const now = Date.now()
  const b = posts.get(ip)
  if (!b || now > b.resetAt) {
    posts.set(ip, { count: 1, resetAt: now + POST_WINDOW_MS })
    return false
  }
  b.count += 1
  return b.count > POST_LIMIT
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, b] of posts) if (now > b.resetAt) posts.delete(ip)
}, POST_WINDOW_MS).unref()

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for']
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

// ------------------------------------------------------------------ replies

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // Public boards, no cookies and no credentials.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Rows go back in the game's own field names, flattened, exactly as its client
 * expects them. That is the bargain that makes a shared service invisible: a
 * game asks for its board and gets `assets` and `days`, or `bagged` and
 * `arrows`, and never has to know it is sharing a table with anybody.
 */
const shape = (rows: Row[]) =>
  rows.map((r) => ({ id: r.id, name: r.name, at: r.at, ...r.fields }))

/**
 * Which game a request is about.
 *
 * There was a shim here that read a missing game as lemonade, because the
 * deployed lemonade bundle predated this service and posted no game at all.
 * That bundle has been rebuilt and is what the site serves now -- both games
 * name themselves on every call -- so the shim has been removed and a request
 * that does not say which board it wants is refused rather than guessed at.
 *
 * Guessing was the right thing while there was something to guess for. It is
 * the wrong thing now: silently filing an unlabelled score under whichever
 * game happened to be first is the sort of default that is invisible until it
 * is wrong, and the caller always knows which game it is.
 */
function gameFor(explicit: unknown): Game | undefined {
  return lookup(explicit)
}

// ------------------------------------------------------------------- routes

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (req.method === 'OPTIONS') return send(res, 204, {})

  if (path === '/api/health') {
    return send(res, 200, { ok: true, games: known() })
  }

  if (path === '/api/games' && req.method === 'GET') {
    return send(res, 200, { games: known() })
  }

  if (path === '/api/scores' && req.method === 'GET') {
    const game = gameFor(url.searchParams.get('game') ?? undefined)
    if (!game) return send(res, 404, { error: `unknown game; try one of: ${known().join(', ')}` })
    return send(res, 200, { game: game.id, scores: shape(store.board(game, BOARD_LIMIT)) })
  }

  if (path === '/api/scores' && req.method === 'POST') {
    const ip = clientIp(req)
    if (overPostLimit(ip)) return send(res, 429, { error: 'too many submissions' })

    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody(req))
    } catch {
      return send(res, 400, { error: 'invalid JSON' })
    }

    const body = (parsed ?? {}) as { game?: unknown; entries?: unknown }
    const game = gameFor(body.game)
    if (!game) return send(res, 404, { error: `unknown game; try one of: ${known().join(', ')}` })

    const list = Array.isArray(parsed) ? parsed : body.entries
    if (!Array.isArray(list)) return send(res, 400, { error: 'expected an array of entries' })
    if (list.length === 0) return send(res, 400, { error: 'no entries' })
    if (list.length > MAX_ENTRIES_PER_POST) return send(res, 400, { error: 'too many entries' })

    // Validate every entry before writing any of them: a party that half
    // posts is worse than one that does not post at all.
    const entries: Record<string, unknown>[] = []
    for (const item of list) {
      const check = game.validate(item)
      if (!check.ok) return send(res, 400, { error: check.why })
      entries.push(check.entry)
    }

    const now = Date.now()
    const ids = entries.map((e) => store.insert(game, e, now))
    store.prune(game)

    return send(res, 201, { game: game.id, ids, scores: shape(store.board(game, BOARD_LIMIT)) })
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  if (migration.migrated) {
    console.log(
      `[scores] migrated ${migration.rows} lemonade rows; old table kept as ${migration.keptAs}`,
    )
  }
  console.log(`[scores] listening on :${PORT}, db ${DB_PATH}, games: ${known().join(', ')}`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.close()
      process.exit(0)
    })
  })
}
