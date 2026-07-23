/**
 * Snapshots the question library.
 *
 *   npm run backup
 *
 * Uses SQLite's online backup rather than copying the file. A plain copy taken
 * while the server is writing can capture a torn database; this cannot, and it
 * is safe to run with a game in progress.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const source = process.env.DB_PATH || "data/trivia.db";
if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

const dir = process.env.BACKUP_DIR || "data/backups";
fs.mkdirSync(dir, { recursive: true });

// A backup contains every correct answer and every player record. This
// repository is public, so refuse to write one somewhere git would pick it up.
const ignore = fs.existsSync(".gitignore") ? fs.readFileSync(".gitignore", "utf8") : "";
if (!ignore.split(/\r?\n/).some((line) => line.trim() === "data/backups/")) {
  console.error("Refusing to write a backup: 'data/backups/' is not in .gitignore.");
  process.exit(1);
}

// Timestamp is only a filename; the database is the state that matters.
const now = new Date();
const label = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = path.join(dir, `trivia-${label}.db`);

const db = new Database(source, { readonly: true });
await db.backup(target);
const questions = db.prepare("SELECT COUNT(*) c FROM questions").get().c;
db.close();

console.log(`Backed up ${questions} questions to ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
