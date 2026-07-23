/**
 * Starts a cloudflared quick tunnel pointing at the local server.
 *
 * Resolving the binary explicitly rather than relying on PATH: on Windows a
 * terminal opened before cloudflared was installed keeps a stale PATH for its
 * whole lifetime, so `cloudflared` is "not recognized" in that shell even
 * though the install succeeded.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = process.env.PORT || "3001";

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

console.log(`Starting tunnel to http://localhost:${port}`);
console.log(`Using: ${binary}\n`);

const child = spawn(binary, ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], {
  stdio: "inherit"
});

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
