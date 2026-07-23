/**
 * Prints the hostname of the cloudflared quick tunnel currently running.
 *
 *   npm run tunnel:url
 *
 * Quick tunnels mint a new hostname every restart, and the Discord URL mapping
 * has to match it. cloudflared serves its own hostname from the local metrics
 * server, so this reads it back rather than making you scroll the log.
 */
import { execSync } from "node:child_process";

function listeningPorts() {
  const ports = new Set();
  try {
    const rows = execSync("netstat -ano", { encoding: "utf8" }).split("\n");
    const pids = new Set();
    for (const row of rows) {
      if (/cloudflared/i.test(row)) continue;
      const match = row.match(/TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (match) {
        ports.add(match[1]);
        pids.add(match[2]);
      }
    }
  } catch {
    // netstat is Windows/most-Unix; fall through to the default probe below.
  }
  // 20241 is cloudflared's default metrics port and covers the common case.
  ports.add("20241");
  return [...ports];
}

const found = [];
for (const port of listeningPorts()) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/quicktunnel`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) continue;
    const body = await response.json();
    if (body?.hostname) found.push(body.hostname);
  } catch {
    // Not a cloudflared metrics server; ignore.
  }
}

const unique = [...new Set(found)];
if (!unique.length) {
  console.error("No running quick tunnel found. Start one with: npm run tunnel");
  process.exit(1);
}

for (const hostname of unique) {
  console.log(`\n  https://${hostname}\n`);
  console.log("  Paste this hostname (without https://) into the Discord");
  console.log("  developer portal under Activities -> URL Mappings, prefix /\n");
}
