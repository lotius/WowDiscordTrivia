import type { Player } from "../types";
import { Avatar } from "./Avatar";

export function PlayerRail({ players, phase }: { players: Player[]; phase: string }) {
  return (
    <aside className="player-rail">
      <div className="player-rail__title">
        <span>Party</span>
        <span className="pill">{players.filter((player) => player.connected).length}</span>
      </div>
      <div className="player-list">
        {[...players].sort((a, b) => b.score - a.score).map((player, index) => (
          <div className={`player-chip ${!player.connected ? "is-offline" : ""}`} key={player.id}>
            <div className="avatar">
              <Avatar name={player.name} src={player.avatar} />
              {phase === "final" && index === 0 && <span className="crown">♛</span>}
            </div>
            <div className="player-chip__copy">
              <strong>{player.name}{player.isHost ? " ★" : ""}</strong>
              <span>{player.score.toLocaleString()} pts</span>
            </div>
            {["question", "answering"].includes(phase) && (
              <span className={`answer-status ${player.hasAnswered ? "is-ready" : ""}`}>
                {player.hasAnswered ? "✓" : "…"}
              </span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
