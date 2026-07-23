/**
 * Runs the game server and the public tunnel together under one supervisor, and
 * keeps them running.
 *
 *   npm run serve
 *
 * Both processes restart on crash with backoff, the server is health-checked
 * rather than merely assumed alive, and the public hostname is watched so a
 * change is announced loudly instead of silently breaking the Discord activity.
 *
 * Ctrl+C stops everything.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const port = process.env.PORT || "3001";
const ngrokDomain = (process.env.NGROK_DOMAIN || "").trim().replace(/^https?:\/\//, "");
const tunnelHostname = (process.env.TUNNEL_HOSTNAME || "").trim();
const staticHostname = ngrokDomain || tunnelHostname;
const urlFile = ".tunnel-url.txt";

let shuttingDown = false;
const children = new Set();

function stamp() {
  // Wall-clock only; this is a log prefix, not application state.
  return new Date().toISOString().slice(11, 19);
}

function log(source, message) {
  console.log(`${stamp()} [${source}] ${message}`);
}

function banner(lines) {
  const width = Math.max(...lines.map((line) => line.length)) + 4;
  console.log("\n" + "=".repeat(width));
  for (const line of lines) console.log(`  ${line}`);
  console.log("=".repeat(width) + "\n");
}

/**
 * Keeps one child process alive. Backoff climbs on repeated fast failures so a
 * process that cannot start does not spin, and resets once it stays up.
 */
function supervise(name, command, args) {
  let delay = 1000;
  let stopped = false;

  const start = () => {
    if (shuttingDown || stopped) return;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);

    const relay = (stream) => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) log(name, line.trim());
      });
    };
    relay(child.stdout);
    relay(child.stderr);

    const startedAt = Date.now();
    child.on("error", (error) => log(name, `failed to start: ${error.message}`));
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (shuttingDown || stopped) return;
      const alive = Date.now() - startedAt;
      // A process that ran for a while was healthy; treat this as a fresh fault.
      delay = alive > 30_000 ? 1000 : Math.min(delay * 2, 30_000);
      log(name, `exited (${signal || code}); restarting in ${delay / 1000}s`);
      setTimeout(start, delay);
    });
  };

  start();
  return () => { stopped = true; };
}

function resolveBinary(overrideVar, exeName, extraPaths = []) {
  const wingetRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
    : null;
  const fromWinget = wingetRoot && fs.existsSync(wingetRoot)
    ? fs.readdirSync(wingetRoot)
      .filter((entry) => entry.toLowerCase().includes(exeName.toLowerCase()))
      .map((entry) => path.join(wingetRoot, entry, `${exeName}.exe`))
    : [];
  const candidates = [
    process.env[overrideVar],
    ...extraPaths,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", `${exeName}.exe`)
      : null,
    ...fromWinget,
    `/opt/homebrew/bin/${exeName}`,
    `/usr/local/bin/${exeName}`
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || exeName;
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** cloudflared and ngrok both report their public hostname over a local API. */
async function currentHostname() {
  if (staticHostname) return staticHostname;
  const quick = await probe("http://127.0.0.1:20241/quicktunnel");
  if (quick?.hostname) return quick.hostname;
  const ngrok = await probe("http://127.0.0.1:4040/api/tunnels");
  const url = ngrok?.tunnels?.find((tunnel) => tunnel.public_url?.startsWith("https://"))?.public_url;
  return url ? url.replace(/^https:\/\//, "") : null;
}

// ---- start ------------------------------------------------------------------

if (!fs.existsSync("server/dist/index.js") || !fs.existsSync("dist/index.html")) {
  console.error("Build output missing. Run: npm run build");
  process.exit(1);
}

console.log("Azeroth Arcade supervisor");
console.log(`  server : node server/dist/index.js (port ${port})`);
console.log(`  tunnel : ${ngrokDomain ? `ngrok -> ${ngrokDomain}` : "cloudflared"}`);
console.log("  Ctrl+C stops both\n");

supervise("server", process.execPath, ["server/dist/index.js"]);

if (ngrokDomain) {
  const ngrok = resolveBinary("NGROK_PATH", "ngrok", ["C:\\Program Files\\ngrok\\ngrok.exe"]);
  supervise("tunnel", ngrok, ["http", port, `--domain=${ngrokDomain}`, "--log=stdout"]);
} else {
  const cloudflared = resolveBinary("CLOUDFLARED_PATH", "cloudflared", [
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe"
  ]);
  const args = process.env.TUNNEL_NAME
    ? ["tunnel", "--no-autoupdate", "run", "--url", `http://localhost:${port}`, process.env.TUNNEL_NAME]
    : ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`];
  supervise("tunnel", cloudflared, args);
}

// Health check. A process that is running but not serving is still broken.
let lastHealthy = true;
setInterval(async () => {
  const healthy = Boolean(await probe(`http://127.0.0.1:${port}/api/health`));
  if (healthy !== lastHealthy) {
    log("health", healthy ? "server is responding again" : "server is NOT responding");
    lastHealthy = healthy;
  }
}, 10_000);

// Hostname watch. The Discord URL mapping has to match this, so a change is the
// single most important thing to surface.
let announced = null;
setInterval(async () => {
  const hostname = await currentHostname();
  if (!hostname || hostname === announced) return;

  const first = announced === null;
  announced = hostname;
  try { fs.writeFileSync(urlFile, `${hostname}\n`); } catch { /* advisory only */ }

  if (staticHostname) {
    banner([
      `Public URL: https://${hostname}`,
      "This hostname is reserved and will not change.",
      "Set the Discord URL mapping to it once."
    ]);
  } else if (first) {
    banner([
      `Public URL: https://${hostname}`,
      "",
      "Set this as the Discord URL mapping target (prefix /).",
      "It WILL change if the tunnel restarts - watch this window."
    ]);
  } else {
    banner([
      "TUNNEL HOSTNAME CHANGED - the activity is broken until you update it",
      "",
      `New hostname: ${hostname}`,
      "",
      "Discord Developer Portal -> Activities -> URL Mappings",
      "Prefix / , target the hostname above, then restart Discord.",
      "",
      "Set NGROK_DOMAIN in .env to stop this happening."
    ]);
  }
}, 5000);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping...");
  for (const child of children) child.kill();
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
