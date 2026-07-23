# Azeroth Arcade

A Discord Embedded Activity trivia game with a React/Vite client, Express + Socket.IO server, and SQLite persistence.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Create a room in one browser and join its code from another browser or private window.

The starter database and sample global questions are created automatically in `data/trivia.db`.

## Discord Activity setup

1. Copy `.env.example` to `.env`, then set `VITE_DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. Leave `VITE_SERVER_URL` empty.
2. `npm run discord` builds the client and serves it with the API on one origin at port 3001.
3. `npm run tunnel` exposes that port over public HTTPS via `cloudflared`.
4. Map `/` to the tunnel hostname under Activities → URL Mappings in the Discord developer portal.

The app detects whether it is running inside Discord and prefixes its requests with `/.proxy` when it is, because Discord routes all activity traffic through its own proxy. Outside Discord the prefix is empty and standalone mode is used automatically.

Inside Discord there are no room codes: everyone who launches the activity in a voice channel shares one Discord instance id, so they all land in the same game automatically. Latecomers can join a game already running, and a player who refreshes or gets suspended rejoins with their score intact.

Set `ADMIN_TOKEN` in `.env` to unlock the question library — those routes expose correct answers, so they are gated. Paste the token into the field in the library header.

See [docs/DISCORD_ACTIVITY.md](docs/DISCORD_ACTIVITY.md) for the full walkthrough and troubleshooting.

## Global question library

Use **Question library** on the landing page to:

- preview and validate JSON question imports;
- upload image clues;
- permanently import questions into SQLite;
- search, disable, reactivate, and delete stored questions.

Questions are selected from one shared library using category, difficulty, and type filters. Multiple-choice distractors are generated from other canonical answers in the same category, with optional answer pools and manual fallbacks.

Image questions can reference multiple public URLs or uploaded paths. One image is selected and stored for each round.

See [docs/QUESTION_AUTHORING.md](docs/QUESTION_AUTHORING.md) for the complete question creation, image upload, validation, import, editing, and troubleshooting guide.

`npm run stats` reports library totals, image coverage, broken image paths, and categories too thin to generate good distractors. Prefer it over the admin panel's counts, which cap at 500 rows.

[docs/ROADMAP.md](docs/ROADMAP.md) tracks the work needed to run this permanently, open it to a whole server, and build out image questions.

## Architecture

- The backend owns all game states, timers, answer validation, elimination scheduling, and scoring.
- Hosts can configure the question timer, answer-results duration, and the visible countdown before the next question starts automatically.
- Socket.IO broadcasts a sanitized room state; correct answers are withheld until reveal.
- SQLite stores the global question library, categories, images, accepted answers, distractors, tags, sessions, rounds, and player answers.
- Game modes share one engine and are selected through `GameSettings.mode`, making additional modes straightforward to add.
