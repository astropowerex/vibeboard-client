/**
 * discord_sdk.js
 * Initializes Discord Embedded App SDK when running as a Discord Activity.
 * Falls back gracefully to a standalone mode when opened in a regular browser.
 */

let discordSdk = null;
let auth = null;

export async function initDiscord() {
  const clientId = window.DISCORD_CLIENT_ID || "1513885618575511601";

  // Not in Discord iframe → standalone mode
  if (!clientId || !isInDiscordFrame()) {
    console.log("[Discord] Running in standalone mode");
    return {
      channelId: getOrCreateRoomId(),
      userId: getOrCreateUserId(),
      username: "Guest",
      standalone: true,
    };
  }

  try {
    const { DiscordSDK } = await import(
      "https://esm.sh/@discord/embedded-app-sdk"
    );
    discordSdk = new DiscordSDK(clientId);

    await discordSdk.ready();

    const { code } = await discordSdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "guilds"],
    });

    // Exchange code for access token via your backend (or use implicit grant)
    const tokenResp = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const { access_token } = await tokenResp.json();

    auth = await discordSdk.commands.authenticate({ access_token });

    const channelId = discordSdk.channelId ?? getOrCreateRoomId();
    const userId = auth?.user?.id ?? getOrCreateUserId();
    const username = auth?.user?.username ?? "User";

    console.log(`[Discord] Auth OK. Channel: ${channelId}, User: ${username}`);

    return { channelId, userId, username, standalone: false };
  } catch (err) {
    console.warn("[Discord] SDK init failed, falling back:", err);
    return {
      channelId: getOrCreateRoomId(),
      userId: getOrCreateUserId(),
      username: "Guest",
      standalone: true,
    };
  }
}

function isInDiscordFrame() {
  try {
    return (
      window.parent !== window ||
      window.location.search.includes("frame_id") ||
      navigator.userAgent.includes("Discord")
    );
  } catch {
    return false;
  }
}

function getOrCreateRoomId() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("room")) return params.get("room");
  const stored = sessionStorage.getItem("wb_room");
  if (stored) return stored;
  const id = "room_" + Math.random().toString(36).slice(2, 10);
  sessionStorage.setItem("wb_room", id);
  return id;
}

function getOrCreateUserId() {
  let id = localStorage.getItem("wb_uid");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("wb_uid", id);
  }
  return id;
}
