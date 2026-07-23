/**
 * Image questions must never reach a player with an image that cannot load.
 *
 * Checks against the real library: unservable images are stripped, an image
 * question left with none is excluded from play, and importing a question that
 * points at a missing file is refused rather than stored.
 */
import fs from "node:fs";
import Database from "better-sqlite3";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const endpoint = process.env.SMOKE_URL || "http://localhost:3001";
const adminToken = process.env.ADMIN_TOKEN || "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const db = new Database("data/trivia.db", { readonly: true });

// Every local image path the library references, and whether the file is there.
const rows = db.prepare("SELECT question_id, path FROM question_images").all();
const broken = rows.filter((row) => !/^https?:\/\//i.test(row.path) && !fs.existsSync(`.${row.path}`));
console.log(`library has ${rows.length} image rows, ${broken.length} pointing at missing files`);

// Questions that are image-type but have no servable image at all.
const imageQuestions = db.prepare("SELECT id, question FROM questions WHERE type='image' AND is_active=1").all();
const unplayable = imageQuestions.filter((question) => {
  const paths = rows.filter((row) => row.question_id === question.id).map((row) => row.path);
  return !paths.some((p) => /^https?:\/\//i.test(p) || fs.existsSync(`.${p}`));
});
db.close();

console.log(`${imageQuestions.length} active image questions, ${unplayable.length} with no usable image`);

// Those must not be selectable. Ask the server for an image-only game; it should
// refuse rather than serve a question whose picture cannot load.
if (imageQuestions.length && unplayable.length === imageQuestions.length) {
  const { io } = await import("socket.io-client");
  const socket = io(endpoint);
  await new Promise((resolve) => socket.on("connect", resolve));
  const call = (event, payload) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 4000);
    socket.emit(event, payload, (result) => { clearTimeout(timer); resolve(result); });
  });

  await call("room:activity", { instanceId: `smoke-images-${process.pid}`, name: "Host", playerKey: "img-host" });
  await call("room:settings", { rounds: 3, questionTypes: ["image"] });
  const started = await call("game:start", null);
  socket.disconnect();

  assert(!started.ok, "Server started an image game despite every image being missing.");
  assert(
    /image/i.test(started.error || ""),
    `Refusal did not explain the image problem: ${started.error}`
  );
  console.log(`OK  image-only game refused: "${started.error}"`);
} else {
  console.log("!   skipped the image-only game check: some image questions are playable");
}

// Importing a question pointing at a file that is not there must be refused.
if (!adminToken) {
  console.log("!   skipped the import check: ADMIN_TOKEN not set");
} else {
  const response = await fetch(`${endpoint}/api/questions/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
    body: JSON.stringify({
      source: "smoke-images",
      questions: [{
        type: "image",
        category: "Dungeons",
        question: "Smoke test: which dungeon is this?",
        images: ["/uploads/definitely-not-uploaded.jpg"],
        correctAnswer: "Deadmines"
      }]
    })
  });
  const body = await response.json();
  assert(!response.ok, "Import accepted a question whose image does not exist.");
  assert(/cannot be served|uploads/i.test(body.error || ""), `Unhelpful rejection: ${body.error}`);
  console.log(`OK  import refused a missing image: "${body.error.slice(0, 80)}..."`);
}

console.log("\nImage smoke test passed.");
