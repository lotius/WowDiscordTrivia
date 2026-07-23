/**
 * Reports on the question library: totals, image coverage, and category pools
 * too thin to generate convincing distractors.
 *
 *   npm run stats
 *
 * Reads the database directly rather than the API, because /api/questions caps
 * its result at 500 rows and would silently under-report a larger library.
 */
import fs from "node:fs";
import Database from "better-sqlite3";

const file = process.env.DB_PATH || "data/trivia.db";
if (!fs.existsSync(file)) {
  console.error(`No database at ${file}. Start the server once to create it.`);
  process.exit(1);
}

const db = new Database(file, { readonly: true });
const count = (sql) => db.prepare(sql).get().c;

const total = count("SELECT COUNT(*) c FROM questions");
const images = count("SELECT COUNT(*) c FROM questions WHERE type='image'");
const imageRows = count("SELECT COUNT(*) c FROM question_images");
const orphanImages = count(`
  SELECT COUNT(*) c FROM questions q
  WHERE q.type = 'image'
    AND NOT EXISTS (SELECT 1 FROM question_images qi WHERE qi.question_id = q.id)
`);

console.log("LIBRARY");
console.log(`  questions            ${total}`);
console.log(`    text               ${count("SELECT COUNT(*) c FROM questions WHERE type='text'")}`);
console.log(`    image              ${images}`);
console.log(`  inactive             ${count("SELECT COUNT(*) c FROM questions WHERE is_active=0")}`);
console.log(`  categories           ${count("SELECT COUNT(*) c FROM categories")}`);
console.log(`  accepted answers     ${count("SELECT COUNT(*) c FROM accepted_answers")}`);
console.log(`  manual distractors   ${count("SELECT COUNT(*) c FROM question_distractors")}`);
console.log(`  answer pools         ${count("SELECT COUNT(DISTINCT answer_pool) c FROM questions WHERE answer_pool IS NOT NULL")}`);

console.log("\nIMAGES");
console.log(`  image questions      ${images}`);
console.log(`  image rows           ${imageRows}`);
console.log(`  image questions with no image   ${orphanImages}`);
if (images === 0) console.log("  (no image questions exist yet)");

// A missing file means the round renders a broken image at play time.
const missing = db.prepare("SELECT path FROM question_images WHERE path NOT LIKE 'http%'").all()
  .filter((row) => !fs.existsSync(`.${row.path}`));
if (missing.length) {
  console.log(`  broken local paths   ${missing.length}`);
  for (const row of missing.slice(0, 10)) console.log(`    ${row.path}`);
  if (missing.length > 10) console.log(`    ...and ${missing.length - 10} more`);
}

console.log("\nDIFFICULTY");
for (const row of db.prepare("SELECT difficulty, COUNT(*) c FROM questions GROUP BY difficulty ORDER BY c DESC").all()) {
  console.log(`  ${row.difficulty.padEnd(8)} ${row.c}`);
}

// buildChoices() draws wrong answers from other answers in the same category,
// so a category with few questions produces repetitive or too-obvious options.
console.log("\nTHINNEST CATEGORIES (weak distractor pools)");
const thin = db.prepare(`
  SELECT c.name, COUNT(q.id) n
  FROM categories c
  LEFT JOIN questions q ON q.category_id = c.id AND q.is_active = 1
  GROUP BY c.id HAVING n > 0 ORDER BY n ASC LIMIT 8
`).all();
for (const row of thin) {
  const flag = row.n < 4 ? "  <- too thin for 4 choices" : "";
  console.log(`  ${String(row.n).padStart(3)}  ${row.name}${flag}`);
}

console.log("\nPLAY HISTORY");
console.log(`  sessions             ${count("SELECT COUNT(*) c FROM game_sessions")}`);
console.log(`  rounds               ${count("SELECT COUNT(*) c FROM rounds")}`);
console.log(`  answers recorded     ${count("SELECT COUNT(*) c FROM player_answers")}`);

db.close();
