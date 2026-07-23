import { useEffect, useState } from "react";

export function useCountdown(deadline?: number) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, (deadline ?? Date.now()) - Date.now()));
    tick();
    const interval = window.setInterval(tick, 100);
    return () => window.clearInterval(interval);
  }, [deadline]);

  return remaining;
}
