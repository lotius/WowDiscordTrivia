import type { Server, Socket } from "socket.io";
import {
  createRound,
  createSession,
  finishRound,
  finishSession,
  getQuestions,
  savePlayerAnswer,
  upsertPlayer
} from "./db.js";
import type {
  GameSettings,
  Player,
  Question,
  RoomState
} from "./types.js";

interface AnswerRecord {
  value: string;
  submittedAt: number;
}

interface Room {
  state: RoomState;
  questions: Question[];
  answers: Map<string, AnswerRecord>;
  timer?: NodeJS.Timeout;
  transitionTimer?: NodeJS.Timeout;
  eliminationTimers: NodeJS.Timeout[];
  sessionId?: number;
  roundId?: number;
}

const defaultSettings: GameSettings = {
  mode: "standard",
  categories: [],
  difficulties: [],
  questionTypes: [],
  rounds: 5,
  questionTime: 20,
  resultsTime: 5,
  nextQuestionTime: 5,
  basePoints: 1000,
  speedBonus: true,
  streakBonus: true,
  fuzzyMatching: true,
  fuzzyThreshold: 0.82
};

const rooms = new Map<string, Room>();
const socketRooms = new Map<string, string>();

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function clean(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: b.length + 1 }, (_, y) =>
    Array.from({ length: a.length + 1 }, (_, x) => (y === 0 ? x : x === 0 ? y : 0))
  );
  for (let y = 1; y <= b.length; y++) {
    for (let x = 1; x <= a.length; x++) {
      matrix[y][x] = b[y - 1] === a[x - 1]
        ? matrix[y - 1][x - 1]
        : Math.min(matrix[y - 1][x - 1], matrix[y][x - 1], matrix[y - 1][x]) + 1;
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string) {
  const left = clean(a);
  const right = clean(b);
  if (!left && !right) return 1;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length, 1);
}

function isCorrect(question: Question, value: string, settings: GameSettings) {
  const candidates = [question.correctAnswer, ...question.acceptedAnswers];
  if (candidates.some((answer) => clean(answer) === clean(value))) return true;
  return settings.mode === "typed" && settings.fuzzyMatching
    ? candidates.some((answer) => similarity(answer, value) >= settings.fuzzyThreshold)
    : false;
}

function publicState(room: Room): RoomState {
  return {
    ...room.state,
    players: room.state.players.map((player) => ({ ...player }))
  };
}

function emitState(io: Server, room: Room) {
  io.to(room.state.code).emit("room:state", publicState(room));
}

function shuffle<T>(items: T[]) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swap]] = [clone[swap], clone[index]];
  }
  return clone;
}

function uniqueAnswers(items: string[], correctAnswer: string) {
  const seen = new Set([clean(correctAnswer)]);
  return items.filter((item) => {
    const normalized = clean(item);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildChoices(question: Question, count = 4) {
  const poolCandidates = uniqueAnswers(shuffle(question.poolDistractorCandidates), question.correctAnswer);
  const categoryCandidates = uniqueAnswers(
    shuffle(question.distractorCandidates),
    question.correctAnswer
  ).filter((candidate) => !poolCandidates.some((pool) => clean(pool) === clean(candidate)));
  const manualCandidates = uniqueAnswers(
    shuffle(question.distractors),
    question.correctAnswer
  ).filter((candidate) =>
    !poolCandidates.some((pool) => clean(pool) === clean(candidate)) &&
    !categoryCandidates.some((category) => clean(category) === clean(candidate))
  );
  const wrongAnswers = [...poolCandidates, ...categoryCandidates, ...manualCandidates].slice(0, count - 1);
  return shuffle([question.correctAnswer, ...wrongAnswers]);
}

function clearTimers(room: Room) {
  if (room.timer) clearTimeout(room.timer);
  if (room.transitionTimer) clearTimeout(room.transitionTimer);
  room.eliminationTimers.forEach(clearTimeout);
  room.eliminationTimers = [];
}

function chooseQuestions(settings: GameSettings) {
  const available = shuffle(getQuestions({
    categories: settings.categories,
    difficulties: settings.difficulties,
    questionTypes: settings.questionTypes
  }));
  if (!available.length) throw new Error("No active questions match the selected filters.");
  return Array.from({ length: settings.rounds }, (_, index) => available[index % available.length]);
}

function startQuestion(io: Server, room: Room) {
  clearTimers(room);
  const question = room.questions[room.state.roundIndex];
  const now = Date.now();
  room.answers.clear();
  room.state.phase = "question";
  room.state.questionStartedAt = now;
  room.state.deadline = now + room.state.settings.questionTime * 1000;
  room.state.transitionDeadline = undefined;
  room.state.eliminatedAnswers = [];
  room.state.reveal = undefined;
  room.state.players.forEach((player) => {
    player.hasAnswered = false;
    player.lastAward = 0;
  });
  const selectedImage = question.images.length
    ? question.images[Math.floor(Math.random() * question.images.length)]
    : undefined;
  const choices = room.state.settings.mode === "typed" || room.state.settings.mode === "passive"
    ? []
    : buildChoices(question);
  room.state.question = {
    id: question.id,
    type: question.type,
    category: question.category,
    difficulty: question.difficulty,
    question: question.question,
    image: selectedImage,
    answers: choices
  };
  room.roundId = createRound(
    room.sessionId!,
    question.id,
    room.state.roundIndex + 1,
    selectedImage,
    choices
  );
  emitState(io, room);

  room.transitionTimer = setTimeout(() => {
    room.state.phase = room.state.settings.mode === "passive" ? "question" : "answering";
    emitState(io, room);
  }, 900);

  if (room.state.settings.mode === "elimination" && room.state.question.answers.length > 2) {
    const wrong = shuffle(room.state.question.answers.filter((answer) => answer !== question.correctAnswer));
    const eliminationCount = Math.min(2, wrong.length);
    for (let i = 0; i < eliminationCount; i++) {
      const fraction = (i + 1) / (eliminationCount + 1);
      const delay = Math.max(2500, room.state.settings.questionTime * 1000 * fraction);
      room.eliminationTimers.push(setTimeout(() => {
        room.state.eliminatedAnswers.push(wrong[i]);
        emitState(io, room);
      }, delay));
    }
  }

  room.timer = setTimeout(() => reveal(io, room), room.state.settings.questionTime * 1000);
}

function reveal(io: Server, room: Room) {
  if (room.state.phase === "reveal" || room.state.phase === "scoreboard" || room.state.phase === "final") return;
  clearTimers(room);
  const question = room.questions[room.state.roundIndex];
  const correctPlayerIds: string[] = [];
  const durationMs = room.state.settings.questionTime * 1000;

  for (const player of room.state.players) {
    const response = room.answers.get(player.id);
    const correct = response ? isCorrect(question, response.value, room.state.settings) : false;
    let points = 0;
    if (correct) {
      player.streak += 1;
      points = room.state.settings.basePoints;
      if (room.state.settings.speedBonus && response) {
        const remaining = Math.max(0, durationMs - (response.submittedAt - (room.state.questionStartedAt ?? 0)));
        points += Math.round(room.state.settings.basePoints * 0.5 * remaining / durationMs);
      }
      if (room.state.settings.streakBonus && player.streak > 1) {
        points += Math.min(500, (player.streak - 1) * 100);
      }
      correctPlayerIds.push(player.id);
    } else {
      player.streak = 0;
    }
    player.lastAward = points;
    player.score += points;
    if (response && room.roundId) {
      savePlayerAnswer(
        room.roundId,
        player.id,
        response.value,
        correct,
        response.submittedAt - (room.state.questionStartedAt ?? response.submittedAt),
        points
      );
    }
  }

  if (room.roundId) finishRound(room.roundId);
  room.state.phase = "reveal";
  room.state.reveal = { correctAnswer: question.correctAnswer, correctPlayerIds };
  room.state.transitionDeadline = Date.now() + room.state.settings.resultsTime * 1000;
  emitState(io, room);

  room.transitionTimer = setTimeout(() => {
    if (room.state.roundIndex + 1 >= room.state.totalRounds) {
      room.state.phase = "final";
      room.state.transitionDeadline = undefined;
      if (room.sessionId) finishSession(room.sessionId);
      emitState(io, room);
      return;
    }

    room.state.phase = "scoreboard";
    room.state.transitionDeadline = Date.now() + room.state.settings.nextQuestionTime * 1000;
    emitState(io, room);
    room.transitionTimer = setTimeout(
      () => nextRound(io, room),
      room.state.settings.nextQuestionTime * 1000
    );
  }, room.state.settings.resultsTime * 1000);
}

function nextRound(io: Server, room: Room) {
  if (room.state.roundIndex + 1 >= room.state.totalRounds) {
    room.state.phase = "final";
    room.state.transitionDeadline = undefined;
    if (room.sessionId) finishSession(room.sessionId);
    emitState(io, room);
    return;
  }
  room.state.roundIndex += 1;
  startQuestion(io, room);
}

function playerFromSocket(socket: Socket, payload: { name?: string; avatar?: string }, isHost: boolean): Player {
  const name = payload.name?.trim().slice(0, 24) || `Player ${socket.id.slice(0, 4)}`;
  upsertPlayer(socket.id, name, payload.avatar);
  return {
    id: socket.id,
    name,
    avatar: payload.avatar,
    score: 0,
    streak: 0,
    connected: true,
    isHost,
    hasAnswered: false,
    lastAward: 0
  };
}

export function installGameEngine(io: Server) {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload: { name?: string; avatar?: string }, callback) => {
      let code = roomCode();
      while (rooms.has(code)) code = roomCode();
      const host = playerFromSocket(socket, payload ?? {}, true);
      const room: Room = {
        state: {
          code,
          phase: "lobby",
          hostId: socket.id,
          players: [host],
          settings: { ...defaultSettings },
          roundIndex: 0,
          totalRounds: defaultSettings.rounds,
          eliminatedAnswers: []
        },
        questions: [],
        answers: new Map(),
        eliminationTimers: []
      };
      rooms.set(code, room);
      socket.join(code);
      socketRooms.set(socket.id, code);
      callback?.({ ok: true, state: publicState(room), playerId: socket.id });
      emitState(io, room);
    });

    socket.on("room:join", (payload: { code: string; name?: string; avatar?: string }, callback) => {
      const code = payload.code?.trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return callback?.({ ok: false, error: "Room not found." });
      if (!["lobby", "settings"].includes(room.state.phase)) {
        return callback?.({ ok: false, error: "This game is already in progress." });
      }
      if (!room.state.players.some((player) => player.id === socket.id)) {
        room.state.players.push(playerFromSocket(socket, payload, false));
      }
      socket.join(code);
      socketRooms.set(socket.id, code);
      callback?.({ ok: true, state: publicState(room), playerId: socket.id });
      emitState(io, room);
    });

    socket.on("room:settings", (settings: Partial<GameSettings>, callback) => {
      const room = rooms.get(socketRooms.get(socket.id) ?? "");
      if (!room || room.state.hostId !== socket.id) return callback?.({ ok: false });
      room.state.settings = {
        ...room.state.settings,
        ...settings,
        categories: Array.isArray(settings.categories)
          ? settings.categories.map(String).slice(0, 100)
          : room.state.settings.categories,
        difficulties: Array.isArray(settings.difficulties)
          ? settings.difficulties.filter((value) => ["easy", "medium", "hard"].includes(value))
          : room.state.settings.difficulties,
        questionTypes: Array.isArray(settings.questionTypes)
          ? settings.questionTypes.filter((value) => ["text", "image"].includes(value))
          : room.state.settings.questionTypes,
        rounds: Math.min(50, Math.max(1, Number(settings.rounds ?? room.state.settings.rounds))),
        questionTime: Math.min(120, Math.max(5, Number(settings.questionTime ?? room.state.settings.questionTime))),
        resultsTime: Math.min(30, Math.max(1, Number(settings.resultsTime ?? room.state.settings.resultsTime))),
        nextQuestionTime: Math.min(30, Math.max(1, Number(settings.nextQuestionTime ?? room.state.settings.nextQuestionTime))),
        fuzzyThreshold: Math.min(1, Math.max(0.5, Number(settings.fuzzyThreshold ?? room.state.settings.fuzzyThreshold)))
      };
      room.state.totalRounds = room.state.settings.rounds;
      room.state.phase = "settings";
      emitState(io, room);
      callback?.({ ok: true });
    });

    socket.on("game:start", (_, callback) => {
      const room = rooms.get(socketRooms.get(socket.id) ?? "");
      if (!room || room.state.hostId !== socket.id) return callback?.({ ok: false });
      try {
        room.questions = chooseQuestions(room.state.settings);
        room.state.totalRounds = room.questions.length;
        room.state.roundIndex = 0;
        room.state.players.forEach((player) => {
          player.score = 0;
          player.streak = 0;
        });
        room.sessionId = createSession(
          room.state.code,
          room.state.hostId,
          room.state.settings.mode,
          room.state.settings
        );
        startQuestion(io, room);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, error: error instanceof Error ? error.message : "Unable to start." });
      }
    });

    socket.on("answer:submit", (payload: { answer: string }, callback) => {
      const room = rooms.get(socketRooms.get(socket.id) ?? "");
      if (!room || !["question", "answering"].includes(room.state.phase)) {
        return callback?.({ ok: false, error: "Answers are closed." });
      }
      if (room.state.settings.mode === "passive" || Date.now() > (room.state.deadline ?? 0)) {
        return callback?.({ ok: false, error: "Answers are closed." });
      }
      const player = room.state.players.find((candidate) => candidate.id === socket.id);
      if (!player || player.hasAnswered) return callback?.({ ok: false, error: "Answer already submitted." });
      const answer = String(payload.answer ?? "").trim().slice(0, 100);
      if (!answer || room.state.eliminatedAnswers.includes(answer)) {
        return callback?.({ ok: false, error: "Invalid answer." });
      }
      room.answers.set(socket.id, { value: answer, submittedAt: Date.now() });
      player.hasAnswered = true;
      emitState(io, room);
      callback?.({ ok: true });

      const activePlayers = room.state.players.filter((candidate) => candidate.connected);
      if (activePlayers.length && activePlayers.every((candidate) => candidate.hasAnswered)) {
        if (room.transitionTimer) clearTimeout(room.transitionTimer);
        room.transitionTimer = setTimeout(() => reveal(io, room), 500);
      }
    });

    socket.on("game:next", (_, callback) => {
      const room = rooms.get(socketRooms.get(socket.id) ?? "");
      if (!room || room.state.hostId !== socket.id || room.state.phase !== "scoreboard") {
        return callback?.({ ok: false });
      }
      nextRound(io, room);
      callback?.({ ok: true });
    });

    socket.on("game:restart", (_, callback) => {
      const room = rooms.get(socketRooms.get(socket.id) ?? "");
      if (!room || room.state.hostId !== socket.id) return callback?.({ ok: false });
      clearTimers(room);
      room.state.phase = "lobby";
      room.state.roundIndex = 0;
      room.state.question = undefined;
      room.state.reveal = undefined;
      room.state.transitionDeadline = undefined;
      room.state.players.forEach((player) => {
        player.score = 0;
        player.streak = 0;
        player.hasAnswered = false;
      });
      emitState(io, room);
      callback?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const code = socketRooms.get(socket.id);
      const room = rooms.get(code ?? "");
      socketRooms.delete(socket.id);
      if (!room) return;
      const player = room.state.players.find((candidate) => candidate.id === socket.id);
      if (player) player.connected = false;
      if (room.state.hostId === socket.id) {
        const nextHost = room.state.players.find((candidate) => candidate.connected);
        if (nextHost) {
          nextHost.isHost = true;
          room.state.hostId = nextHost.id;
        }
      }
      if (!room.state.players.some((candidate) => candidate.connected)) {
        clearTimers(room);
        rooms.delete(room.state.code);
      } else {
        emitState(io, room);
      }
    });
  });
}
