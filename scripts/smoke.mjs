import { io } from "socket.io-client";

const endpoint = process.env.SMOKE_URL || "http://localhost:3001";
const host = io(endpoint);
const guest = io(endpoint);

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 3000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timeout);
      if (!result?.ok) reject(new Error(result?.error || `${event} failed`));
      else resolve(result);
    });
  });
}

function waitForState(socket, predicate, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("room:state", onState);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    const onState = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      socket.off("room:state", onState);
      resolve(state);
    };
    socket.on("room:state", onState);
  });
}

try {
  await Promise.all([
    new Promise((resolve) => host.on("connect", resolve)),
    new Promise((resolve) => guest.on("connect", resolve))
  ]);
  const created = await emit(host, "room:create", { name: "Smoke Host" });
  await emit(guest, "room:join", { code: created.state.code, name: "Smoke Guest" });
  await emit(host, "room:settings", {
    rounds: 2,
    questionTime: 5,
    resultsTime: 1,
    nextQuestionTime: 1,
    mode: "standard"
  });
  const questionState = waitForState(host, (state) => state.phase === "question", "Question state");
  await emit(host, "game:start", null);
  const state = await questionState;
  if (state.question.answers.length < 2) throw new Error("Multiple-choice generation produced fewer than two choices.");
  if (new Set(state.question.answers.map((answer) => answer.toLowerCase())).size !== state.question.answers.length) {
    throw new Error("Multiple-choice generation produced duplicate choices.");
  }

  const revealState = waitForState(host, (next) => next.phase === "reveal", "Reveal state");
  const scoreboardState = waitForState(host, (next) => next.phase === "scoreboard", "Scoreboard countdown");
  const nextQuestionState = waitForState(
    host,
    (next) => next.phase === "question" && next.roundIndex === 1,
    "Automatic next question"
  );
  await Promise.all([
    emit(host, "answer:submit", { answer: state.question.answers[0] }),
    emit(guest, "answer:submit", { answer: state.question.answers[0] })
  ]);
  await revealState;
  const scoreboard = await scoreboardState;
  if (!scoreboard.transitionDeadline || scoreboard.transitionDeadline <= Date.now()) {
    throw new Error("Scoreboard did not include an active next-question deadline.");
  }
  await nextQuestionState;

  console.log(`Realtime smoke test passed for room ${created.state.code}; countdown advanced automatically to round 2.`);
} finally {
  host.disconnect();
  guest.disconnect();
}
