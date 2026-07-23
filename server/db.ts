import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  Difficulty,
  LibraryImportInput,
  Question,
  QuestionInput,
  QuestionType
} from "./types.js";

const projectRoot = process.cwd();
const dataDir = path.join(projectRoot, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "trivia.db"));
db.pragma("journal_mode = WAL");

interface LegacyQuestion {
  type: QuestionType;
  category: string;
  difficulty: Difficulty;
  question: string;
  image?: string;
  correctAnswer: string;
  acceptedAnswers: string[];
  distractors: string[];
}

function tableExists(name: string) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name));
}

function migrateLegacyPackSchema(): LegacyQuestion[] {
  if (!tableExists("questions")) return [];
  const columns = db.prepare("PRAGMA table_info(questions)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "pack_id")) return [];

  const rows = db.prepare(`
    SELECT q.id, q.type, q.category, q.difficulty, q.question, q.correct_answer, qi.path AS image
    FROM questions q
    LEFT JOIN question_images qi ON qi.question_id = q.id
    ORDER BY q.id
  `).all() as Array<Record<string, unknown>>;
  const answerStatement = db.prepare(`
    SELECT answer_text, is_accepted
    FROM answers
    WHERE question_id = ?
    ORDER BY sort_order, id
  `);
  const legacy = rows.map((row) => {
    const answers = answerStatement.all(row.id) as Array<{
      answer_text: string;
      is_accepted: number;
    }>;
    const correctAnswer = String(row.correct_answer);
    return {
      type: row.type as QuestionType,
      category: String(row.category),
      difficulty: row.difficulty as Difficulty,
      question: String(row.question),
      image: row.image ? String(row.image) : undefined,
      correctAnswer,
      acceptedAnswers: answers.filter((answer) => answer.is_accepted).map((answer) => answer.answer_text),
      distractors: answers
        .filter((answer) => !answer.is_accepted && answer.answer_text.toLocaleLowerCase() !== correctAnswer.toLocaleLowerCase())
        .map((answer) => answer.answer_text)
    };
  });

  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS player_answers;
    DROP TABLE IF EXISTS rounds;
    DROP TABLE IF EXISTS game_sessions;
    DROP TABLE IF EXISTS answers;
    DROP TABLE IF EXISTS question_images;
    DROP TABLE IF EXISTS questions;
    DROP TABLE IF EXISTS question_packs;
  `);
  db.pragma("foreign_keys = ON");
  return legacy;
}

const legacyQuestions = migrateLegacyPackSchema();
db.exec(fs.readFileSync(path.join(projectRoot, "server", "schema.sql"), "utf8"));

const starterQuestions: QuestionInput[] = [
  {
    type: "text",
    category: "Geography",
    difficulty: "easy",
    question: "What is the capital of Wisconsin?",
    correctAnswer: "Madison",
    acceptedAnswers: ["madison"],
    distractors: ["Milwaukee", "Green Bay", "Kenosha"],
    answerPool: "US State Capitals",
    tags: ["starter"]
  },
  {
    type: "text",
    category: "World of Warcraft Cities",
    difficulty: "easy",
    question: "Which city is the traditional capital of the orcs?",
    correctAnswer: "Orgrimmar",
    acceptedAnswers: ["orgrimmar", "org"],
    distractors: ["Thunder Bluff", "Undercity", "Silvermoon City"],
    answerPool: "Warcraft Cities",
    tags: ["starter", "warcraft"]
  },
  {
    type: "text",
    category: "Science",
    difficulty: "medium",
    question: "What is the chemical symbol for gold?",
    correctAnswer: "Au",
    acceptedAnswers: ["au"],
    distractors: ["Ag", "Gd", "Go"],
    answerPool: "Chemical Symbols",
    tags: ["starter"]
  },
  {
    type: "text",
    category: "Video Games",
    difficulty: "medium",
    question: "What company created the Warcraft universe?",
    correctAnswer: "Blizzard Entertainment",
    acceptedAnswers: ["blizzard", "blizzard entertainment"],
    distractors: ["Valve", "BioWare", "Bungie"],
    answerPool: "Game Studios",
    tags: ["starter", "warcraft"]
  },
  {
    type: "text",
    category: "Fantasy",
    difficulty: "easy",
    question: "What creature is famous for guarding treasure and breathing fire?",
    correctAnswer: "Dragon",
    acceptedAnswers: ["dragon", "a dragon"],
    distractors: ["Griffin", "Centaur", "Basilisk"],
    answerPool: "Fantasy Creatures",
    tags: ["starter"]
  },
  {
    type: "text",
    category: "World of Warcraft Raids",
    difficulty: "medium",
    question: "Complete the raid name: Blackwing ____.",
    correctAnswer: "Lair",
    acceptedAnswers: ["lair", "blackwing lair", "bwl"],
    distractors: ["Depths", "Spire", "Descent"],
    answerPool: "Raid Name Completion",
    tags: ["starter", "warcraft"]
  }
];

function categoryId(name: string) {
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name.trim());
  return Number((db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(name.trim()) as { id: number }).id);
}

export function importQuestions(input: LibraryImportInput) {
  const insertQuestion = db.prepare(`
    INSERT INTO questions
      (category_id, type, difficulty, question, correct_answer, answer_pool, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImage = db.prepare(`
    INSERT INTO question_images (question_id, path, alt_text, sort_order)
    VALUES (?, ?, ?, ?)
  `);
  const insertAccepted = db.prepare(
    "INSERT OR IGNORE INTO accepted_answers (question_id, answer_text) VALUES (?, ?)"
  );
  const insertDistractor = db.prepare(
    "INSERT OR IGNORE INTO question_distractors (question_id, answer_text) VALUES (?, ?)"
  );
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  const selectTag = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE");
  const linkTag = db.prepare(
    "INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)"
  );

  return db.transaction(() => {
    const ids: number[] = [];
    for (const question of input.questions) {
      const result = insertQuestion.run(
        categoryId(question.category),
        question.type,
        question.difficulty ?? "medium",
        question.question.trim(),
        question.correctAnswer.trim(),
        question.answerPool?.trim() || null,
        question.active === false ? 0 : 1
      );
      const questionId = Number(result.lastInsertRowid);
      ids.push(questionId);

      const images = [
        ...(question.images ?? []),
        ...(question.image ? [question.image] : [])
      ];
      images.forEach((image, index) => {
        const pathValue = typeof image === "string" ? image : image.path;
        const altText = typeof image === "string" ? question.question : image.altText ?? question.question;
        insertImage.run(questionId, pathValue, altText, index);
      });

      const accepted = new Set([question.correctAnswer, ...(question.acceptedAnswers ?? [])]);
      for (const answer of accepted) insertAccepted.run(questionId, answer.trim());

      const legacyChoices = (question.answers ?? []).filter(
        (answer) => answer.toLocaleLowerCase() !== question.correctAnswer.toLocaleLowerCase()
      );
      const distractors = new Set([...(question.distractors ?? []), ...legacyChoices]);
      for (const answer of distractors) insertDistractor.run(questionId, answer.trim());

      for (const rawTag of question.tags ?? []) {
        const tag = rawTag.trim();
        insertTag.run(tag);
        const tagId = Number((selectTag.get(tag) as { id: number }).id);
        linkTag.run(questionId, tagId);
      }
    }
    return ids;
  })();
}

function valuesForQuestion(table: string, column: string, questionId: number) {
  return (db.prepare(`
    SELECT ${column} AS value FROM ${table}
    WHERE question_id = ?
    ORDER BY id
  `).all(questionId) as Array<{ value: string }>).map((row) => row.value);
}

function hydrateQuestion(row: Record<string, unknown>): Question {
  const id = Number(row.id);
  const answerPool = row.answer_pool ? String(row.answer_pool) : undefined;
  const candidateRows = db.prepare(`
    SELECT DISTINCT q.correct_answer, q.answer_pool
    FROM questions q
    WHERE q.category_id = ? AND q.id != ? AND q.is_active = 1
    ORDER BY q.id
  `).all(row.category_id, id) as Array<{
    correct_answer: string;
    answer_pool: string | null;
  }>;

  return {
    id,
    type: row.type as QuestionType,
    category: String(row.category),
    difficulty: row.difficulty as Difficulty,
    question: String(row.question),
    images: valuesForQuestion("question_images", "path", id),
    correctAnswer: String(row.correct_answer),
    acceptedAnswers: valuesForQuestion("accepted_answers", "answer_text", id),
    distractors: valuesForQuestion("question_distractors", "answer_text", id),
    poolDistractorCandidates: answerPool
      ? candidateRows
        .filter((candidate) => candidate.answer_pool?.toLocaleLowerCase() === answerPool.toLocaleLowerCase())
        .map((candidate) => candidate.correct_answer)
      : [],
    distractorCandidates: candidateRows.map((candidate) => candidate.correct_answer),
    answerPool,
    tags: (db.prepare(`
      SELECT t.name AS value
      FROM tags t
      JOIN question_tags qt ON qt.tag_id = t.id
      WHERE qt.question_id = ?
      ORDER BY t.name
    `).all(id) as Array<{ value: string }>).map((tag) => tag.value),
    active: Boolean(row.is_active)
  };
}

export function getQuestions(filters: {
  categories?: string[];
  difficulties?: Difficulty[];
  questionTypes?: QuestionType[];
  activeOnly?: boolean;
} = {}) {
  const clauses: string[] = [];
  const parameters: unknown[] = [];
  if (filters.activeOnly !== false) clauses.push("q.is_active = 1");
  if (filters.categories?.length) {
    clauses.push(`c.name IN (${filters.categories.map(() => "?").join(",")})`);
    parameters.push(...filters.categories);
  }
  if (filters.difficulties?.length) {
    clauses.push(`q.difficulty IN (${filters.difficulties.map(() => "?").join(",")})`);
    parameters.push(...filters.difficulties);
  }
  if (filters.questionTypes?.length) {
    clauses.push(`q.type IN (${filters.questionTypes.map(() => "?").join(",")})`);
    parameters.push(...filters.questionTypes);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT q.*, c.name AS category
    FROM questions q
    JOIN categories c ON c.id = q.category_id
    ${where}
    ORDER BY q.id
  `).all(...parameters) as Array<Record<string, unknown>>;
  return rows.map(hydrateQuestion);
}

export function listCategories() {
  return db.prepare(`
    SELECT c.name, COUNT(q.id) AS questionCount
    FROM categories c
    LEFT JOIN questions q ON q.category_id = c.id AND q.is_active = 1
    GROUP BY c.id
    HAVING COUNT(q.id) > 0
    ORDER BY c.name
  `).all();
}

export function listQuestionLibrary(search = "", category = "") {
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (search) {
    clauses.push("(q.question LIKE ? OR q.correct_answer LIKE ?)");
    parameters.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    clauses.push("c.name = ? COLLATE NOCASE");
    parameters.push(category);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT q.id, q.type, q.difficulty, q.question, q.correct_answer AS correctAnswer,
      q.answer_pool AS answerPool, q.is_active AS active, c.name AS category,
      (SELECT COUNT(*) FROM question_images qi WHERE qi.question_id = q.id) AS imageCount
    FROM questions q
    JOIN categories c ON c.id = q.category_id
    ${where}
    ORDER BY q.id DESC
    LIMIT 500
  `).all(...parameters);
}

export function deleteQuestion(id: number) {
  return db.prepare("DELETE FROM questions WHERE id = ?").run(id).changes > 0;
}

export function setQuestionActive(id: number, active: boolean) {
  return db.prepare(`
    UPDATE questions SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(active ? 1 : 0, id).changes > 0;
}

export function upsertPlayer(id: string, name: string, avatar?: string) {
  db.prepare(`
    INSERT INTO players (id, display_name, avatar_url)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url
  `).run(id, name, avatar ?? null);
}

export function createSession(roomCode: string, hostId: string, mode: string, settings: unknown) {
  return Number(db.prepare(`
    INSERT INTO game_sessions (room_code, host_player_id, mode, settings_json, started_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(roomCode, hostId, mode, JSON.stringify(settings)).lastInsertRowid);
}

export function createRound(
  sessionId: number,
  questionId: number,
  roundNumber: number,
  selectedImage: string | undefined,
  choices: string[]
) {
  return Number(db.prepare(`
    INSERT INTO rounds
      (game_session_id, question_id, round_number, selected_image, choices_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    sessionId,
    questionId,
    roundNumber,
    selectedImage ?? null,
    JSON.stringify(choices)
  ).lastInsertRowid);
}

export function savePlayerAnswer(
  roundId: number,
  playerId: string,
  answer: string,
  correct: boolean,
  responseMs: number,
  points: number
) {
  db.prepare(`
    INSERT OR REPLACE INTO player_answers
      (round_id, player_id, submitted_answer, is_correct, response_ms, points_awarded)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(roundId, playerId, answer, correct ? 1 : 0, responseMs, points);
}

export function finishRound(roundId: number) {
  db.prepare("UPDATE rounds SET ended_at = CURRENT_TIMESTAMP WHERE id = ?").run(roundId);
}

export function finishSession(sessionId: number) {
  db.prepare("UPDATE game_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
}

if (legacyQuestions.length) {
  importQuestions({
    source: "Automatic migration from question packs",
    questions: legacyQuestions.map((question) => ({
      ...question,
      images: question.image ? [question.image] : [],
      tags: ["migrated"]
    }))
  });
}

if ((db.prepare("SELECT COUNT(*) AS count FROM questions").get() as { count: number }).count === 0) {
  importQuestions({ source: "Built-in starter questions", questions: starterQuestions });
}
