/**
 * Exposes the local server over public HTTPS.
 *
 * Three modes, chosen from .env. The first two keep one hostname permanently,
 * so the Discord URL mapping is configured once and survives restarts:
 *
 *   NGROK_DOMAIN   ngrok with a reserved static domain (free tier allows one)
 *   TUNNEL_NAME    cloudflared named tunnel (needs a domain on Cloudflare)
 *   neither        cloudflared quick tunnel - NEW HOSTNAME EVERY RESTART
 *
 * Resolving binaries by path rather than trusting PATH: on Windows a terminal
 * opened before the install keeps a stale PATH for its whole lifetime, so the
 * command is "not recognized" in that shell even though the install worked.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const port = process.env.PORT || "3001";
const ngrokDomain = (process.env.NGROK_DOMAIN || "").trim().replace(/^https?:\/\//, "");
const tunnelName = (process.env.TUNNEL_NAME || "").trim();
const tunnelHostname = (process.env.TUNNEL_HOSTNAME || "").trim();

/**
 * winget sometimes installs into a versioned package folder without adding a
 * shim to Links, so search there too rather than reporting "not found" for
 * something that is demonstrably installed.
 */
function wingetPackagePaths(exeName) {
  const root = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
    : null;
  if (!root || !fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root)
      .filter((entry) => entry.toLowerCase().includes(exeName.toLowerCase()))
      .map((entry) => path.join(root, entry, `${exeName}.exe`));
  } catch {
    return [];
  }
}

function resolveBinary(overrideVar, exeName, extraPaths = []) {
  const candidates = [
    process.env[overrideVar],
    ...extraPaths,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", `${exeName}.exe`)
      : null,
    ...wingetPackagePaths(exeName),
    `/opt/homebrew/bin/${exeName}`,
    `/usr/local/bin/${exeName}`
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || exeName;
}

let binary;
let args;
let installHint;

if (ngrokDomain) {
  binary = resolveBinary("NGROK_PATH", "ngrok", [
    "C:\\Program Files\\ngrok\\ngrok.exe",
    "C:\\ProgramData\\chocolatey\\bin\\ngrok.exe"
  ]);
  args = ["http", port, `--domain=${ngrokDomain}`, "--log=stdout"];
  installHint =
    "Install it with:  winget install -e --id ngrok.ngrok\n" +
    "Then authenticate: ngrok config add-authtoken <your token>";
  console.log(`Starting ngrok tunnel to http://localhost:${port}`);
  console.log(`Using:      ${binary}`);
  console.log(`Stable URL: https://${ngrokDomain}`);
  console.log("This hostname never changes. Set the Discord URL mapping once.\n");
} else {
  binary = resolveBinary("CLOUDFLARED_PATH", "cloudflared", [
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe"
  ]);
  args = tunnelName
    ? ["tunnel", "--no-autoupdate", "run", "--url", `http://localhost:${port}`, tunnelName]
    : ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`];
  installHint = "Install it with:  winget install -e --id Cloudflare.cloudflared";

  console.log(`Starting cloudflared tunnel to http://localhost:${port}`);
  console.log(`Using: ${binary}`);
  if (tunnelName) {
    console.log(`Named tunnel: ${tunnelName}`);
    console.log(tunnelHostname
      ? `Stable URL:   https://${tunnelHostname}\nThe Discord URL mapping never needs changing again.\n`
      : "Set TUNNEL_HOSTNAME in .env so this prints your stable URL.\n");
  } else {
    console.log("Quick tunnel: the hostname below changes on EVERY restart, so the");
    console.log("Discord URL mapping must be updated each time. Set NGROK_DOMAIN or");
    console.log("TUNNEL_NAME in .env for a hostname that stays put.\n");
  }
}

const child = spawn(binary, args, { stdio: "inherit" });

child.on("error", (error) => {
  console.error(
    error.code === "ENOENT"
      ? `\n${path.basename(String(binary))} was not found.\n${installHint}\n`
      : String(error)
  );
  process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 0));
