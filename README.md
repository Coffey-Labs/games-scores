# games-scores

One leaderboard service for every game on [games.jcoffey.dev](https://games.jcoffey.dev).

A single Node process with SQLite, no build step and no native modules:
`node:sqlite` ships with the runtime and Node runs the TypeScript directly.
One container and one volume, however many games there are.

## Why this is its own repository

The games repository's rule is that anything belonging to a game lives in that
game's own repository. A shared board belongs to no game, and putting it in one
of them would mean every other game depending on that one for its leaderboard.

It is AGPL for the same reason the games are: §13 is about network services,
and this *is* the network service. Anyone running a modified copy of it for
other people has to offer them its source, and each game's own source offer can
point here for the board.

## Adding a game

One file in `src/games/`, and an import in `src/index.ts`. Nothing else — not
the schema, not the routes, not the deployment.

```ts
export const wumpus = register({
  id: 'wumpus',
  metrics: [
    { key: 'bagged', dir: 'desc' },
    { key: 'arrows', dir: 'desc' },
    { key: 'roomsWalked', dir: 'asc' },
  ],
  extras: ['died'],
  validate(raw) { /* refuse the impossible; return the game's own fields */ },
})
```

`metrics` are the ranked columns in ranking order, one to three of them.
`extras` are shown but never ranked. Whatever `validate` returns is handed
straight back to that game's client under those names, so a game's client never
has to know this service is shared.

## How the storage works

One table, and it does not know what a glass of lemonade is:

```
scores(id, game, name, m1, m2, m3, extra, created_at)
```

Three ranked integer columns and a JSON bag, because every board here is "sort
by a couple of numbers, show a couple more". The registry decides what `m1`
means for a given game, so adding a game is never a migration.

The generic half is deliberately generic and the knowledge is deliberately not.
Generic storage *with generic validation* would be a wall anybody can write
anything on. Each game says what is impossible in its own terms — a lemonade
stand that earned more than its days allow, a hunter carrying six arrows when
nobody starts with more than five — and that is the most a board with no
accounts has ever been able to offer.

## API

| Method | Path                       | Purpose                                     |
| ------ | -------------------------- | ------------------------------------------- |
| GET    | `/api/health`              | liveness, and which games are registered    |
| GET    | `/api/games`               | the registered game ids                     |
| GET    | `/api/scores?game=<id>`    | that game's top 50, best first              |
| POST   | `/api/scores`              | submit 1–4 players from one finished run    |

```jsonc
// POST /api/scores
{ "game": "wumpus",
  "entries": [ { "name": "ADA", "bagged": 3, "arrows": 2,
                 "roomsWalked": 41, "died": "eaten" } ] }
// 201 -> { "game": "wumpus", "ids": ["17"], "scores": [ ...that board... ] }
```

Every entry in a post is validated before any of them is written: a party that
half-posts is worse than one that does not post at all.

### The missing-game shim

A request with no `game` is treated as `lemonade`. That is a compatibility
shim, not a default worth keeping — the deployed lemonade bundle posts no game
at all, because when it was built there was only one board, and copies of it
are sitting in people's browsers. It can go once that bundle has been rebuilt
and redeployed, and not before, or every score set from a cached page lands
nowhere.

## The migration

The volume this service mounts already held a database, written by lemonade's
own scores service, with one table shaped for one game. On first boot against
that shape the rows are copied across and **the old table is renamed rather
than dropped**, to `scores_lemonade_v1`.

Renamed, because a leaderboard is the only copy of itself. A few kilobytes is
the difference between a bad migration being an afternoon and being an apology
to everybody who was on the board. Delete it by hand later, once the new board
has been up long enough to be believed.

It runs in one transaction and it is idempotent — an already-migrated database
does not have the old shape — and it says what it did in the log, because a
migration nobody notices is a migration nobody notices going wrong.
`migrate.test.ts` exercises it against a database built to the old schema
column for column, and checks the thing that actually matters: that the board
comes back out ranked the way it went in.

## Running it

```
npm install
npm test
npm run dev        # :5184, database in ./data
```

| Variable      | Default             | Meaning                             |
| ------------- | ------------------- | ----------------------------------- |
| `PORT`        | `5184`              | listen port                         |
| `DB_PATH`     | `./data/scores.db`  | SQLite file; the only writable path |
| `TRUST_PROXY` | unset               | `1` to read `x-forwarded-for`       |

The container runs read-only apart from `/data`, which is a named volume and
must survive a redeploy — it is the boards.

## What a board with no accounts can promise

Not much, and it is better to say so.

There are no accounts, no tokens and no replay verification. Anyone who can
reach this endpoint can post to it, so **nothing here proves a run happened**.
What it does is refuse the impossible, keep names printable and short, and rate
limit per address so the database cannot be hammered. Beyond that the honest
defence is that there is nothing to win.

## Licence

AGPL-3.0-or-later — see [LICENSE](LICENSE). Copyright (C) 2026 John Coffey.
