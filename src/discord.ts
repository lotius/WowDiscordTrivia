import { DiscordSDK } from "@discord/embedded-app-sdk";
import { activityInstanceId, apiUrl, isEmbedded } from "./environment";

export interface DiscordIdentity {
  name: string;
  avatar?: string;
  discordUserId?: string;
  /** Shared by everyone who launched the activity in the same voice channel. */
  instanceId?: string;
}

export interface DiscordContext {
  /** Present whenever the page is running as an activity, authorised or not. */
  instanceId: string;
  /** Null when the player could not be identified; the game still runs. */
  identity: DiscordIdentity | null;
}

async function authorizeWithConsentFallback(sdk: DiscordSDK, clientId: string) {
  const request = {
    client_id: clientId,
    response_type: "code" as const,
    state: "",
    scope: ["identify" as const]
  };
  try {
    // Skip the consent dialog for players who have already authorised the app.
    return await sdk.commands.authorize({ ...request, prompt: "none" as const });
  } catch {
    // A first-time player has nothing to skip, and "none" fails outright rather
    // than asking. Retry so they get the consent dialog instead of being
    // dropped into a nameless fallback.
    return await sdk.commands.authorize(request);
  }
}

/**
 * Resolves the activity context. The instance id comes from the iframe URL, so
 * it survives an OAuth failure — players still share a room even if none of
 * them can be identified. Identity is best-effort on top of that.
 */
export async function initializeDiscord(): Promise<DiscordContext | null> {
  if (!isEmbedded) return null;

  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const context: DiscordContext = { instanceId: activityInstanceId, identity: null };
  if (!clientId) {
    console.warn("VITE_DISCORD_CLIENT_ID is empty; players will be unnamed.");
    return context;
  }

  try {
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();
    if (sdk.instanceId) context.instanceId = sdk.instanceId;

    const { code } = await authorizeWithConsentFallback(sdk, clientId);
    const response = await fetch(apiUrl("/api/discord/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    if (!response.ok) throw new Error(`Token exchange failed (${response.status}).`);

    const { access_token } = await response.json() as { access_token: string };
    const auth = await sdk.commands.authenticate({ access_token });
    if (!auth?.user) throw new Error("Discord returned no user.");

    context.identity = {
      name: auth.user.global_name || auth.user.username,
      avatar: auth.user.avatar
        ? `https://cdn.discordapp.com/avatars/${auth.user.id}/${auth.user.avatar}.png?size=128`
        : undefined,
      discordUserId: auth.user.id,
      instanceId: context.instanceId
    };
    return context;
  } catch (error) {
    // Losing identity is survivable; losing the shared room is not. Keep the
    // instance id so this player still joins everyone else.
    console.warn("Discord identification failed; joining unidentified.", error);
    return context;
  }
}
