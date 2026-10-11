import type { BoardObject, Bounds, Pt, ShapeName, Tool } from './types';
import { distance, objectHitTest, snappedPoint } from './geometry';
import { drawGrid, drawObject, isObjectVisible, screenToWorld } from './render';
import { createImageObject, loadImageFromFile } from './images';
import {
  type HandleName,
  boundsIntersect,
  getHandlePositions,
  getObjectBounds,
  getResizeHandle,
  getTopmostObjectAt,
  moveObject,
  resizeBoundsFromHandle,
  resizeImageFromHandle,
  resizeObject,
  screenBounds,
  selectionHitTest,
  unionBounds,
} from './selection';
import { BoardStore, cloneObject, cloneObjects } from './store';
import type { RemoteCursor, RemoteDraft } from './sync';

export const ACCENT = '#4262ff';

export interface EngineHooks {
  /** Изменилось то, что показывает интерфейс (инструмент, масштаб, выделение, история). */
  onUi: () => void;
  /** Мой курсор в координатах доски (null — курсор ушёл). */
  onCursor: (p: Pt | null) => void;
  /** Идёт рисование: можно показать штрих остальным «вживую». */
  onDraft: (o: BoardObject) => void;
  /** Рисование отменено без сохранения. */
  onDraftEnd: (id: string) => void;
}

type Interaction =
  | { type: 'move'; startWorld: Pt; roots: string[]; beforeObjects: BoardObject[] }
  | { type: 'resize'; objectId: string; handle: HandleName; oldBounds: Bounds; beforeLinked: BoardObject[] };


export class BoardEngine {
  tool: Tool = 'pen';
  shape: ShapeName = 'rect';
  color = '#1a1a1a';
  brushSize = 5;
  readonly eraserRadius = 24;

  zoom = 1;
  camera: Pt = { x: -60, y: -40 };
  readonly minZoom = 0.1;
  readonly maxZoom = 4;

  selectedIds: string[] = [];
  remoteCursors: Map<string, RemoteCursor> = new Map();
  remoteDrafts: Map<string, RemoteDraft> = new Map();
  /** Плавно «догоняющие» позиции чужих курсоров. */
  private shown = new Map<string, { x: number; y: number }>();
  private lastCursorFrame = 0;

  private scene: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private rect = { left: 0, top: 0 };

  private pointer = { sx: -1, sy: -1, wx: 0, wy: 0 };
  private touchInput = false;
  private drawing = false;
  private panning = false;
  private panStart: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private current: BoardObject | null = null;
  private selectionBox: { start: Pt; current: Pt; additive: boolean } | null = null;
  private interaction: Interaction | null = null;
  private erased = false;
  private spacePressed = false;
  private pendingText: Pt | null = null;
  private editor: { el: HTMLTextAreaElement; id: string | null; at: Pt; fontSize: number; done: boolean } | null = null;
  private hiddenId: string | null = null;

  // Жесты двумя пальцами (телефон): масштаб + перемещение.
  private pointers = new Map<number, Pt>();
  private gesture: { dist: number; zoom: number; mid: Pt; camera: Pt } | null = null;
  private gestureLock = false;

  private raf = 0;
  private overlayRaf = 0;
  private uiRaf = 0;
  private disposers: Array<() => void> = [];
  private dpr = 1;

  constructor(private container: HTMLElement, readonly store: BoardStore, private hooks: EngineHooks) {
    this.scene = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.scene.className = 'wb-canvas';
    this.overlay.className = 'wb-canvas wb-overlay';
    container.append(this.scene, this.overlay);
    this.ctx = this.scene.getContext('2d', { alpha: false })!;
    this.octx = this.overlay.getContext('2d')!;

    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn as EventListener);
      this.disposers.push(() => window.removeEventListener(type, fn as EventListener));
    };

    on(this.overlay, 'pointerdown', (e) => this.onPointerDown(e));
    on(this.overlay, 'pointermove', (e) => this.onPointerMove(e));
    on(this.overlay, 'pointerup', (e) => this.onPointerUp(e));
    on(this.overlay, 'pointercancel', (e) => this.onPointerUp(e));
    on(this.overlay, 'pointerleave', () => {
      if (!this.drawing && !this.panning && !this.interaction && !this.selectionBox) {
        this.pointer.sx = -1;
        this.pointer.sy = -1;
        this.hooks.onCursor(null);
        this.requestOverlay();
      }
    });
    on(this.overlay, 'dblclick', (e) => this.onDoubleClick(e));
    on(this.overlay, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(this.overlay, 'contextmenu', (e) => e.preventDefault());
    on(this.overlay, 'dragover', (e) => e.preventDefault());
    on(this.overlay, 'drop', (e) => this.onDrop(e));
    onWin('keydown', (e) => this.onKeyDown(e));
    onWin('keyup', (e) => this.onKeyUp(e));
    onWin('paste', (e) => this.onPaste(e));
    onWin('resize', () => this.resize());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(store.subscribe(() => {
      this.selectedIds = this.selectedIds.filter((id) => this.store.objects.some((o) => o.id === id));
      this.requestScene();
      this.notifyUi();
    }));

    this.resize();
    this.applyCursorStyle();
  }

  destroy() {
    this.finishEditor(true);
    this.disposers.forEach((d) => d());
    this.disposers = [];
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.overlayRaf);
    cancelAnimationFrame(this.uiRaf);
    this.scene.remove();
    this.overlay.remove();
  }

  /* ───────────────────────── Состояние для интерфейса ───────────────────────── */

  get objects() { return this.store.objects; }
  set objects(v: BoardObject[]) { this.store.objects = v; }
  get hasSelection() { return this.selectedIds.length > 0; }
  get zoomPercent() { return Math.round(this.zoom * 100); }

  private notifyUi() {
    if (this.uiRaf) return;
    this.uiRaf = requestAnimationFrame(() => { this.uiRaf = 0; this.hooks.onUi(); });
  }

  setTool(tool: Tool) {
    this.finishEditor(false);
    this.tool = tool;
    if (tool !== 'select') this.setSelection([]);
    this.applyCursorStyle();
    this.requestOverlay();
    this.notifyUi();
  }

  setShape(shape: ShapeName) {
    this.finishEditor(false);
    this.shape = shape;
    this.tool = 'shape';
    this.setSelection([]);
    this.applyCursorStyle();
    this.requestOverlay();
    this.notifyUi();
  }

  setColor(color: string) {
    this.color = color;
    // Если что-то выделено — перекрашиваем выделенное (как в Miro).
    const sel = this.selectedObjects();
    if (sel.length) {
      let changed = false;
      for (const o of sel) {
        if (o.type !== 'image') { o.color = color; changed = true; }
      }
      if (changed) { this.store.commit(); this.requestScene(); }
    }
    this.requestOverlay();
    this.notifyUi();
  }

  setBrushSize(size: number) {
    this.brushSize = size;
    this.requestOverlay();
    this.notifyUi();
  }

  undo() { if (this.store.undo()) { this.setSelection([]); this.requestScene(); } }
  redo() { if (this.store.redo()) { this.setSelection([]); this.requestScene(); } }

  clear() {
    if (!this.objects.length) return;
    this.objects = [];
    this.setSelection([]);
    this.store.commit();
    this.requestScene();
  }

  deleteSelected() {
    if (!this.selectedIds.length) return;
    const remove = new Set<string>();
    for (const id of this.selectedIds) this.descendantIds(id).forEach((x) => remove.add(x));
    this.objects = this.objects.filter((o) => !remove.has(o.id));
    this.setSelection([]);
    this.store.commit();
    this.requestScene();
  }

  async insertImageFile(file: File, center?: Pt) {
    const image = await loadImageFromFile(file);
    const at = center ?? screenToWorld(this.width / 2, this.height / 2, this.zoom, this.camera);
    const obj = createImageObject(image, at);
    this.objects = [...this.objects, obj];
    this.setSelection([obj.id]);
    this.setToolQuiet('select');
    this.store.commit();
    this.requestScene();
  }

  private setToolQuiet(tool: Tool) {
    this.tool = tool;
    this.applyCursorStyle();
    this.notifyUi();
  }

  /* ───────────────────────── Камера ───────────────────────── */

  zoomAtScreen(sx: number, sy: number, factor: number) {
    const before = screenToWorld(sx, sy, this.zoom, this.camera);
    const z = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (z === this.zoom) return;
    this.zoom = z;
    this.camera.x = before.x - sx / z;
    this.camera.y = before.y - sy / z;
    this.requestScene();
    this.notifyUi();
  }

  zoomBy(factor: number) { this.zoomAtScreen(this.width / 2, this.height / 2, factor); }

  resetZoom() {
    const c = screenToWorld(this.width / 2, this.height / 2, this.zoom, this.camera);
    this.zoom = 1;
    this.camera.x = c.x - this.width / 2;
    this.camera.y = c.y - this.height / 2;
    this.requestScene();
    this.notifyUi();
  }

  fit() {
    const b = unionBounds(this.objects);
    if (!b) {
      this.zoom = 1;
      this.camera = { x: -60, y: -40 };
    } else {
      const pad = 100;
      const zx = (this.width - pad * 2) / Math.max(1, b.width);
      const zy = (this.height - pad * 2) / Math.max(1, b.height);
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(zx, zy, 2)));
      this.camera.x = b.x + b.width / 2 - this.width / 2 / this.zoom;
      this.camera.y = b.y + b.height / 2 - this.height / 2 / this.zoom;
    }
    this.requestScene();
    this.notifyUi();
  }

  /* ───────────────────────── Отрисовка ───────────────────────── */

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.rect = { left: r.left, top: r.top };
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    for (const c of [this.scene, this.overlay]) {
      c.width = Math.round(this.width * this.dpr);
      c.height = Math.round(this.height * this.dpr);
      c.style.width = `${this.width}px`;
      c.style.height = `${this.height}px`;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.requestScene();
  }

  requestScene() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.drawScene();
      this.drawOverlay();
    });
  }

  requestOverlay() {
    if (this.overlayRaf) return;
    this.overlayRaf = requestAnimationFrame(() => {
      this.overlayRaf = 0;
      this.drawOverlay();
    });
  }

  private drawScene() {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height, this.zoom, this.camera);
    for (const o of this.objects) {
      if (!isObjectVisible(o, this.zoom, this.camera, width, height)) continue;
      drawObject(ctx, o, this.zoom, this.camera, { skipId: this.hiddenId });
    }
  }

  private drawOverlay() {
    const { octx, width, height } = this;
    octx.clearRect(0, 0, width, height);

    if (this.drawing && this.current && this.tool !== 'eraser') {
      drawObject(octx, this.current, this.zoom, this.camera, { preview: true });
    }
    if (this.selectionBox) this.drawMarquee();
    if (this.selectedIds.length && !this.editor) this.drawSelectionBox();
    this.drawRemoteDrafts();
    const animating = this.drawRemoteCursors();
    if (animating) this.requestOverlay();

    if (this.tool === 'pen' || this.tool === 'eraser' || this.tool === 'shape') {
      const { sx, sy } = this.pointer;
      if (sx >= 0 && sy >= 0 && !this.gesture && !this.touchInput) {
        const eraser = this.tool === 'eraser';
        if (eraser || this.tool === 'pen') {
          octx.save();
          octx.beginPath();
          octx.arc(sx, sy, Math.max(1.5, (eraser ? this.eraserRadius : this.brushSize / 2) * this.zoom), 0, Math.PI * 2);
          octx.fillStyle = eraser ? 'rgba(71,85,105,.14)' : 'rgba(15,23,42,.08)';
          octx.strokeStyle = eraser ? 'rgba(71,85,105,.65)' : 'rgba(17,24,39,.4)';
          octx.lineWidth = 1;
          octx.fill();
          octx.stroke();
          octx.restore();
        }
      }
    }
  }

  private drawSelectionBox() {
    const b = unionBounds(this.selectedObjects());
    if (!b) return;
    const box = screenBounds(b, this.zoom, this.camera);
    const o = this.octx;
    o.save();
    o.strokeStyle = ACCENT;
    o.lineWidth = 1.5;
    o.strokeRect(box.x, box.y, box.width, box.height);
    if (this.selectedIds.length === 1) {
      const handles = getHandlePositions(b);
      for (const p of Object.values(handles)) {
        const sx = (p.x - this.camera.x) * this.zoom;
        const sy = (p.y - this.camera.y) * this.zoom;
        o.fillStyle = '#fff';
        o.strokeStyle = ACCENT;
        o.lineWidth = 1.5;
        o.beginPath();
        o.arc(sx, sy, 5, 0, Math.PI * 2);
        o.fill();
        o.stroke();
      }
    }
    o.restore();
  }

  private drawMarquee() {
    const sb = this.selectionBox!;
    const b = normalizeBox(sb.start, sb.current);
    const s = screenBounds(b, this.zoom, this.camera);
    const o = this.octx;
    o.save();
    o.fillStyle = 'rgba(66,98,255,.08)';
    o.strokeStyle = ACCENT;
    o.lineWidth = 1;
    o.fillRect(s.x, s.y, s.width, s.height);
    o.strokeRect(s.x, s.y, s.width, s.height);
    o.restore();
  }

  private drawRemoteDrafts() {
    const now = performance.now();
    for (const [id, d] of this.remoteDrafts) {
      if (now - d.at > 6000) { this.remoteDrafts.delete(id); continue; }
      if (this.objects.some((o) => o.id === id)) continue; // уже сохранён
      drawObject(this.octx, d.obj, this.zoom, this.camera, { preview: true });
    }
  }

  /** Рисует курсоры других участников с плавной интерполяцией. Возвращает true, пока что-то движется. */
  private drawRemoteCursors(): boolean {
    const o = this.octx;
    const now = performance.now();
    const dt = this.lastCursorFrame ? Math.min(100, now - this.lastCursorFrame) : 16;
    this.lastCursorFrame = now;
    // Экспоненциальное сглаживание: ~70 мс «догоняния» — движение плавное даже при редких пакетах.
    const k = 1 - Math.exp(-dt / 70);
    let moving = false;

    for (const [id, c] of this.remoteCursors) {
      if (now - c.at > 8000) { this.shown.delete(id); continue; }
      let s = this.shown.get(id);
      if (!s) { s = { x: c.x, y: c.y }; this.shown.set(id, s); }
      s.x += (c.x - s.x) * k;
      s.y += (c.y - s.y) * k;
      if (Math.abs(c.x - s.x) * this.zoom > 0.25 || Math.abs(c.y - s.y) * this.zoom > 0.25) moving = true;
      else { s.x = c.x; s.y = c.y; }

      const x = (s.x - this.camera.x) * this.zoom;
      const y = (s.y - this.camera.y) * this.zoom;
      if (x < -40 || y < -40 || x > this.width + 40 || y > this.height + 40) continue;
      const color = `hsl(${c.hue} 75% 45%)`;
      o.save();
      o.translate(x, y);
      o.fillStyle = color;
      o.strokeStyle = '#fff';
      o.lineWidth = 1.5;
      o.beginPath();
      o.moveTo(0, 0);
      o.lineTo(0, 16);
      o.lineTo(4.5, 12);
      o.lineTo(8.5, 19);
      o.lineTo(11, 17.8);
      o.lineTo(7, 11);
      o.lineTo(12.5, 11);
      o.closePath();
      o.fill();
      o.stroke();
      o.font = '600 12px Inter, Arial, sans-serif';
      const label = c.name || 'Гость';
      const w = o.measureText(label).width + 14;
      o.fillStyle = color;
      roundRect(o, 14, 18, w, 20, 10);
      o.fill();
      o.fillStyle = '#fff';
      o.textBaseline = 'middle';
      o.fillText(label, 21, 28.5);
      o.restore();
    }
    return moving;
  }

  /* ───────────────────────── Ввод ───────────────────────── */

  private applyCursorStyle(override?: string) {
    let cursor = 'crosshair';
    if (this.tool === 'select') cursor = 'default';
    else if (this.tool === 'hand') cursor = 'grab';
    else if (this.tool === 'eraser') cursor = 'none';
    else if (this.tool === 'text') cursor = 'text';
    this.overlay.style.cursor = override ?? cursor;
  }

  private updatePointer(e: PointerEvent | MouseEvent | WheelEvent) {
    if ('pointerType' in e && e.pointerType) this.touchInput = e.pointerType === 'touch' || e.pointerType === 'pen';
    this.rect = { left: this.container.getBoundingClientRect().left, top: this.container.getBoundingClientRect().top };
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const w = screenToWorld(sx, sy, this.zoom, this.camera);
    this.pointer = { sx, sy, wx: w.x, wy: w.y };
  }

  private onPointerDown(e: PointerEvent) {
    this.updatePointer(e);
    this.pointers.set(e.pointerId, { x: this.pointer.sx, y: this.pointer.sy });

    if (this.pointers.size >= 2) {
      this.beginGesture();
      return;
    }
    if (this.gestureLock) return;

    if (e.button === 1 || (e.button === 0 && (this.spacePressed || this.tool === 'hand'))) {
      e.preventDefault();
      this.startPan(e);
      return;
    }
    if (e.button !== 0) return;
    this.finishEditor(false);

    if (this.tool === 'select') { this.startSelection(e); return; }

    const start = { x: this.pointer.wx, y: this.pointer.wy };

    if (this.tool === 'text') {
      // Редактор открываем после отпускания кнопки — иначе браузер сразу уберёт фокус.
      this.pendingText = start;
      return;
    }

    this.drawing = true;
    this.overlay.setPointerCapture(e.pointerId);
    if (this.tool === 'pen') {
      this.current = { id: crypto.randomUUID(), type: 'stroke', color: this.color, size: this.brushSize, points: [start] } as BoardObject;
    } else if (this.tool === 'eraser') {
      this.erased = false;
      this.eraseAt(start);
    } else if (this.tool === 'shape') {
      this.current = { id: crypto.randomUUID(), type: this.shape, color: this.color, size: this.brushSize, x1: start.x, y1: start.y, x2: start.x, y2: start.y } as BoardObject;
    }
    this.requestOverlay();
  }

  private onPointerMove(e: PointerEvent) {
    this.updatePointer(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: this.pointer.sx, y: this.pointer.sy });

    if (this.gesture) { this.updateGesture(); return; }
    if (this.gestureLock) return;

    this.hooks.onCursor({ x: this.pointer.wx, y: this.pointer.wy });

    if (this.panning && this.panStart) {
      this.camera.x = this.panStart.cx - (this.pointer.sx - this.panStart.sx) / this.zoom;
      this.camera.y = this.panStart.cy - (this.pointer.sy - this.panStart.sy) / this.zoom;
      this.requestScene();
      return;
    }
    if (this.selectionBox) {
      this.selectionBox.current = { x: this.pointer.wx, y: this.pointer.wy };
      this.requestOverlay();
      return;
    }
    if (this.interaction) { this.moveInteraction(); return; }

    if (!this.drawing) {
      if (this.tool === 'select') {
        const h = this.handleAtPointer();
        if (h) this.applyCursorStyle({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h]);
        else this.applyCursorStyle(getTopmostObjectAt(this.objects, this.pointer.wx, this.pointer.wy) ? 'move' : 'default');
      }
      this.requestOverlay();
      return;
    }

    const cur = { x: this.pointer.wx, y: this.pointer.wy };
    const obj = this.current;

    if (this.tool === 'eraser') {
      this.eraseAt(cur);
      this.requestOverlay();
      return;
    }
    if (this.tool === 'pen' && obj) {
      if (e.shiftKey) {
        obj.points = [obj.points[0], snappedPoint(obj.points[0], cur)];
      } else {
        const last = obj.points[obj.points.length - 1];
        const minDist = Math.max(1.25, obj.size * 0.12);
        if (!last || Math.hypot(cur.x - last.x, cur.y - last.y) >= minDist) obj.points.push(cur);
      }
      this.hooks.onDraft(obj);
      this.requestOverlay();
      return;
    }
    if (this.tool === 'shape' && obj) {
      const next = e.shiftKey ? snappedPoint({ x: obj.x1, y: obj.y1 }, cur) : cur;
      obj.x2 = next.x;
      obj.y2 = next.y;
      this.hooks.onDraft(obj);
      this.requestOverlay();
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    try { this.overlay.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }

    if (this.gesture) {
      if (this.pointers.size < 2) { this.gesture = null; this.gestureLock = true; }
      if (this.pointers.size === 0) this.gestureLock = false;
      return;
    }
    if (this.gestureLock) {
      if (this.pointers.size === 0) this.gestureLock = false;
      return;
    }

    if (this.panning) { this.endPan(); return; }
    if (this.selectionBox) { this.finishMarquee(e.shiftKey); return; }
    if (this.interaction) { this.endInteraction(); return; }

    if (this.pendingText) {
      const at = this.pendingText;
      this.pendingText = null;
      const hit = this.objects.slice().reverse().find((o) => o.type === 'text' && selectionHitTest(o, at.x, at.y, 4));
      if (hit) this.startTextEdit({ id: hit.id }); else this.startTextEdit({ at });
      return;
    }

    if (!this.drawing) return;
    this.drawing = false;

    let changed = false;
    if (this.tool === 'eraser') {
      changed = this.erased;
    } else if (this.current) {
      if (objectSize(this.current) >= 1.5) {
        this.objects = [...this.objects, this.current];
        changed = true;
      } else {
        this.hooks.onDraftEnd(this.current.id);
      }
    }
    this.current = null;
    this.erased = false;
    if (changed) this.store.commit();
    this.requestScene();
  }

  private onDoubleClick(e: MouseEvent) {
    this.updatePointer(e);
    const hit = this.objects.slice().reverse().find((o) => o.type === 'text' && selectionHitTest(o, this.pointer.wx, this.pointer.wy, 4));
    if (hit) this.startTextEdit({ id: hit.id });
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.updatePointer(e);
    // Колесо — масштаб в точке курсора (как в исходной доске); pinch на тачпаде приходит как Ctrl+колесо.
    const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAtScreen(this.pointer.sx, this.pointer.sy, factor);
  }

  private async onDrop(e: DragEvent) {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    this.updatePointer(e);
    await this.insertImageFile(file, { x: this.pointer.wx, y: this.pointer.wy }).catch(() => {});
  }

  private async onPaste(e: ClipboardEvent) {
    if (isTypingTarget(e.target)) return;
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) await this.insertImageFile(file).catch(() => {});
  }

  private onKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    const typing = isTypingTarget(e.target);
    const mod = e.ctrlKey || e.metaKey;

    if (typing) return;
    if (mod && !e.shiftKey && key === 'z') { e.preventDefault(); this.undo(); return; }
    if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) { e.preventDefault(); this.redo(); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); this.deleteSelected(); return; }
    if (key === 'escape') {
      this.setSelection([]);
      this.selectionBox = null;
      this.interaction = null;
      this.requestScene();
      return;
    }
    if (mod) return;
    if (key === 'v') this.setTool('select');
    else if (key === 'h') this.setTool('hand');
    else if (key === 'p') this.setTool('pen');
    else if (key === 'e') this.setTool('eraser');
    else if (key === 't') this.setTool('text');
    else if (key === ' ') {
      this.spacePressed = true;
      e.preventDefault();
      this.applyCursorStyle('grab');
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    if (e.key === ' ') {
      this.spacePressed = false;
      this.applyCursorStyle();
    }
  }

  /* ───────────────────────── Жесты двумя пальцами ───────────────────────── */

  private beginGesture() {
    // Всё, что было начато одним пальцем, отменяем.
    if (this.drawing && this.current) this.hooks.onDraftEnd(this.current.id);
    this.drawing = false;
    this.current = null;
    this.selectionBox = null;
    this.panning = false;
    this.pendingText = null;
    if (this.interaction) {
      this.restoreSnapshots(this.interaction.type === 'move' ? this.interaction.beforeObjects : this.interaction.beforeLinked);
      this.interaction = null;
    }
    const [a, b] = [...this.pointers.values()];
    this.gesture = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: this.zoom,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      camera: { ...this.camera },
    };
    this.requestScene();
  }

  private updateGesture() {
    const g = this.gesture;
    if (!g || this.pointers.size < 2) return;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = Math.max(this.minZoom, Math.min(this.maxZoom, g.zoom * (dist / g.dist)));
    // Точка доски под серединой между пальцами остаётся под ней.
    const worldAtStart = screenToWorld(g.mid.x, g.mid.y, g.zoom, g.camera);
    this.zoom = z;
    this.camera.x = worldAtStart.x - mid.x / z;
    this.camera.y = worldAtStart.y - mid.y / z;
    this.requestScene();
    this.notifyUi();
  }

  /* ───────────────────────── Панорамирование ───────────────────────── */

  private startPan(e: PointerEvent) {
    this.panning = true;
    this.drawing = false;
    this.current = null;
    this.panStart = { sx: this.pointer.sx, sy: this.pointer.sy, cx: this.camera.x, cy: this.camera.y };
    this.overlay.setPointerCapture(e.pointerId);
    this.applyCursorStyle('grabbing');
  }

  private endPan() {
    this.panning = false;
    this.panStart = null;
    this.applyCursorStyle(this.spacePressed ? 'grab' : undefined);
    this.requestScene();
  }

  /* ───────────────────────── Выделение / перемещение / ресайз ───────────────────────── */

  selectedObjects() {
    const ids = new Set(this.selectedIds);
    return this.objects.filter((o) => ids.has(o.id));
  }

  private setSelection(ids: string[]) {
    const unique = [...new Set(ids)].filter((id) => this.objects.some((o) => o.id === id));
    const same = unique.length === this.selectedIds.length && unique.every((id, i) => id === this.selectedIds[i]);
    this.selectedIds = unique;
    if (!same) this.notifyUi();
    this.requestOverlay();
  }

  private descendantIds(rootId: string) {
    const ids = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const o of this.objects) {
        if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) { ids.add(o.id); changed = true; }
      }
    }
    return ids;
  }

  private selectionRoots() {
    const selected = new Set(this.selectedIds);
    return this.objects.filter((o) => {
      if (!selected.has(o.id)) return false;
      let parentId = o.parentId;
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = this.objects.find((x) => x.id === parentId)?.parentId;
      }
      return true;
    });
  }

  private moveTree(o: BoardObject, dx: number, dy: number) {
    moveObject(o, dx, dy);
    for (const child of this.objects) if (child.parentId === o.id) this.moveTree(child, dx, dy);
  }

  private snapshotByIds(ids: string[]) {
    const set = new Set(ids);
    return cloneObjects(this.objects.filter((o) => set.has(o.id)));
  }

  private restoreSnapshots(snaps: BoardObject[]) {
    const byId = new Map(snaps.map((o) => [o.id, o]));
    this.objects = this.objects.map((o) => (byId.has(o.id) ? cloneObject(byId.get(o.id)!) : o));
  }

  private handleAtPointer(): HandleName | null {
    if (this.selectedIds.length !== 1) return null;
    const o = this.selectedObjects()[0];
    const b = o && getObjectBounds(o);
    if (!b) return null;
    return getResizeHandle(screenBounds(b, this.zoom, this.camera), this.pointer.sx, this.pointer.sy) as HandleName | null;
  }

  private startSelection(e: PointerEvent) {
    const p = { x: this.pointer.wx, y: this.pointer.wy };
    const handle = this.handleAtPointer();

    if (handle) {
      const o = this.selectedObjects()[0];
      this.interaction = {
        type: 'resize', objectId: o.id, handle,
        oldBounds: { ...getObjectBounds(o)! },
        beforeLinked: this.snapshotByIds([...this.descendantIds(o.id)]),
      };
      this.overlay.setPointerCapture(e.pointerId);
      return;
    }

    const hit = getTopmostObjectAt(this.objects, p.x, p.y);
    if (!hit) {
      if (!e.shiftKey) this.setSelection([]);
      this.selectionBox = { start: p, current: p, additive: e.shiftKey };
      this.overlay.setPointerCapture(e.pointerId);
      this.requestOverlay();
      return;
    }

    if (e.shiftKey) {
      this.setSelection(this.selectedIds.includes(hit.id) ? this.selectedIds.filter((i) => i !== hit.id) : [...this.selectedIds, hit.id]);
    } else if (!this.selectedIds.includes(hit.id)) {
      this.setSelection([hit.id]);
    }

    const roots = this.selectionRoots();
    const ids = new Set<string>();
    for (const r of roots) this.descendantIds(r.id).forEach((id) => ids.add(id));
    if (this.selectedIds.length) {
      this.interaction = { type: 'move', startWorld: p, roots: roots.map((r) => r.id), beforeObjects: this.snapshotByIds([...ids]) };
      this.overlay.setPointerCapture(e.pointerId);
      this.applyCursorStyle('move');
    }
    this.requestOverlay();
  }

  private moveInteraction() {
    const it = this.interaction;
    if (!it) return;
    const p = { x: this.pointer.wx, y: this.pointer.wy };

    if (it.type === 'move') {
      this.restoreSnapshots(it.beforeObjects);
      const dx = p.x - it.startWorld.x;
      const dy = p.y - it.startWorld.y;
      for (const id of it.roots) {
        const root = this.objects.find((o) => o.id === id);
        if (root) this.moveTree(root, dx, dy);
      }
    } else {
      this.restoreSnapshots(it.beforeLinked);
      const o = this.objects.find((x) => x.id === it.objectId);
      if (!o) return;
      if (o.type === 'image') {
        resizeImageFromHandle(o, it.oldBounds, it.handle, p);
        this.transformChildren(it.beforeLinked, o);
      } else {
        resizeObject(o, it.oldBounds, resizeBoundsFromHandle(it.oldBounds, it.handle, p));
      }
    }
    this.requestScene();
  }

  private transformChildren(before: BoardObject[], parent: BoardObject) {
    const old = before.find((o) => o.id === parent.id);
    if (!old) return;
    const sx = parent.width / Math.max(1, old.width);
    const sy = parent.height / Math.max(1, old.height);
    for (const cb of before) {
      if (cb.id === parent.id || cb.parentId !== parent.id) continue;
      const child = this.objects.find((o) => o.id === cb.id);
      if (!child) continue;
      child.x = parent.x + (cb.x - old.x) * sx;
      child.y = parent.y + (cb.y - old.y) * sy;
      if (child.type === 'text') child.fontSize = Math.max(8, cb.fontSize * Math.min(Math.abs(sx), Math.abs(sy)));
    }
  }

  private endInteraction() {
    const it = this.interaction;
    this.interaction = null;
    if (it) {
      const beforeList = it.type === 'move' ? it.beforeObjects : it.beforeLinked;
      const after = this.snapshotByIds(beforeList.map((o) => o.id));
      const strip = (list: BoardObject[]) => JSON.stringify(list.map((o) => ({ ...o, image: undefined })));
      if (strip(beforeList) !== strip(after)) this.store.commit();
    }
    this.applyCursorStyle();
    this.requestScene();
  }

  private finishMarquee(additive: boolean) {
    const sb = this.selectionBox!;
    const box = normalizeBox(sb.start, sb.current);
    const ids = new Set(additive ? this.selectedIds : []);
    if (box.width > 3 || box.height > 3) {
      for (const o of this.objects) {
        const b = getObjectBounds(o);
        if (b && boundsIntersect(b, box)) ids.add(o.id);
      }
    }
    this.selectionBox = null;
    this.setSelection([...ids]);
    this.applyCursorStyle();
    this.requestOverlay();
  }

  private eraseAt(p: Pt) {
    // Картинки ластик пропускает; работает по тексту, штрихам и фигурам.
    for (let i = this.objects.length - 1; i >= 0; i -= 1) {
      const o = this.objects[i];
      if (o.type === 'image') continue;
      if (objectHitTest(o, p.x, p.y, this.eraserRadius)) {
        this.objects = this.objects.filter((x) => x.id !== o.id);
        this.erased = true;
        this.selectedIds = this.selectedIds.filter((id) => id !== o.id);
        this.requestScene();
        return;
      }
    }
  }

  /* ───────────────────────── Текст ───────────────────────── */

  private startTextEdit(target: { id: string } | { at: Pt }) {
    this.finishEditor(false);
    const existing = 'id' in target ? this.objects.find((o) => o.id === target.id) : undefined;
    const fontSize = existing ? Math.max(8, existing.fontSize || 22) : Math.max(14, this.brushSize * 4);
    // Верхний левый угол текста в координатах доски.
    const at: Pt = existing ? { x: existing.x, y: existing.y - fontSize } : (target as { at: Pt }).at;
    const color = existing?.color ?? this.color;

    const el = document.createElement('textarea');
    el.className = 'wb-text-editor';
    el.value = existing?.text ?? '';
    el.rows = 1;
    el.spellcheck = false;
    el.style.color = color;
    this.container.append(el);
    this.editor = { el, id: existing?.id ?? null, at, fontSize, done: false };
    this.hiddenId = existing?.id ?? null;
    this.layoutEditor();
    this.requestScene();

    el.addEventListener('input', () => this.layoutEditor());
    el.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); this.finishEditor(true); }
      else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.finishEditor(false); }
    });
    el.addEventListener('blur', () => this.finishEditor(false));
    requestAnimationFrame(() => { el.focus(); el.select(); });
  }

  private layoutEditor() {
    const ed = this.editor;
    if (!ed) return;
    const { el, at, fontSize } = ed;
    const s = {
      x: (at.x - this.camera.x) * this.zoom,
      y: (at.y - this.camera.y) * this.zoom,
    };
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    el.style.fontSize = `${fontSize * this.zoom}px`;
    el.style.lineHeight = '1.25';
    el.style.width = '10px';
    el.style.height = '10px';
    el.style.width = `${Math.max(48, el.scrollWidth + 6)}px`;
    el.style.height = `${Math.max(fontSize * this.zoom * 1.25, el.scrollHeight)}px`;
  }

  private finishEditor(cancel: boolean) {
    const ed = this.editor;
    if (!ed || ed.done) return;
    ed.done = true;
    this.editor = null;
    const text = ed.el.value.replace(/\s+$/g, '');
    ed.el.remove();
    this.hiddenId = null;

    if (!cancel) {
      if (ed.id) {
        const obj = this.objects.find((o) => o.id === ed.id);
        if (obj) {
          if (!text.trim()) {
            this.objects = this.objects.filter((o) => o.id !== obj.id);
            this.store.commit();
          } else if (text !== obj.text) {
            obj.text = text;
            this.store.commit();
          }
        }
      } else if (text.trim()) {
        const parent = this.imageAt(ed.at);
        const obj = {
          id: crypto.randomUUID(), type: 'text', text, color: this.color, fontSize: ed.fontSize, fontWeight: 500,
          x: ed.at.x, y: ed.at.y + ed.fontSize,
          ...(parent ? { parentId: parent.id } : {}),
        } as BoardObject;
        this.objects = [...this.objects, obj];
        this.store.commit();
      }
    }
    this.requestScene();
  }

  private imageAt(p: Pt) {
    for (let i = this.objects.length - 1; i >= 0; i -= 1) {
      const o = this.objects[i];
      if (o.type === 'image' && p.x >= o.x && p.x <= o.x + o.width && p.y >= o.y && p.y <= o.y + o.height) return o;
    }
    return null;
  }
}

/* ───────────────────────── Вспомогательное ───────────────────────── */

function normalizeBox(a: Pt, b: Pt): Bounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function objectSize(o: BoardObject) {
  if (o.type === 'stroke') {
    return o.points.reduce((max, p, i) => (i ? Math.max(max, distance(o.points[0].x, o.points[0].y, p.x, p.y)) : max), 0);
  }
  if (o.type === 'text') return 2;
  return Math.hypot((o.x2 ?? o.x ?? 0) - (o.x1 ?? o.x ?? 0), (o.y2 ?? o.y ?? 0) - (o.y1 ?? o.y ?? 0));
}

function isTypingTarget(t: EventTarget | null) {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

