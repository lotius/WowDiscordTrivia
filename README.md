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

1. Copy `.env.example` to `.env`.
2. Set `VITE_DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
3. Configure the Discord developer portal Activity URL mapping to your public HTTPS tunnel or deployment.
4. Set `CLIENT_ORIGIN` to the client origin when the server and client are served separately.

The app detects whether it is running inside Discord. Outside Discord it automatically uses standalone mode.

## Global question library

Use **Question library** on the landing page to:

- preview and validate JSON question imports;
- upload image clues;
- permanently import questions into SQLite;
- search, disable, reactivate, and delete stored questions.

Questions are selected from one shared library using category, difficulty, and type filters. Multiple-choice distractors are generated from other canonical answers in the same category, with optional answer pools and manual fallbacks.

Image questions can reference multiple public URLs or uploaded paths. One image is selected and stored for each round.

See [docs/QUESTION_AUTHORING.md](docs/QUESTION_AUTHORING.md) for the complete question creation, image upload, validation, import, editing, and troubleshooting guide.

## Architecture

- The backend owns all game states, timers, answer validation, elimination scheduling, and scoring.
- Hosts can configure the question timer, answer-results duration, and the visible countdown before the next question starts automatically.
- Socket.IO broadcasts a sanitized room state; correct answers are withheld until reveal.
- SQLite stores the global question library, categories, images, accepted answers, distractors, tags, sessions, rounds, and player answers.
- Game modes share one engine and are selected through `GameSettings.mode`, making additional modes straightforward to add.
