import { useState } from "react";

/**
 * Avatar images come from Discord's CDN, which is the one external host the app
 * still touches at runtime. A blocked or failed request would otherwise leave a
 * broken-image icon, so fall back to the player's initial instead.
 */
export function Avatar({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name.slice(0, 1).toUpperCase() || "?";

  if (!src || failed) return <>{initial}</>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}
