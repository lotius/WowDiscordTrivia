import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Admin } from "./components/Admin";
import { ImageClue } from "./components/ImageClue";
import { PlayerRail } from "./components/PlayerRail";
import { Timer } from "./components/Timer";
import { initializeDiscord, type DiscordContext, type DiscordIdentity } from "./discord";
import { apiUrl, assetUrl, isEmbedded, localPlayerKey, socketPath } from "./environment";
import { useCountdown } from "./hooks/useCountdown";
import type { CategorySummary, GameMode, GameSettings, RoomState } from "./types";

// Inside Discord the activity and the server share one origin through the
// proxy, so VITE_SERVER_URL must be ignored — a baked-in localhost would be
// unreachable from the iframe.
const serverUrl = isEmbedded
  ? window.location.origin
  : import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket = io(serverUrl, { autoConnect: true, path: socketPath });
const answerLetters = ["A", "B", "C", "D", "E", "F"];

const modeCopy: Record<GameMode, { title: string; icon: string; description: string }> = {
  standard: { title: "Classic Clash", icon: "✦", description: "Pick the right answer before time runs out." },
  elimination: { title: "Vanishing Act", icon: "◫", description: "Wrong choices fade away as the clock burns." },
  typed: { title: "Spell It Out", icon: "⌨", description: "Type the answer. Close calls can count." },
  passive: { title: "Campfire Reveal", icon: "◉", description: "Kick back—the answer reveals itself." }
};

function App() {
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState(localStorage.getItem("trivia-name") || "");
  const [code, setCode] = useState("");
  const [identity, setIdentity] = useState<DiscordIdentity | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [typedAnswer, setTypedAnswer] = useState("");
  const [error, setError] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  // Inside Discord the landing screen is skipped entirely, so show a connecting
  // state rather than flashing a create/join card nobody should use.
  const [connecting, setConnecting] = useState(isEmbedded);
  const [online, setOnline] = useState(socket.connected);
  const activity = useRef<DiscordContext | null>(null);

  const me = state?.players.find((player) => player.id === playerId);
  const isHost = state?.hostId === playerId;

  async function loadLibrary() {
    const response = await fetch(apiUrl("/api/categories"));
    if (response.ok) setCategories(await response.json());
  }

  /**
   * Joins (or rejoins) the room for this activity instance. Every failure path
   * lands somewhere the player can retry from, because the alternative is what
   * players actually did before: close the activity and relaunch it.
   */
  const joinActivity = useCallback(() => {
    const context = activity.current;
    if (!context?.instanceId) return;
    setConnecting(true);
    setError("");
    const storedName = localStorage.getItem("trivia-name") || "";
    // Without a deadline a lost acknowledgement leaves the player on the
    // connecting screen indefinitely with no way forward.
    socket.timeout(10_000).emit("room:activity", {
      instanceId: context.instanceId,
      name: context.identity?.name || storedName || "",
      avatar: context.identity?.avatar,
      playerKey: context.identity?.discordUserId || localPlayerKey()
    }, (
      timedOut: unknown,
      result?: { ok: boolean; state?: RoomState; playerId?: string; error?: string }
    ) => {
      setConnecting(false);
      if (timedOut) {
        return setError("The game server did not respond. Check that it and the tunnel are still running.");
      }
      if (!result?.ok) return setError(result?.error || "Could not join the activity.");
      setState(result.state!);
      setPlayerId(result.playerId!);
      setError("");
    });
  }, []);

  useEffect(() => {
    initializeDiscord().then((context) => {
      if (!context) return setConnecting(false);
      activity.current = context;
      if (context.identity) {
        setIdentity(context.identity);
        setName(context.identity.name);
      }

      // Everyone in the voice channel shares one instance id, so there is no
      // room code to exchange. This deliberately does not depend on identity:
      // a player Discord could not identify still belongs in the same room as
      // everyone else, just under a fallback name.
      if (!context.instanceId) {
        setConnecting(false);
        setError("Discord did not provide an activity instance. Relaunch the activity.");
        return;
      }
      if (socket.connected) joinActivity();
    }).catch(() => setConnecting(false));
    loadLibrary().catch(() => undefined);
  }, [joinActivity]);

  // Connection lifecycle. Rejoining on every "connect" covers Discord
  // suspending and resuming the iframe, which it does routinely.
  useEffect(() => {
    const onConnect = () => {
      setOnline(true);
      if (activity.current?.instanceId) joinActivity();
    };
    const onDisconnect = () => setOnline(false);
    const onConnectError = () => {
      setOnline(false);
      setConnecting(false);
      setError("Cannot reach the game server. It may have stopped, or the tunnel may have closed.");
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [joinActivity]);

  useEffect(() => {
    const onState = (next: RoomState) => {
      setState(next);
      if (next.phase === "question") {
        setSelectedAnswer("");
        setTypedAnswer("");
      }
    };
    socket.on("room:state", onState);
    return () => { socket.off("room:state", onState); };
  }, []);

  useEffect(() => {
    const images = state?.question?.type === "image" && state.question.image
      ? [state.question.image]
      : [];
    images.forEach((source) => {
      const image = new Image();
      image.src = assetUrl(source);
    });
  }, [state?.question?.id, state?.question?.image, state?.question?.type]);

  const submitIdentity = () => {
    const finalName = (identity?.name || name).trim();
    if (!finalName) {
      setError("Give your adventurer a name first.");
      return null;
    }
    localStorage.setItem("trivia-name", finalName);
    setError("");
    return finalName;
  };

  function createRoom() {
    const finalName = submitIdentity();
    if (!finalName) return;
    socket.emit("room:create", { name: finalName, avatar: identity?.avatar }, (result: {
      ok: boolean; state?: RoomState; playerId?: string; error?: string;
    }) => {
      if (!result.ok) return setError(result.error || "Could not create room.");
      setState(result.state!);
      setPlayerId(result.playerId!);
    });
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    const finalName = submitIdentity();
    if (!finalName) return;
    socket.emit("room:join", { code, name: finalName, avatar: identity?.avatar }, (result: {
      ok: boolean; state?: RoomState; playerId?: string; error?: string;
    }) => {
      if (!result.ok) return setError(result.error || "Could not join room.");
      setState(result.state!);
      setPlayerId(result.playerId!);
    });
  }

  function renamePlayer(next: string) {
    const trimmed = next.trim().slice(0, 24);
    if (!trimmed) return;
    localStorage.setItem("trivia-name", trimmed);
    socket.emit("player:rename", { name: trimmed }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) setError(result.error || "Could not change your name.");
    });
  }

  function updateSettings(next: Partial<GameSettings>) {
    if (!state) return;
    setState({ ...state, settings: { ...state.settings, ...next } });
    socket.emit("room:settings", next);
  }

  function startGame() {
    setError("");
    socket.emit("game:start", null, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) setError(result.error || "Could not start game.");
    });
  }

  function submitAnswer(answer: string) {
    if (!answer.trim() || me?.hasAnswered) return;
    socket.emit("answer:submit", { answer }, (result: { ok: boolean; error?: string }) => {
      if (result.ok) setSelectedAnswer(answer);
      else setError(result.error || "Answer not accepted.");
    });
  }

  if (adminOpen) {
    return <Admin onClose={() => setAdminOpen(false)} onImported={loadLibrary} />;
  }

  // Inside Discord this covers both the initial join and any failure after it,
  // so a stuck player always has a retry instead of relaunching the activity.
  if (isEmbedded && !state) {
    return (
      <div className="landing">
        <div className="stars" />
        <main className="landing__content landing__content--centered">
          <section className="join-card">
            <div className="join-card__rune">✦</div>
            {connecting ? (
              <>
                <h2>Joining your party</h2>
                <p>Connecting to the voice channel's game…</p>
              </>
            ) : (
              <>
                <h2>Could not join</h2>
                <p>{error || "Something went wrong reaching the game."}</p>
                <button className="button button--primary button--full" onClick={joinActivity}>
                  Try again
                </button>
                <p className="join-hint">
                  Everyone in this voice channel lands in the same game — there is no code to share.
                </p>
              </>
            )}
          </section>
        </main>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="landing">
        <div className="stars" />
        <header className="topbar">
          <div className="brand"><span>AA</span> Azeroth Arcade</div>
          <button className="button button--ghost" onClick={() => setAdminOpen(true)}>Question library</button>
        </header>
        <main className="landing__content">
          <section className="hero-copy">
            <span className="eyebrow">A party trivia activity</span>
            <h1>Gather your party.<br /><em>Prove what you know.</em></h1>
            <p>Fast, friendly trivia built for the delightful chaos of a Discord voice channel.</p>
            <div className="feature-strip">
              <span>⚡ Realtime rounds</span>
              <span>♟ 4 game modes</span>
              <span>☻ Any party size</span>
            </div>
          </section>
          <section className="join-card">
            <div className="join-card__rune">✦</div>
            <h2>Enter the tavern</h2>
            <p>{identity ? `Connected as ${identity.name}` : "Choose a name, then host or join a room."}</p>
            {!identity && (
              <label>
                Display name
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="Thrall's Intern" />
              </label>
            )}
            <button className="button button--primary button--full" onClick={createRoom}>Create a new game</button>
            <div className="or"><span>or join your party</span></div>
            <form className="join-form" onSubmit={joinRoom}>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
                placeholder="ROOM"
                aria-label="Room code"
              />
              <button className="button button--secondary">Join</button>
            </form>
            {error && <div className="form-error">{error}</div>}
          </section>
        </main>
      </div>
    );
  }

  const content = (() => {
    if (["lobby", "settings"].includes(state.phase)) {
      return (
        <Lobby
          state={state}
          categories={categories}
          isHost={isHost}
          updateSettings={updateSettings}
          startGame={startGame}
          error={error}
          myName={me?.name || ""}
          canRename={!identity}
          onRename={renamePlayer}
        />
      );
    }
    if (["question", "answering", "reveal"].includes(state.phase)) {
      return (
        <Question
          state={state}
          meHasAnswered={Boolean(me?.hasAnswered)}
          selectedAnswer={selectedAnswer}
          typedAnswer={typedAnswer}
          setTypedAnswer={setTypedAnswer}
          submitAnswer={submitAnswer}
        />
      );
    }
    if (state.phase === "scoreboard") {
      return <Scoreboard state={state} isHost={isHost} onNext={() => socket.emit("game:next")} />;
    }
    return <FinalResults state={state} isHost={isHost} onRestart={() => socket.emit("game:restart")} />;
  })();

  return (
    <div className="game-shell">
      {!online && (
        <div className="connection-banner">
          Connection lost — reconnecting. Your score is safe.
        </div>
      )}
      <header className="game-header">
        <div className="brand"><span>AA</span> Azeroth Arcade</div>
        <div className="room-badge">Room <strong>{state.code}</strong></div>
      </header>
      <div className="game-layout">
        <PlayerRail players={state.players} phase={state.phase} />
        <main className="game-stage">{content}</main>
      </div>
    </div>
  );
}

function Lobby({
  state,
  categories,
  isHost,
  updateSettings,
  startGame,
  error,
  myName,
  canRename,
  onRename
}: {
  state: RoomState;
  categories: CategorySummary[];
  isHost: boolean;
  updateSettings: (settings: Partial<GameSettings>) => void;
  startGame: () => void;
  error: string;
  myName: string;
  canRename: boolean;
  onRename: (name: string) => void;
}) {
  const settings = state.settings;
  const [draftName, setDraftName] = useState(myName);
  return (
    <div className="lobby-screen">
      <div className="lobby-heading">
        <span className="eyebrow">Your party is assembling</span>
        <h1>Room <button onClick={() => navigator.clipboard?.writeText(state.code)}>{state.code} ⧉</button></h1>
        <p>
          {state.players.length === 1
            ? "Waiting for your party. Anyone who launches this Activity joins here automatically."
            : `${state.players.length} adventurers here. Anyone launching this Activity joins automatically.`}
        </p>
        {canRename && (
          <form
            className="rename-form"
            onSubmit={(event) => { event.preventDefault(); onRename(draftName); }}
          >
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Your name"
              maxLength={24}
              aria-label="Your display name"
            />
            <button className="button button--secondary">Set name</button>
          </form>
        )}
      </div>
      {isHost ? (
        <div className="settings-grid">
          <section className="panel mode-panel">
            <div className="section-title"><span>1</span><div><h2>Choose your challenge</h2><p>Every mode draws from the shared question library.</p></div></div>
            <div className="mode-grid">
              {(Object.keys(modeCopy) as GameMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`mode-card ${settings.mode === mode ? "is-selected" : ""}`}
                  onClick={() => updateSettings({ mode })}
                >
                  <span className="mode-card__icon">{modeCopy[mode].icon}</span>
                  <strong>{modeCopy[mode].title}</strong>
                  <small>{modeCopy[mode].description}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel controls-panel">
            <div className="section-title"><span>2</span><div><h2>Set the rules</h2><p>Tune the pace for your party.</p></div></div>
            <fieldset className="filter-fieldset">
              <legend>Categories</legend>
              <p>Leave all unchecked to use the entire library.</p>
              <div className="filter-options">
                {categories.map((category) => (
                  <label className="check-option" key={category.name}>
                    <input
                      type="checkbox"
                      checked={settings.categories.includes(category.name)}
                      onChange={(event) => updateSettings({
                        categories: event.target.checked
                          ? [...settings.categories, category.name]
                          : settings.categories.filter((name) => name !== category.name)
                      })}
                    />
                    <span>{category.name} <small>{category.questionCount}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="control-pair filter-pair">
              <fieldset className="filter-fieldset">
                <legend>Question types</legend>
                {(["text", "image"] as const).map((type) => (
                  <label className="check-option" key={type}>
                    <input
                      type="checkbox"
                      checked={settings.questionTypes.includes(type)}
                      onChange={(event) => updateSettings({
                        questionTypes: event.target.checked
                          ? [...settings.questionTypes, type]
                          : settings.questionTypes.filter((value) => value !== type)
                      })}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="filter-fieldset">
                <legend>Difficulty</legend>
                {(["easy", "medium", "hard"] as const).map((difficulty) => (
                  <label className="check-option" key={difficulty}>
                    <input
                      type="checkbox"
                      checked={settings.difficulties.includes(difficulty)}
                      onChange={(event) => updateSettings({
                        difficulties: event.target.checked
                          ? [...settings.difficulties, difficulty]
                          : settings.difficulties.filter((value) => value !== difficulty)
                      })}
                    />
                    <span>{difficulty}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="control-pair">
              <label>Rounds <output>{settings.rounds}</output>
                <input type="range" min="1" max="20" value={settings.rounds} onChange={(event) => updateSettings({ rounds: Number(event.target.value) })} />
              </label>
              <label>Question time <output>{settings.questionTime}s</output>
                <input type="range" min="5" max="60" step="5" value={settings.questionTime} onChange={(event) => updateSettings({ questionTime: Number(event.target.value) })} />
              </label>
            </div>
            <div className="control-pair">
              <label>Answer results <output>{settings.resultsTime}s</output>
                <input type="range" min="1" max="30" value={settings.resultsTime} onChange={(event) => updateSettings({ resultsTime: Number(event.target.value) })} />
              </label>
              <label>Next question countdown <output>{settings.nextQuestionTime}s</output>
                <input type="range" min="1" max="30" value={settings.nextQuestionTime} onChange={(event) => updateSettings({ nextQuestionTime: Number(event.target.value) })} />
              </label>
            </div>
            <div className="toggle-list">
              <Toggle label="Speed bonus" checked={settings.speedBonus} onChange={(speedBonus) => updateSettings({ speedBonus })} />
              <Toggle label="Streak bonus" checked={settings.streakBonus} onChange={(streakBonus) => updateSettings({ streakBonus })} />
              {settings.mode === "typed" && <Toggle label="Fuzzy answer matching" checked={settings.fuzzyMatching} onChange={(fuzzyMatching) => updateSettings({ fuzzyMatching })} />}
            </div>
            <button className="button button--primary button--full button--large" onClick={startGame}>Begin the adventure →</button>
            {error && <div className="form-error">{error}</div>}
          </section>
        </div>
      ) : (
        <div className="waiting-card panel">
          <div className="waiting-orb">✦</div>
          <h2>The host is preparing the questions</h2>
          <p>Keep the voice chat lively. Your first round will appear here.</p>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}

function Question({
  state,
  meHasAnswered,
  selectedAnswer,
  typedAnswer,
  setTypedAnswer,
  submitAnswer
}: {
  state: RoomState;
  meHasAnswered: boolean;
  selectedAnswer: string;
  typedAnswer: string;
  setTypedAnswer: (answer: string) => void;
  submitAnswer: (answer: string) => void;
}) {
  const question = state.question!;
  const reveal = state.phase === "reveal";
  const isPassive = state.settings.mode === "passive";
  const answerCount = state.players.filter((player) => player.hasAnswered).length;

  return (
    <div className={`question-screen ${question.type === "image" ? "has-image" : ""}`}>
      <div className="question-meta">
        <span>Round {state.roundIndex + 1} / {state.totalRounds}</span>
        <span className={`difficulty difficulty--${question.difficulty}`}>{question.difficulty}</span>
        {!reveal && <Timer deadline={state.deadline} totalSeconds={state.settings.questionTime} />}
      </div>
      <div className="category-label">{question.category}</div>
      <h1>{question.question}</h1>
      {question.type === "image" && question.image && <ImageClue src={question.image} alt={question.question} />}

      {reveal ? (
        <div className="reveal-card">
          <span>The answer is</span>
          <strong>{state.reveal?.correctAnswer}</strong>
          <p>{state.reveal?.correctPlayerIds.length || 0} party members got it right</p>
        </div>
      ) : isPassive ? (
        <div className="passive-wait"><span>◉</span><p>Watch closely. The answer reveals when the timer ends.</p></div>
      ) : state.settings.mode === "typed" ? (
        <form className="typed-form" onSubmit={(event) => { event.preventDefault(); submitAnswer(typedAnswer); }}>
          <input
            autoFocus
            value={typedAnswer}
            disabled={meHasAnswered}
            onChange={(event) => setTypedAnswer(event.target.value)}
            placeholder="Type your answer…"
            maxLength={100}
          />
          <button className="button button--primary" disabled={meHasAnswered || !typedAnswer.trim()}>
            {meHasAnswered ? "Locked in ✓" : "Lock it in"}
          </button>
        </form>
      ) : (
        <div className="answer-grid">
          {question.answers.map((answer, index) => {
            const eliminated = state.eliminatedAnswers.includes(answer);
            return (
              <button
                key={answer}
                disabled={meHasAnswered || eliminated}
                className={`answer-card answer-card--${index % 4} ${selectedAnswer === answer ? "is-selected" : ""} ${eliminated ? "is-eliminated" : ""}`}
                onClick={() => submitAnswer(answer)}
              >
                <span>{answerLetters[index]}</span>
                <strong>{eliminated ? "Vanished" : answer}</strong>
              </button>
            );
          })}
        </div>
      )}
      {!reveal && !isPassive && <div className="answer-count">{answerCount} of {state.players.length} locked in</div>}
    </div>
  );
}

function Scoreboard({ state, isHost, onNext }: { state: RoomState; isHost: boolean; onNext: () => void }) {
  const ranked = useMemo(() => [...state.players].sort((a, b) => b.score - a.score), [state.players]);
  const remaining = useCountdown(state.transitionDeadline);
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className="score-screen">
      <span className="eyebrow">After round {state.roundIndex + 1}</span>
      <h1>Party standings</h1>
      <div className="score-list">
        {ranked.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span className="rank">{index + 1}</span>
            <div className="avatar">{player.avatar ? <img src={player.avatar} alt="" /> : player.name[0]}</div>
            <strong>{player.name}</strong>
            {player.lastAward > 0 && <span className="award">+{player.lastAward}</span>}
            <b>{player.score.toLocaleString()}</b>
          </div>
        ))}
      </div>
      <div className="next-question-countdown" role="timer" aria-live="polite">
        <span>Next question in</span>
        <strong>{seconds}</strong>
      </div>
      {isHost && <button className="button button--ghost" onClick={onNext}>Start now →</button>}
    </div>
  );
}

function FinalResults({ state, isHost, onRestart }: { state: RoomState; isHost: boolean; onRestart: () => void }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  return (
    <div className="final-screen">
      <div className="confetti">✦ · ✧ · ✦</div>
      <span className="eyebrow">The adventure is complete</span>
      <h1>{winner.name} wins!</h1>
      <div className="winner-avatar"><span>♛</span>{winner.avatar ? <img src={winner.avatar} alt="" /> : winner.name[0]}</div>
      <strong className="winner-score">{winner.score.toLocaleString()} points</strong>
      <div className="podium">
        {ranked.slice(0, 3).map((player, index) => <div key={player.id} className={`podium__place podium__place--${index + 1}`}><span>#{index + 1}</span><strong>{player.name}</strong><small>{player.score.toLocaleString()}</small></div>)}
      </div>
      {isHost ? <button className="button button--primary button--large" onClick={onRestart}>Return to lobby</button> : <p>Waiting for the host…</p>}
    </div>
  );
}

export default App;
