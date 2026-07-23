import { DiscordSDK } from "@discord/embedded-app-sdk";
import { apiUrl, isEmbedded } from "./environment";

export interface DiscordIdentity {
  name: string;
  avatar?: string;
  discordUserId?: string;
}

export async function initializeDiscord(): Promise<DiscordIdentity | null> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId || !isEmbedded) return null;

  try {
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();

    const response = await fetch(apiUrl("/api/discord/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: (await sdk.commands.authorize({
        client_id: clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify"]
      })).code })
    });
    if (!response.ok) return null;
    const { access_token } = await response.json() as { access_token: string };
    const auth = await sdk.commands.authenticate({ access_token });
    if (!auth?.user) return null;
    const avatar = auth.user.avatar
      ? `https://cdn.discordapp.com/avatars/${auth.user.id}/${auth.user.avatar}.png?size=128`
      : undefined;
    return {
      name: auth.user.global_name || auth.user.username,
      avatar,
      discordUserId: auth.user.id
    };
  } catch (error) {
    console.warn("Discord SDK unavailable; using standalone mode.", error);
    return null;
  }
}
