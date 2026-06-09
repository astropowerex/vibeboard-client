/**
 * canvas_drawer.js
 * All drawing logic: local rendering + stroke serialization for WS.
 * Supports: pencil, eraser, shapes (rect, circle, line, arrow), text tool,
 * fill bucket, laser pointer, and smooth Bezier curve drawing.
 */

export class CanvasDrawer {
  constructor({ canvas, onStrokePoint, onStrokeEnd, onStrokeStart }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onStrokePoint = onStrokePoint;
    this.onStrokeEnd = onStrokeEnd;
    this.onStrokeStart = onStrokeStart;

    // Tool state
    this.tool = "pencil";
    this.color = "#ffffff";
    this.size = 4;
    this.opacity = 1;

    // Drawing state
    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.startX = 0;
    this.startY = 0;
    this.currentPoints = [];
    this.strokeId = null;

    // Snapshot for shape preview
    this.snapshot = null;

    // Remote cursors
    this.remoteCursors = {};
    this.cursorCanvas = document.createElement("canvas");
    this.cursorCtx = this.cursorCanvas.getContext("2d");
    this.cursorCanvas.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:10;";
    canvas.parentElement?.appendChild(this.cursorCanvas);

    // Text tool
    this.textInput = null;

    this._bindEvents();
    this._resizeObserver();
  }

  // ─── Resize ────────────────────────────────────────────────────────────────
  _resizeObserver() {
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement || document.body);
    this._resize();
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (this.canvas.width === w && this.canvas.height === h) return;

    // Preserve content during resize
    const tmp = document.createElement("canvas");
    tmp.width = this.canvas.width;
    tmp.height = this.canvas.height;
    tmp.getContext("2d").drawImage(this.canvas, 0, 0);

    this.canvas.width = w;
    this.canvas.height = h;
    this.cursorCanvas.width = w;
    this.cursorCanvas.height = h;
    this.ctx.drawImage(tmp, 0, 0);
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("mousedown", (e) => this._onStart(this._pos(e)));
    c.addEventListener("mousemove", (e) => this._onMove(this._pos(e)));
    c.addEventListener("mouseup", (e) => this._onEnd(this._pos(e)));
    c.addEventListener("mouseleave", (e) => this._onEnd(this._pos(e)));
    c.addEventListener("touchstart", (e) => { e.preventDefault(); this._onStart(this._posTouch(e)); }, { passive: false });
    c.addEventListener("touchmove", (e) => { e.preventDefault(); this._onMove(this._posTouch(e)); }, { passive: false });
    c.addEventListener("touchend", (e) => { e.preventDefault(); this._onEnd(this._posTouch(e)); }, { passive: false });
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _posTouch(e) {
    const t = e.touches[0] || e.changedTouches[0];
    return this._pos(t);
  }

  // ─── Tool dispatch ─────────────────────────────────────────────────────────
  _onStart({ x, y }) {
    if (this.tool === "text") { this._startText(x, y); return; }
    if (this.tool === "fill") { this._fill(x, y); return; }

    this.isDrawing = true;
    this.lastX = x; this.lastY = y;
    this.startX = x; this.startY = y;
    this.currentPoints = [{ x, y }];
    this.strokeId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

    if (this._isShape()) {
      this.snapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    this.ctx.beginPath();
    this.ctx.moveTo(x, y);

    this.onStrokeStart?.({
      type: "stroke_start",
      tool: this.tool,
      color: this.color,
      size: this.size,
      opacity: this.opacity,
      x, y,
      strokeId: this.strokeId,
    });
  }

  _onMove({ x, y }) {
    if (!this.isDrawing) return;
    this.currentPoints.push({ x, y });

    if (this._isShape()) {
      // Preview shape
      this.ctx.putImageData(this.snapshot, 0, 0);
      this._drawShape(this.startX, this.startY, x, y, false);
    } else {
      this._drawSegment(this.lastX, this.lastY, x, y);
    }

    this.lastX = x; this.lastY = y;

    this.onStrokePoint?.({
      type: "stroke_point",
      x, y,
      lx: this.lastX,
      ly: this.lastY,
      strokeId: this.strokeId,
      tool: this.tool,
      color: this.color,
      size: this.size,
      opacity: this.opacity,
    });
  }

  _onEnd({ x, y }) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this._isShape()) {
      this.ctx.putImageData(this.snapshot, 0, 0);
      this._drawShape(this.startX, this.startY, x, y, true);
    }

    this.onStrokeEnd?.({
      type: "stroke_end",
      action: "stroke_end",
      tool: this.tool,
      color: this.color,
      size: this.size,
      opacity: this.opacity,
      points: this.currentPoints,
      startX: this.startX,
      startY: this.startY,
      endX: x,
      endY: y,
      strokeId: this.strokeId,
    });

    this.currentPoints = [];
    this.snapshot = null;
  }

  // ─── Drawing primitives ────────────────────────────────────────────────────
  _drawSegment(x1, y1, x2, y2) {
    const ctx = this.ctx;
    ctx.globalAlpha = this.opacity;

    if (this.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = this.color;
    }

    ctx.lineWidth = this.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    // Smooth bezier
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(x1, y1, mx, my);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  _drawShape(x1, y1, x2, y2, commit = true) {
    const ctx = this.ctx;
    ctx.globalAlpha = this.opacity;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = this.size;
    ctx.lineCap = "round";

    switch (this.tool) {
      case "rect":
        ctx.beginPath();
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        break;
      case "rect_fill":
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        break;
      case "circle": {
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        ctx.beginPath();
        ctx.ellipse(
          Math.min(x1, x2) + rx,
          Math.min(y1, y2) + ry,
          rx, ry, 0, 0, Math.PI * 2
        );
        ctx.stroke();
        break;
      }
      case "line":
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      case "arrow":
        this._drawArrow(ctx, x1, y1, x2, y2);
        break;
    }

    ctx.globalAlpha = 1;
  }

  _drawArrow(ctx, x1, y1, x2, y2) {
    const headLen = Math.max(15, this.size * 3);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  _isShape() {
    return ["rect", "rect_fill", "circle", "line", "arrow"].includes(this.tool);
  }

  // ─── Fill bucket (flood fill) ──────────────────────────────────────────────
  _fill(x, y) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;

    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const idx = (ty * w + tx) * 4;
    const target = [data[idx], data[idx+1], data[idx+2], data[idx+3]];
    const fill = this._hexToRgba(this.color);

    if (this._colorsMatch(target, fill)) return;

    const stack = [[tx, ty]];
    const visited = new Uint8Array(w * h);

    while (stack.length) {
      const [px, py] = stack.pop();
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = py * w + px;
      if (visited[i]) continue;
      visited[i] = 1;
      const di = i * 4;
      if (!this._colorsMatch([data[di], data[di+1], data[di+2], data[di+3]], target)) continue;
      data[di] = fill[0]; data[di+1] = fill[1]; data[di+2] = fill[2]; data[di+3] = fill[3];
      stack.push([px+1,py],[px-1,py],[px,py+1],[px,py-1]);
    }

    ctx.putImageData(img, 0, 0);
  }

  _colorsMatch(a, b, tol = 20) {
    return Math.abs(a[0]-b[0]) < tol && Math.abs(a[1]-b[1]) < tol &&
           Math.abs(a[2]-b[2]) < tol && Math.abs(a[3]-b[3]) < tol;
  }

  _hexToRgba(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r, g, b, Math.round(this.opacity * 255)];
  }

  // ─── Text tool ─────────────────────────────────────────────────────────────
  _startText(x, y) {
    this._removeTextInput();
    const input = document.createElement("textarea");
    input.style.cssText = `
      position:absolute; left:${x}px; top:${y}px; min-width:120px; min-height:40px;
      background:transparent; border:1px dashed ${this.color}; color:${this.color};
      font-size:${Math.max(14, this.size * 3)}px; font-family:inherit;
      resize:both; outline:none; padding:4px; z-index:20; caret-color:${this.color};
    `;
    this.canvas.parentElement.style.position = "relative";
    this.canvas.parentElement.appendChild(input);
    input.focus();
    this.textInput = input;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this._commitText(x, y);
    });
    input.addEventListener("blur", () => this._commitText(x, y));
  }

  _commitText(x, y) {
    if (!this.textInput) return;
    const text = this.textInput.value;
    this._removeTextInput();
    if (!text.trim()) return;

    const ctx = this.ctx;
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = this.color;
    ctx.font = `${Math.max(14, this.size * 3)}px sans-serif`;
    text.split("\n").forEach((line, i) => {
      ctx.fillText(line, x, y + i * Math.max(18, this.size * 3.5));
    });
    ctx.globalAlpha = 1;

    this.onStrokeEnd?.({
      type: "stroke_end",
      action: "stroke_end",
      tool: "text",
      color: this.color,
      size: this.size,
      opacity: this.opacity,
      text,
      points: [{ x, y }],
      startX: x,
      startY: y,
    });
  }

  _removeTextInput() {
    this.textInput?.remove();
    this.textInput = null;
  }

  // ─── Replay remote strokes ─────────────────────────────────────────────────
  replayStroke(stroke) {
    const ctx = this.ctx;
    const { tool, color, size, opacity, points, startX, startY, endX, endY, text } = stroke;

    ctx.globalAlpha = opacity ?? 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "text") {
      ctx.font = `${Math.max(14, size * 3)}px sans-serif`;
      (text || "").split("\n").forEach((line, i) => {
        ctx.fillText(line, startX, startY + i * Math.max(18, size * 3.5));
      });
    } else if (["rect", "rect_fill", "circle", "line", "arrow"].includes(tool)) {
      this._drawShape(startX, startY, endX, endY, true);
    } else if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      this._replayPoints(points);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.strokeStyle = color;
      this._replayPoints(points);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  _replayPoints(points) {
    if (!points?.length) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const mx = (points[i-1].x + points[i].x) / 2;
      const my = (points[i-1].y + points[i].y) / 2;
      ctx.quadraticCurveTo(points[i-1].x, points[i-1].y, mx, my);
    }
    ctx.stroke();
  }

  // ─── Remote cursors ────────────────────────────────────────────────────────
  updateRemoteCursor(userId, x, y, color, name) {
    this.remoteCursors[userId] = { x, y, color, name };
    this._renderCursors();
  }

  removeRemoteCursor(userId) {
    delete this.remoteCursors[userId];
    this._renderCursors();
  }

  _renderCursors() {
    const ctx = this.cursorCtx;
    ctx.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);

    for (const [id, { x, y, color, name }] of Object.entries(this.remoteCursors)) {
      ctx.save();
      ctx.translate(x, y);

      // Cursor dot
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Name label
      ctx.font = "bold 11px sans-serif";
      const w = ctx.measureText(name).width + 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect?.(8, -10, w, 18, 4) || ctx.rect(8, -10, w, 18);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(name, 12, 3);
      ctx.restore();
    }
  }

  // ─── Undo / Clear ──────────────────────────────────────────────────────────
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  replayAll(strokes) {
    this.clear();
    for (const s of strokes) this.replayStroke(s);
  }

  // ─── Tool setters ──────────────────────────────────────────────────────────
  setTool(t) { this.tool = t; }
  setColor(c) { this.color = c; }
  setSize(s) { this.size = s; }
  setOpacity(o) { this.opacity = o; }

  getDataURL() {
    return this.canvas.toDataURL("image/png");
  }
}
