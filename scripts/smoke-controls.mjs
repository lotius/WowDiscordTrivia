/**
 * Covers the escape hatches: a player leaving and rejoining, and the host
 * ending a game mid-round instead of waiting it out.
 */
import fs from "node:fs";
import { io } from "socket.io-client";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const endpoint = process.env.SMOKE_URL || "http://localhost:3001";
const instanceId = `smoke-controls-${process.pid}`;
const sockets = [];

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
  const hostSocket = await connect();
  const guestSocket = await connect();
  const host = await emit(hostSocket, "room:activity", {
    instanceId, name: "Host", playerKey: "ctl-host"
  });
  await emit(guestSocket, "room:activity", {
    instanceId, name: "Guest", playerKey: "ctl-guest"
  });

  // A guest leaves the lobby outright.
  const guestGone = waitForState(
    hostSocket,
    (s) => !s.players.some((p) => p.playerKey === "ctl-guest"),
    "Guest removal broadcast"
  );
  await emit(guestSocket, "room:leave", null);
  await guestGone;
  console.log("OK  player left and disappeared from everyone else's roster");

  // ...and can come back.
  const rejoined = await emit(guestSocket, "room:activity", {
    instanceId, name: "Guest", playerKey: "ctl-guest"
  });
  assert(rejoined.state.code === host.state.code, "Rejoin landed in a different room.");
  assert(
    rejoined.state.players.filter((p) => p.playerKey === "ctl-guest").length === 1,
    "Rejoin produced a duplicate player."
  );
  console.log("OK  player rejoined the same room without duplicating");

  // Host starts a game, then abandons it mid-round.
  await emit(hostSocket, "room:settings", {
    rounds: 10, questionTime: 60, resultsTime: 2, nextQuestionTime: 2, mode: "standard"
  });
  const started = waitForState(hostSocket, (s) => s.phase === "question", "Question");
  await emit(hostSocket, "game:start", null);
  const inGame = await started;
  assert(inGame.question, "Game did not produce a question.");
  console.log(`OK  game running at round ${inGame.roundIndex + 1} of ${inGame.totalRounds}`);

  const backToLobby = waitForState(guestSocket, (s) => s.phase === "lobby", "Return to lobby");
  await emit(hostSocket, "game:restart", null);
  const lobby = await backToLobby;
  assert(!lobby.question, "Question survived the game ending.");
  assert(lobby.roundIndex === 0, "Round index was not reset.");
  assert(lobby.players.every((p) => p.score === 0), "Scores were not cleared.");
  console.log("OK  host ended a game mid-round; everyone returned to the lobby");

  // The host can immediately configure and start another.
  await emit(hostSocket, "room:settings", { rounds: 2, questionTime: 5, mode: "typed" });
  const restarted = waitForState(hostSocket, (s) => s.phase === "question", "Second game");
  await emit(hostSocket, "game:start", null);
  const second = await restarted;
  assert(second.settings.mode === "typed", "New settings were not applied to the new game.");
  console.log("OK  host started a fresh game with different settings straight after");

  // A non-host must not be able to end the game.
  let refused = false;
  try { await emit(guestSocket, "game:restart", null); }
  catch { refused = true; }
  assert(refused, "A non-host was allowed to end the game.");
  console.log("OK  non-host was refused when trying to end the game");

  console.log("\nControls smoke test passed.");
} finally {
  sockets.forEach((socket) => socket.disconnect());
}
