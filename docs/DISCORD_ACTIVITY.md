# Running Azeroth Arcade as a Discord Activity

Standalone mode needs nothing but `npm run dev`. Running inside Discord needs
four things lined up at once: a Discord application, a public HTTPS URL, a URL
mapping that points one at the other, and a client build that knows its own
application ID.

## Why the code needs a proxy prefix

Discord does not load your server directly. It serves the activity in an iframe
at `https://<application_id>.discordsays.com` and routes every outbound request
through its own proxy. The proxy only forwards paths that begin with `/.proxy`,
and it strips that prefix before passing the request to whatever your URL
mapping points at — so the browser asks for `/.proxy/api/health` and your
Express server receives `/api/health`.

That is what [`src/environment.ts`](../src/environment.ts) exists for. It
detects the embedded context from Discord's `frame_id` query parameter and
prefixes REST calls, Socket.IO's endpoint, and relative image paths
accordingly. Outside Discord the prefix is empty, so the same build works in a
plain browser.

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> and create a New
   Application.
2. Under **OAuth2**, copy the **Client ID**. Generate/reset the **Client
   Secret** and copy it too — Discord shows a secret only once.
3. Find the Activities section and enable Activities for the application. The
   portal reorganises this area periodically; look for "Activities" in the left
   sidebar and turn on the toggle that makes the app launchable.

## 2. Fill in `.env`

`.env` already exists with the right keys and is gitignored. Fill in the two
blanks yourself:

```
VITE_DISCORD_CLIENT_ID=your_application_id
DISCORD_CLIENT_SECRET=your_client_secret
```

Leave `VITE_SERVER_URL` **empty**. Inside Discord the client and API share one
origin through the proxy; a hardcoded URL there breaks the iframe.

`VITE_DISCORD_CLIENT_ID` is baked into the bundle at build time, so you must
rebuild after changing it.

## 3. Build and serve on one origin

```bash
npm run discord
```

That is `npm run build && npm start`. Express then serves the built client and
the API together on port 3001, which is what the tunnel needs — one origin, one
mapping.

## 4. Open a public HTTPS tunnel

In a second terminal:

```bash
npm run tunnel
```

`cloudflared` prints a URL like `https://random-words-here.trycloudflare.com`.
Copy the hostname.

Quick tunnels are anonymous and free but **the URL changes every restart**. Each
restart means updating the URL mapping in step 5. A named Cloudflare tunnel on a
domain you own gives a stable URL if this stops being fun.

## 5. Point Discord at the tunnel

In the portal, under Activities → **URL Mappings**, add a root mapping:

| Prefix | Target |
| --- | --- |
| `/` | `random-words-here.trycloudflare.com` |

Enter the hostname only — no `https://`, no trailing slash. The root mapping
covers the client bundle, the REST routes, Socket.IO, and `/uploads` in one go.

## 6. Launch it

Join a voice channel in a server where your app is installed, open the activity
launcher, and pick your app. Anyone else in that voice channel can then join the
running activity — that is how your friends get in; they do not need the
developer portal or the tunnel URL.

While the app is unpublished, Discord restricts who can launch it. If friends
cannot see it, add them under the application's testers/team list in the portal.

## How joining works inside Discord

There are no room codes in Discord. Everyone who launches the activity in a
voice channel receives the same Discord `instance_id`, and the server keys the
room off that, so the first person to open it hosts and everyone after joins
automatically. Friends click the activity and land in your game.

Two consequences worth knowing:

- **Latecomers can join a game in progress.** They start at zero rather than
  being turned away, which is what the code-based flow does.
- **A refresh or suspend does not cost anyone their score.** Players are matched
  on their Discord user id rather than their socket, so a returning client is
  rebound to its existing player. Discord suspends activity iframes routinely,
  so this matters more here than in a browser. An empty room is held for two
  minutes before it is discarded, so everyone dropping at once is survivable.

`npm run smoke:activity` exercises all of this against a local server without
Discord: same-instance joining, a mid-game reconnect keeping its score, and a
latecomer joining a running game.

## Protecting the question library

The library routes expose every correct answer, so they require the
`ADMIN_TOKEN` from `.env`. Open **Question library**, paste the token into the
field in the header, and it is remembered in that browser. The token is never
part of the client bundle, so players who launch the activity cannot read it —
which matters because without the gate, any player could open devtools and
request the whole answer key.

## Troubleshooting

**Activity loads a blank screen.** Open the activity's devtools
(`Ctrl+Shift+I` in the Discord desktop client). A failed request to a path
without the `/.proxy` prefix means something is bypassing `apiUrl()` in
`src/environment.ts`.

**"Discord SDK unavailable; using standalone mode" in the console.** Either
`VITE_DISCORD_CLIENT_ID` was empty at build time, or you did not rebuild after
setting it. Re-run `npm run discord`.

**Socket connects locally but not in Discord.** Confirm `VITE_SERVER_URL` is
empty in `.env` and rebuild. A baked-in `http://localhost:3001` is unreachable
from the iframe.

**Images in questions do not load.** Uploaded images (`/uploads/...`) are
proxied automatically. Questions pointing at fully qualified external URLs are
subject to Discord's content security policy and will not load unless that host
has its own URL mapping. Prefer uploaded images for Discord play.

**502 from the tunnel.** The tunnel is up but nothing is listening on 3001 —
start `npm run discord` first.
