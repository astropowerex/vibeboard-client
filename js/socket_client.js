/**
 * socket_client.js
 * WebSocket connection handler — connects to the FastAPI backend,
 * routes incoming messages to registered handlers.
 */

export class SocketClient {
  constructor({ serverUrl, roomId, userId, onMessage, onOpen, onClose }) {
    this.serverUrl = serverUrl;
    this.roomId = roomId;
    this.userId = userId;
    this.onMessageCb = onMessage;
    this.onOpenCb = onOpen;
    this.onCloseCb = onClose;

    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 16000;
    this.shouldReconnect = true;
    this.pingInterval = null;
    this.connected = false;
  }

  connect() {
    const url = `${this.serverUrl}/ws/${this.roomId}?user_id=${this.userId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      console.log(`[WS] Connected to room ${this.roomId}`);
      this._startPing();
      this.onOpenCb?.();
    };

    this.ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        this.onMessageCb?.(data);
      } catch (e) {
        console.warn("[WS] Bad JSON:", evt.data);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._stopPing();
      this.onCloseCb?.();
      if (this.shouldReconnect) {
        console.log(`[WS] Reconnecting in ${this.reconnectDelay}ms…`);
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = (e) => {
      console.error("[WS] Error:", e);
    };
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this._stopPing();
    this.ws?.close();
  }

  _startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, 25000);
  }

  _stopPing() {
    clearInterval(this.pingInterval);
  }
}
