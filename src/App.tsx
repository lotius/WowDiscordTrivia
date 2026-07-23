import { FormEvent, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Admin } from "./components/Admin";
import { ImageClue } from "./components/ImageClue";
import { PlayerRail } from "./components/PlayerRail";
import { Timer } from "./components/Timer";
import { initializeDiscord, type DiscordIdentity } from "./discord";
import { useCountdown } from "./hooks/useCountdown";
import type { CategorySummary, GameMode, GameSettings, RoomState } from "./types";

const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket = io(serverUrl, { autoConnect: true });
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

  const me = state?.players.find((player) => player.id === playerId);
  const isHost = state?.hostId === playerId;

  async function loadLibrary() {
    const response = await fetch("/api/categories");
    if (response.ok) setCategories(await response.json());
  }

  useEffect(() => {
    initializeDiscord().then((discordIdentity) => {
      if (discordIdentity) {
        setIdentity(discordIdentity);
        setName(discordIdentity.name);
      }
    });
    loadLibrary().catch(() => undefined);
  }, []);

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
      image.src = source;
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
  error
}: {
  state: RoomState;
  categories: CategorySummary[];
  isHost: boolean;
  updateSettings: (settings: Partial<GameSettings>) => void;
  startGame: () => void;
  error: string;
}) {
  const settings = state.settings;
  return (
    <div className="lobby-screen">
      <div className="lobby-heading">
        <span className="eyebrow">Your party is assembling</span>
        <h1>Room <button onClick={() => navigator.clipboard?.writeText(state.code)}>{state.code} ⧉</button></h1>
        <p>Invite friends to this Activity, or share the room code.</p>
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
