/**
 * Exercises the Discord activity join path without Discord: several clients
 * announcing the same instance id must land in one room, a client that drops
 * and returns must keep its score, and a latecomer must be able to join a game
 * already in progress.
 */
import fs from "node:fs";
import { io } from "socket.io-client";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const endpoint = process.env.SMOKE_URL || "http://localhost:3001";
const adminToken = process.env.ADMIN_TOKEN || "";
const instanceId = `smoke-instance-${process.pid}`;
const sockets = [];

/**
 * The room state withholds the correct answer until reveal, which is the point.
 * To prove a score actually survives a reconnect the test needs a non-zero
 * score, so it reads the answer key from the admin API instead of guessing.
 */
async function loadAnswerKey() {
  if (!adminToken) return null;
  const response = await fetch(`${endpoint}/api/questions`, {
    headers: { "x-admin-token": adminToken }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return new Map(rows.map((row) => [row.id, row.correctAnswer]));
}

function connect() {
  const socket = io(endpoint);
  sockets.push(socket);
  return new Promise((resolve) => socket.on("connect", () => resolve(socket)));
}

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 4000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timeout);
      if (!result?.ok) reject(new Error(result?.error || `${event} failed`));
      else resolve(result);
    });
  });
}

function waitForState(socket, predicate, label, timeoutMs = 8000) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  // Two players launch the activity in the same voice channel.
  const hostSocket = await connect();
  const guestSocket = await connect();

  const host = await emit(hostSocket, "room:activity", {
    instanceId, name: "Host", playerKey: "user-host"
  });
  const guest = await emit(guestSocket, "room:activity", {
    instanceId, name: "Guest", playerKey: "user-guest"
  });

  assert(host.state.code === guest.state.code, "Same instance id produced different rooms.");
  assert(host.state.hostId === host.playerId, "First arrival did not become host.");
  assert(guest.state.players.length === 2, "Second arrival was not added to the room.");
  console.log(`OK  one voice channel -> one room (${host.state.code}), no code exchanged`);

  // Start a short game so there is a score worth preserving.
  await emit(hostSocket, "room:settings", {
    rounds: 3, questionTime: 5, resultsTime: 1, nextQuestionTime: 1, mode: "standard"
  });
  const firstQuestion = waitForState(hostSocket, (s) => s.phase === "question", "First question");
  await emit(hostSocket, "game:start", null);
  const question = await firstQuestion;

  // Guest answers correctly so there is a real score to preserve.
  const answerKey = await loadAnswerKey();
  const correct = answerKey?.get(question.question.id);
  if (!correct) {
    console.log("!   ADMIN_TOKEN unavailable - guessing, so the score check may be vacuous");
  }
  const guestAnswer = correct && question.question.answers.includes(correct)
    ? correct
    : question.question.answers[0];

  const revealed = waitForState(hostSocket, (s) => s.phase === "reveal", "Reveal");
  await emit(guestSocket, "answer:submit", { answer: guestAnswer });
  await emit(hostSocket, "answer:submit", { answer: question.question.answers[0] });
  const afterReveal = await revealed;
  const scoreBefore = afterReveal.players.find((p) => p.playerKey === "user-guest").score;
  assert(scoreBefore > 0, "Guest scored nothing, so the reconnect check would prove nothing.");
  console.log(`OK  guest banked ${scoreBefore} points`);

  // Guest's iframe is suspended mid-game, then comes back on a new socket.
  guestSocket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const returnedSocket = await connect();
  const returned = await emit(returnedSocket, "room:activity", {
    instanceId, name: "Guest", playerKey: "user-guest"
  });

  const guestAfter = returned.state.players.find((p) => p.playerKey === "user-guest");
  assert(guestAfter, "Returning player vanished from the room.");
  assert(guestAfter.score === scoreBefore, `Score lost on reconnect: ${scoreBefore} -> ${guestAfter.score}`);
  assert(guestAfter.id === returned.playerId, "Returning player was not rebound to the new socket.");
  assert(
    returned.state.players.filter((p) => p.playerKey === "user-guest").length === 1,
    "Reconnect created a duplicate player."
  );
  console.log(`OK  reconnect mid-game kept ${guestAfter.score} points and did not duplicate the player`);

  // A friend who clicks the activity late joins the running game.
  const lateSocket = await connect();
  const late = await emit(lateSocket, "room:activity", {
    instanceId, name: "Latecomer", playerKey: "user-late"
  });
  assert(late.state.code === host.state.code, "Latecomer landed in a different room.");
  assert(
    late.state.players.some((p) => p.playerKey === "user-late"),
    "Latecomer was not added to the in-progress game."
  );
  console.log("OK  latecomer joined a game already in progress");

  // A player whose Discord authorisation failed has no name and no user id.
  // They must still land in everyone else's room rather than being sent to the
  // standalone create/join screen, which is what split parties up.
  const anonSocket = await connect();
  const anon = await emit(anonSocket, "room:activity", { instanceId });
  assert(anon.state.code === host.state.code, "Unidentified player landed in a different room.");
  const anonPlayer = anon.state.players.find((p) => p.id === anon.playerId);
  assert(anonPlayer, "Unidentified player was not added to the room.");
  assert(anonPlayer.name.length > 0, "Unidentified player has no display name.");
  console.log(`OK  unidentified player still joined the same room as "${anonPlayer.name}"`);

  // ...and can then pick a real name without leaving the room.
  await emit(anonSocket, "player:rename", { name: "Renamed Hero" });
  const renamed = await waitForState(
    anonSocket,
    (s) => s.players.some((p) => p.name === "Renamed Hero"),
    "Rename broadcast"
  );
  assert(renamed.code === host.state.code, "Rename moved the player out of the room.");
  console.log("OK  unidentified player renamed themselves in place");

  console.log("\nActivity smoke test passed.");
} finally {
  sockets.forEach((socket) => socket.disconnect());
}

