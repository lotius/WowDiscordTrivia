import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import multer from "multer";
import { Server } from "socket.io";
import {
  deleteQuestion,
  importQuestions,
  listCategories,
  listQuestionLibrary,
  setQuestionActive
} from "./db.js";
import { installGameEngine } from "./game-engine.js";
import { libraryImportSchema } from "./validation.js";

const root = process.cwd();
const uploads = path.join(root, "uploads");
fs.mkdirSync(uploads, { recursive: true });

const app = express();
const server = http.createServer(app);

const configuredOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// Discord serves an Activity from <application_id>.discordsays.com. The exact
// subdomain varies per application, so match the family instead of pinning one.
function isAllowedOrigin(candidate?: string) {
  if (!candidate) return true;
  if (configuredOrigins.includes(candidate)) return true;
  try {
    return new URL(candidate).hostname.endsWith(".discordsays.com");
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (candidate: string | undefined, callback: (error: null, allow: boolean) => void) =>
    callback(null, isAllowedOrigin(candidate)),
  credentials: true
};

const io = new Server(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(uploads));

app.get("/api/health", (_, response) => response.json({ ok: true }));
app.get("/api/categories", (_, response) => response.json(listCategories()));
app.get("/api/questions", (request, response) => {
  response.json(listQuestionLibrary(
    String(request.query.search ?? "").trim(),
    String(request.query.category ?? "").trim()
  ));
});

app.post("/api/discord/token", async (request, response) => {
  const clientId = process.env.VITE_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return response.status(503).json({ error: "Discord credentials are not configured." });
  }
  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: String(request.body.code ?? "")
      })
    });
    const token = await tokenResponse.json();
    return response.status(tokenResponse.status).json(token);
  } catch {
    return response.status(502).json({ error: "Discord authentication failed." });
  }
});

app.post("/api/questions/preview", (request, response) => {
  const result = libraryImportSchema.safeParse(request.body);
  if (!result.success) {
    return response.status(400).json({ ok: false, issues: result.error.issues });
  }
  return response.json({
    ok: true,
    import: result.data,
    summary: {
      questionCount: result.data.questions.length,
      imageCount: result.data.questions.filter((question) => question.type === "image").length,
      categories: [...new Set(result.data.questions.map((question) => question.category))],
      answerPools: [...new Set(result.data.questions.map((question) => question.answerPool).filter(Boolean))]
    }
  });
});

app.post("/api/questions/import", (request, response) => {
  const result = libraryImportSchema.safeParse(request.body);
  if (!result.success) {
    return response.status(400).json({ ok: false, issues: result.error.issues });
  }
  try {
    const ids = importQuestions(result.data);
    return response.status(201).json({ ok: true, imported: ids.length, ids });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    return response.status(400).json({ ok: false, error: message });
  }
});

app.patch("/api/questions/:id", (request, response) => {
  if (typeof request.body.active !== "boolean") {
    return response.status(400).json({ ok: false, error: "active must be a boolean." });
  }
  const updated = setQuestionActive(Number(request.params.id), request.body.active);
  return response.status(updated ? 200 : 404).json({ ok: updated });
});

app.delete("/api/questions/:id", (request, response) => {
  try {
    const deleted = deleteQuestion(Number(request.params.id));
    return response.status(deleted ? 200 : 404).json({ ok: deleted });
  } catch {
    return response.status(409).json({
      ok: false,
      error: "This question is referenced by game history. Disable it instead of deleting it."
    });
  }
});

const storage = multer.diskStorage({
  destination: uploads,
  filename: (_, file, callback) => {
    const safeBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "-");
    callback(null, `${Date.now()}-${safeBase}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, callback) => callback(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype))
});

app.post("/api/images", upload.single("image"), (request, response) => {
  if (!request.file) return response.status(400).json({ ok: false, error: "Choose a supported image." });
  return response.status(201).json({ ok: true, path: `/uploads/${request.file.filename}` });
});

const clientDist = path.join(root, "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_, response) => response.sendFile(path.join(clientDist, "index.html")));
}

installGameEngine(io);

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => {
  console.log(`Azeroth Arcade server listening on http://localhost:${port}`);
});
