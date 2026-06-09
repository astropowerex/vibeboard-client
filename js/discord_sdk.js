/**
 * discord_sdk.js
 * Initializes Discord Embedded App SDK when running as a Discord Activity.
 * Falls back gracefully to a standalone mode when opened in a regular browser.
 */

export async function initDiscord() {
  const clientId = "1513885618575511601"; // Твой ID

  // Функция проверки: в Дискорде мы или нет
  const isInDiscord = window.location.search.includes("frame_id") || navigator.userAgent.includes("Discord");

  if (!isInDiscord) {
    console.log("[VibeBoard] Standalone Mode");
    return {
      channelId: getOrCreateRoomId(),
      userId: getOrCreateUserId(),
      username: "Guest_" + Math.floor(Math.random() * 1000),
      standalone: true,
    };
  }

  try {
    // Если мы здесь — мы в Дискорде. Пытаемся подключить SDK.
    const { DiscordSDK } = await import("https://esm.sh/@discord/embedded-app-sdk");
    const discordSdk = new DiscordSDK(clientId);
    await discordSdk.ready();

    // Просто используем ID канала как ID комнаты без сложной авторизации для начала
    return {
      channelId: discordSdk.channelId || getOrCreateRoomId(),
      userId: getOrCreateUserId(),
      username: "User",
      standalone: false
    };
  } catch (err) {
    console.warn("[VibeBoard] SDK failed, fallback to standalone", err);
    return {
      channelId: getOrCreateRoomId(),
      userId: getOrCreateUserId(),
      username: "Guest",
      standalone: true
    };
  }
}

function getOrCreateRoomId() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("room")) return params.get("room");
  let id = sessionStorage.getItem("wb_room") || "room_" + Math.random().toString(36).slice(2, 8);
  sessionStorage.setItem("wb_room", id);
  return id;
}

function getOrCreateUserId() {
  let id = localStorage.getItem("wb_uid") || "u_" + Math.random().toString(36).slice(2, 8);
  localStorage.setItem("wb_uid", id);
  return id;
}
