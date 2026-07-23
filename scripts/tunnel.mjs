/**
 * Exposes the local server over public HTTPS with cloudflared.
 *
 * Two modes. Set TUNNEL_NAME in .env to run a named tunnel, which keeps the
 * same hostname forever and so needs the Discord URL mapping set only once.
 * Without it you get a quick tunnel, whose hostname changes on every restart
 * and therefore needs the mapping updated every restart.
 *
 * Resolving the binary explicitly rather than relying on PATH: on Windows a
 * terminal opened before cloudflared was installed keeps a stale PATH for its
 * whole lifetime, so `cloudflared` is "not recognized" in that shell even
 * though the install succeeded.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const port = process.env.PORT || "3001";
const tunnelName = (process.env.TUNNEL_NAME || "").trim();
const tunnelHostname = (process.env.TUNNEL_HOSTNAME || "").trim();

const candidates = [
  process.env.CLOUDFLARED_PATH,
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "cloudflared.exe")
    : null,
  "/opt/homebrew/bin/cloudflared",
  "/usr/local/bin/cloudflared"
].filter(Boolean);

// Fall back to the bare command so a PATH install still works anywhere else.
const binary = candidates.find((candidate) => fs.existsSync(candidate)) || "cloudflared";

const args = tunnelName
  ? ["tunnel", "--no-autoupdate", "run", "--url", `http://localhost:${port}`, tunnelName]
  : ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`];

console.log(`Starting tunnel to http://localhost:${port}`);
console.log(`Using: ${binary}`);
if (tunnelName) {
  console.log(`Named tunnel: ${tunnelName}`);
  if (tunnelHostname) {
    console.log(`Stable URL:   https://${tunnelHostname}`);
    console.log("The Discord URL mapping never needs changing again.\n");
  } else {
    console.log("Set TUNNEL_HOSTNAME in .env so this prints your stable URL.\n");
  }
} else {
  console.log("Quick tunnel: the hostname below changes on every restart, so the");
  console.log("Discord URL mapping must be updated each time. Set TUNNEL_NAME in");
  console.log(".env to use a named tunnel instead.\n");
}

const child = spawn(binary, args, { stdio: "inherit" });

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(
      "\ncloudflared was not found.\n" +
      "Install it with:  winget install -e --id Cloudflare.cloudflared\n" +
      "Already installed? Set CLOUDFLARED_PATH to its full path, or open a new terminal.\n"
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 0));
