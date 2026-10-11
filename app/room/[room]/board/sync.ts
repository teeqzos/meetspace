import type { Room } from 'livekit-client';
import { BoardStore } from './store';
import type { BoardObject, BoardOp, Pt } from './types';

const DRAFT_TOPIC = 'board-draft';

const TOPIC = 'board';
const CURSOR_TOPIC = 'board-cursor';

type Msg =
  | { t: 'ops'; ops: BoardOp[] }
  | { t: 'hello' }
  | { t: 'snap'; objects: BoardObject[]; open: boolean }
  | { t: 'open'; open: boolean; by: string };

/** Штрих или фигура, которую другой участник рисует прямо сейчас. */
export type RemoteDraft = { obj: BoardObject; raw: Array<{ x: number; y: number } | undefined>; at: number };

type DraftMsg =
  | { id: string; end: true }
  | { id: string; ty: 'stroke'; c: string; s: number; i: number; n: number; p: number[] }
  | { id: string; ty: string; c: string; s: number; a: [number, number, number, number] };

export type RemoteCursor = { x: number; y: number; name: string; hue: number; at: number };

function hueFor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

/**
 * Связывает доску с комнатой LiveKit:
 *  - изменения объектов идут текстовыми потоками (надёжно, любой размер — в том числе картинки);
 *  - курсоры — ненадёжным каналом (теряются без последствий);
 *  - вошедший позже получает текущую доску от одного из участников.
 */
export class BoardSync {
  readonly store = new BoardStore();
  open = false;
  cursors = new Map<string, RemoteCursor>();
  /** Чужие незавершённые штрихи (видны, пока человек ещё рисует). */
  drafts = new Map<string, RemoteDraft>();
  private draftState = { id: '', sent: 0, at: 0 };
  /** Доска подписывается сюда, чтобы перерисовать чужие курсоры. */
  cursorListener: (() => void) | null = null;

  private queue: Promise<unknown> = Promise.resolve();
  private lastCursorSent = 0;
  private stopped = false;

  constructor(
    private room: Room,
    private hooks: {
      onOpen: (open: boolean, by: string, mine: boolean) => void;
      onCursors: () => void;
    }
  ) {
    this.store.sendOps = (ops) => this.send({ t: 'ops', ops });
  }

  start() {
    this.room.registerTextStreamHandler(TOPIC, async (reader, info) => {
      try {
        const text = await reader.readAll();
        this.handle(JSON.parse(text) as Msg, info.identity);
      } catch {}
    });
    // Просим у остальных текущее состояние доски.
    this.send({ t: 'hello' });
  }

  stop() {
    this.stopped = true;
    try { this.room.unregisterTextStreamHandler(TOPIC); } catch {}
  }

  private send(msg: Msg, to?: string) {
    if (this.stopped) return;
    const lp = this.room.localParticipant;
    const text = JSON.stringify(msg);
    // Очередь сохраняет порядок: «создать» всегда раньше «изменить».
    this.queue = this.queue
      .then(() => lp.sendText(text, { topic: TOPIC, ...(to ? { destinationIdentities: [to] } : {}) }))
      .catch(() => {});
  }

  /**
   * Открыть — открывается у всех. Закрыть (скрыть) — только у себя:
   * остальные продолжают работать на доске.
   */
  setOpen(open: boolean) {
    this.open = open;
    const by = this.room.localParticipant.name || this.room.localParticipant.identity;
    if (open) this.send({ t: 'open', open: true, by });
    this.hooks.onOpen(open, by, true);
  }

  private handle(msg: Msg, from: string) {
    if (msg.t === 'ops') {
      for (const op of msg.ops) if (op.k !== 'rm') this.drafts.delete(op.o.id);
      this.store.applyRemote(msg.ops);
      this.cursorListener?.();
    } else if (msg.t === 'open') {
      if (!msg.open) return; // старые клиенты: закрытие больше не общее
      this.open = true;
      this.hooks.onOpen(true, msg.by, false);
    } else if (msg.t === 'hello') {
      // Отвечает один участник — с наименьшим identity (кроме спросившего), чтобы не слать копии.
      const ids = [this.room.localParticipant.identity, ...Array.from(this.room.remoteParticipants.keys())]
        .filter((id) => id !== from)
        .sort();
      if (ids[0] !== this.room.localParticipant.identity) return;
      if (!this.store.objects.length && !this.open) return;
      this.send({ t: 'snap', objects: this.store.snapshot(), open: this.open }, from);
    } else if (msg.t === 'snap') {
      if (this.store.objects.length === 0) this.store.loadSnapshot(msg.objects);
      if (msg.open && !this.open) {
        this.open = true;
        this.hooks.onOpen(true, '', false);
      }
    }
  }

  /* ───── Курсоры ───── */

  sendCursor(p: Pt | null) {
    const now = performance.now();
    if (p && now - this.lastCursorSent < 32) return;
    this.lastCursorSent = now;
    const payload = new TextEncoder().encode(JSON.stringify(p ? { x: Math.round(p.x), y: Math.round(p.y) } : { gone: true }));
    this.room.localParticipant.publishData(payload, { reliable: false, topic: CURSOR_TOPIC }).catch(() => {});
  }

  handleCursor(payload: Uint8Array, identity: string, name: string) {
    try {
      const data = JSON.parse(new TextDecoder().decode(payload));
      if (data.gone) this.cursors.delete(identity);
      else this.cursors.set(identity, { x: data.x, y: data.y, name, hue: hueFor(identity), at: performance.now() });
      this.hooks.onCursors();
      this.cursorListener?.();
    } catch {}
  }

  /* ───── Живое рисование ───── */

  /** Передать текущее состояние рисуемого штриха/фигуры (не чаще ~30 раз в секунду). */
  sendDraft(o: BoardObject) {
    const now = performance.now();
    if (this.draftState.id !== o.id) this.draftState = { id: o.id, sent: 0, at: 0 };
    if (now - this.draftState.at < 32) return;
    this.draftState.at = now;

    let msg: DraftMsg;
    if (o.type === 'stroke') {
      const n = o.points.length;
      // Берём с запасом назад: если пакет потеряется, следующий его перекроет.
      const start = Math.max(0, Math.min(this.draftState.sent, n) - 12, n - 80);
      const p: number[] = [];
      for (let i = start; i < n; i += 1) p.push(Math.round(o.points[i].x * 10) / 10, Math.round(o.points[i].y * 10) / 10);
      this.draftState.sent = n;
      msg = { id: o.id, ty: 'stroke', c: o.color, s: o.size, i: start, n, p };
    } else {
      msg = { id: o.id, ty: o.type, c: o.color, s: o.size, a: [o.x1, o.y1, o.x2, o.y2].map((v) => Math.round(v * 10) / 10) as [number, number, number, number] };
    }
    this.publishDraft(msg);
  }

  /** Рисование отменено (слишком короткий штрих и т.п.). */
  endDraft(id: string) {
    this.draftState = { id: '', sent: 0, at: 0 };
    this.publishDraft({ id, end: true });
  }

  private publishDraft(msg: DraftMsg) {
    if (this.stopped) return;
    const payload = new TextEncoder().encode(JSON.stringify(msg));
    this.room.localParticipant.publishData(payload, { reliable: false, topic: DRAFT_TOPIC }).catch(() => {});
  }

  handleDraft(payload: Uint8Array) {
    try {
      const m = JSON.parse(new TextDecoder().decode(payload)) as DraftMsg;
      if ('end' in m) {
        this.drafts.delete(m.id);
      } else if ('p' in m) {
        const d: RemoteDraft = this.drafts.get(m.id) ?? {
          obj: { id: m.id, type: 'stroke', color: m.c, size: m.s, points: [] } as unknown as BoardObject, raw: [], at: 0,
        };
        for (let k = 0; k < m.p.length / 2; k += 1) d.raw[m.i + k] = { x: m.p[2 * k], y: m.p[2 * k + 1] };
        d.raw.length = m.n;
        // Если какой-то пакет потерялся, дырку просто пропускаем.
        d.obj.points = d.raw.filter((pt): pt is { x: number; y: number } => !!pt);
        d.at = performance.now();
        this.drafts.set(m.id, d);
      } else {
        const [x1, y1, x2, y2] = m.a;
        this.drafts.set(m.id, { obj: { id: m.id, type: m.ty, color: m.c, size: m.s, x1, y1, x2, y2 } as unknown as BoardObject, raw: [], at: performance.now() });
      }
      this.cursorListener?.();
    } catch {}
  }

  dropCursor(identity: string) {
    if (this.cursors.delete(identity)) { this.hooks.onCursors(); this.cursorListener?.(); }
  }
}

export const BOARD_CURSOR_TOPIC = CURSOR_TOPIC;
export const BOARD_DRAFT_TOPIC = DRAFT_TOPIC;
