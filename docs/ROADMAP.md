# Roadmap

Working document for taking Azeroth Arcade from "runs on Rich's laptop behind a
tunnel" to "a thing people in a Discord server can just play".

Status snapshot below was taken 2026-07-22. Regenerate it any time with
`npm run stats`.

---

## Where things stand

**Working today**

- Plays end to end inside Discord as an Activity, verified with real players.
- Everyone launching the Activity in a voice channel lands in the same room
  automatically — no codes to exchange.
- Latecomers join games in progress; a refresh or an iframe suspend rejoins with
  scores intact.
- Question library is gated behind `ADMIN_TOKEN`, so players cannot read the
  answer key.
- Two smoke suites cover the code-based and Activity join paths.

**The library, measured rather than assumed**

| | |
| --- | --- |
| Questions | **508** (507 text, **1 image**) |
| Categories | 19 |
| Accepted answers / manual distractors | 716 / 1521 |
| Answer pools | 26 |
| Difficulty | medium 319, hard 133, easy 56 |
| Games played so far | 33 sessions, 138 rounds, 157 answers |

Note: `/api/questions` caps at 500 rows, so the admin UI under-reports a library
this size. `npm run stats` reads the database directly and is the number to
trust.

**Known broken**

- Question 8, the only image question, points at
  `/uploads/deadmines-entrance.jpg` and `/uploads/deadmines-ship.jpg`. Neither
  file exists — it is the example from the admin panel's JSON template,
  imported for real. **Disabled on 2026-07-23** so it cannot be drawn, and the
  engine now refuses to serve image questions whose files are missing. Re-enable
  it once the two images are uploaded.

**Corrected after measuring**

An earlier draft claimed the five near-empty categories (Geography, Science,
Video Games, Fantasy, World of Warcraft) could not fill four choices. That was
wrong. Each of their questions carries three manual distractors, which is
exactly what `buildChoices` needs, and no active text question in the library
falls short:

```
questions that cannot offer 4 choices: none
```

They are still odd as categories — one question each, and off-theme for a
Warcraft trivia game — but they are not broken, and removing them would remove
working content.

---

## Phase 1 — Run it permanently

Today the game only exists while Rich's laptop is awake, `npm start` is running,
and a tunnel terminal is open. Quick-tunnel hostnames also change on every
restart, which has already broken the Activity once.

**What "permanent" requires**

- [ ] A host that is always on. Node 20+.
- [ ] **Persistent disk.** `data/trivia.db` and `uploads/` must survive restarts
      and redeploys. This rules out platforms with ephemeral filesystems unless
      a volume is attached — a container that resets its disk loses the entire
      question library.
- [ ] A stable HTTPS hostname, set once in the Discord URL mapping.
- [ ] Auto-restart on crash and on boot.
- [x] Backups of `data/trivia.db`. `npm run backup` writes a timestamped
      snapshot to `data/backups/` using SQLite's online backup, which is safe to
      run mid-game — a plain file copy during a write can capture a torn
      database. Still needs scheduling so it happens without being remembered.

**Options**

| Approach | Cost | Notes |
| --- | --- | --- |
| Small VPS (Hetzner, DigitalOcean, Linode) | ~$4-6/mo | Full control, persistent disk by default, needs manual setup and patching |
| Fly.io / Railway / Render | free tier to ~$5/mo | Faster to deploy; **must attach a volume** or SQLite is wiped on redeploy |
| Keep the laptop, add a named tunnel | free | Stable URL, but only up when the laptop is. Needs a domain |

Named-tunnel support is already in `scripts/tunnel.mjs` — set `TUNNEL_NAME` and
`TUNNEL_HOSTNAME` in `.env`. It needs a domain in a Cloudflare account.

**Also needed once it is long-lived**

- [ ] Rooms live in memory. Restarting the server drops every game in progress.
      Acceptable for occasional play; worth revisiting if it becomes annoying.
- [ ] Rotate `ADMIN_TOKEN` off the value generated during setup.
- [ ] Decide log retention — currently everything goes to the console and is
      lost when the process restarts.

**Open decision:** which host. Nothing else in this phase can start until that
is picked.

---

## Phase 2 — Open it to everyone in the server

The goal: any member of the server can launch the Activity and play against
whoever else is in the voice channel.

- [ ] **Confirm who can currently launch it.** While an app is unpublished,
      Discord restricts launching to the app's team and testers. This has not
      been tested with a non-tester yet — Rich has only played with himself and
      people who may already have access. *This is the single most important
      unknown in this document.* If it blocks ordinary members, everything else
      here is decoration.
- [ ] If it does block them: add members as testers (fine for a handful) or
      submit to the App Directory (makes the app public and invites review).
- [ ] Decide whether the app should be public at all. A private game for one
      server has very different obligations than a listed one — see Phase 3 on
      image licensing.

**Nice to have once people are actually playing**

- [ ] Per-player stats that survive a session (games played, accuracy, best
      streak). The schema already records `players`, `game_sessions`, `rounds`
      and `player_answers`, so the data is being collected — nothing reads it
      back yet.
- [ ] A server leaderboard. Needs `guild_id` captured at join time; Discord
      provides it in the activity query string and it is currently ignored.
- [ ] Let a non-host start the next round if the host disappears. Host migration
      exists on disconnect but has not been exercised much.

---

## Phase 3 — Image questions

This is the largest content gap: **one image question exists and it is broken.**

**Decide first — where do the images come from?**

This choice constrains everything downstream, including whether the app can ever
be public.

- Screenshots taken in-game
- Official Blizzard art and promotional assets
- Community wikis and databases
- Something drawn or generated

Blizzard's art is copyrighted. A private game among friends is one thing; a
listed App Directory entry distributing the same images is another, and the
answer likely differs per source. Worth settling deliberately rather than
discovering it later.

**Then the pipeline**

- [x] Stop broken images reaching players. Question 8 is disabled, unservable
      images are filtered during hydration, image questions with no usable image
      are excluded from selection, and imports referencing missing files are
      refused. `npm run stats` still reports the broken paths so they are not
      forgotten; `npm run smoke:images` guards the behaviour.
- [ ] Gather a first batch — 20-30 images is enough to tell whether image rounds
      are fun before investing further.
- [ ] Decide sizing and format. Uploads cap at 8 MB and accept PNG, JPEG, WebP,
      GIF. WebP at a sane resolution keeps the library small and loads fast in
      the iframe.
- [ ] Write alt text for each. `question_images.alt_text` exists and is unused;
      it is also the only thing a screen-reader user gets.
- [ ] **Bulk import.** The admin panel uploads one file at a time and makes you
      paste each returned path into JSON by hand. That is fine for five images
      and miserable for fifty. A script that ingests a folder and emits import
      JSON is worth writing before the first big batch, not after.

**Design questions worth answering before bulk work**

- Multiple images per question already works and one is picked at random per
  round. Is that interesting, or should a question always show the same image?
- Should image questions be their own game mode rather than mixed into the
  standard pool?
- Zoomed-in crops that widen over the timer would suit `elimination` mode. Fun,
  but it is a new mechanic, not a content task.

---

## Phase 4 — Content quality

Cheap fixes, real effect on how the game feels.

- [ ] Decide what to do with the five near-empty categories (Geography, Science,
      Video Games, Fantasy, World of Warcraft). They play fine — see the
      correction above — but they are off-theme and clutter the category filter.
      Merging beats deleting, since the questions themselves work.
- [ ] Rebalance difficulty. Easy is 11% of the library, medium is 63%. A game
      filtered to easy has 56 questions to draw on and will repeat quickly.
- [ ] Consider a "no repeats within a session" rule. `chooseQuestions` uses
      `available[index % available.length]`, so a round count higher than the
      matching pool repeats questions within a single game.
- [ ] Spot-check answers for accuracy. 508 questions have never been reviewed
      against a source, and a wrong answer key is worse than a missing question.

---

## Deliberately not doing yet

Recorded so they stay decisions rather than oversights.

- Publishing to the App Directory — only if Phase 2 forces it.
- Moving off SQLite. It is a good fit at this scale; revisit only if the game
  runs on more than one server process.
- Voice or video features from the Embedded App SDK.
- Custom question packs per Discord server.

---

## Next action

Phase 2's first checkbox — verifying whether an ordinary server member can
launch the Activity — is the cheapest test here and gates the most. Ask one
friend who is not a tester to try launching it, and note what they see.
