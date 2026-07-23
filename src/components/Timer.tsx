import { useCountdown } from "../hooks/useCountdown";

export function Timer({ deadline, totalSeconds }: { deadline?: number; totalSeconds: number }) {
  const remaining = useCountdown(deadline);
  const seconds = Math.ceil(remaining / 1000);
  const ratio = Math.max(0, Math.min(1, remaining / (totalSeconds * 1000)));

  return (
    <div className={`timer ${seconds <= 5 ? "timer--urgent" : ""}`} aria-label={`${seconds} seconds remaining`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="timer__track" cx="24" cy="24" r="20" />
        <circle
          className="timer__fill"
          cx="24"
          cy="24"
          r="20"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - ratio * 100}
        />
      </svg>
      <span>{seconds}</span>
    </div>
  );
}
