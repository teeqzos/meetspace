import type { BoardObject, BoardOp } from './types';
import { loadImageFromSource } from './images';

/** Копия объекта без тяжёлых полей (картинка загружается отдельно). */
export function cloneObject(o: BoardObject): BoardObject {
  const c = { ...o } as BoardObject;
  if (o.points) c.points = o.points.map((p) => ({ ...p }));
  return c;
}
export const cloneObjects = (list: BoardObject[]) => list.map(cloneObject);

/** Объект для передачи по сети: без HTMLImageElement. */
export function serialize(o: BoardObject): BoardObject {
  const c = { ...o } as BoardObject;
  delete c.image;
  return c;
}

/** «Подпись» объекта для сравнения. Для картинок src не перебираем — он не меняется. */
function signature(o: BoardObject): string {
  const { image: _image, src, ...rest } = o as BoardObject & { image?: unknown };
  return JSON.stringify(rest) + (src ? `|${src.length}` : '');
}

/** Какие операции превращают prev в next. */
export function diffOps(prev: Map<string, string>, next: BoardObject[]): { ops: BoardOp[]; sigs: Map<string, string> } {
  const sigs = new Map<string, string>();
  const ops: BoardOp[] = [];
  for (const o of next) {
    const sig = signature(o);
    sigs.set(o.id, sig);
    const old = prev.get(o.id);
    if (old === undefined) ops.push({ k: 'add', o: serialize(o) });
    else if (old !== sig) ops.push({ k: 'upd', o: serialize(o) });
  }
  for (const id of prev.keys()) if (!sigs.has(id)) ops.push({ k: 'rm', id });
  return { ops, sigs };
}

export function applyOps(list: BoardObject[], ops: BoardOp[], created: (o: BoardObject) => BoardObject = (o) => o): BoardObject[] {
  let out = list;
  for (const op of ops) {
    if (op.k === 'rm') {
      out = out.filter((o) => o.id !== op.id);
    } else {
      const idx = out.findIndex((o) => o.id === op.o.id);
      const obj = created(op.o);
      if (idx >= 0) {
        out = out.slice();
        out[idx] = obj;
      } else {
        out = [...out, obj];
      }
    }
  }
  return out;
}

const MAX_HISTORY = 100;

/**
 * Общее состояние доски: объекты + локальная история (undo/redo).
 * Живёт всё время встречи — поэтому доска сохраняется, даже если её закрыть и открыть снова.
 */
export class BoardStore {
  objects: BoardObject[] = [];
  history: BoardObject[][] = [];
  historyIndex = -1;
  /** Подписи последнего синхронизированного состояния: по ним считаем, что отправлять. */
  private synced = new Map<string, string>();
  private listeners = new Set<() => void>();
  /** Выставляется синхронизацией: отправить операции остальным. */
  sendOps: (ops: BoardOp[]) => void = () => {};

  constructor() {
    this.saveHistory();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit() { this.listeners.forEach((fn) => fn()); }

  get canUndo() { return this.historyIndex > 0; }
  get canRedo() { return this.historyIndex < this.history.length - 1; }

  private saveHistory() {
    if (this.historyIndex < this.history.length - 1) this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(cloneObjects(this.objects));
    this.historyIndex += 1;
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
      this.historyIndex -= 1;
    }
  }

  private flush() {
    const { ops, sigs } = diffOps(this.synced, this.objects);
    this.synced = sigs;
    if (ops.length) this.sendOps(ops);
  }

  /** Локальное действие завершено: запоминаем в истории и рассылаем изменения. */
  commit({ history = true }: { history?: boolean } = {}) {
    if (history) this.saveHistory();
    this.flush();
    this.emit();
  }

  undo() { return this.travel(this.historyIndex - 1); }
  redo() { return this.travel(this.historyIndex + 1); }

  private travel(index: number) {
    if (index < 0 || index >= this.history.length) return false;
    this.objects = cloneObjects(this.history[index]);
    this.historyIndex = index;
    this.ensureImages(this.objects);
    this.flush();
    this.emit();
    return true;
  }

  /** Операции от другого участника. История «пересобирается», чтобы Undo не затирал чужие правки. */
  applyRemote(ops: BoardOp[]) {
    this.objects = applyOps(this.objects, ops, (o) => ({ ...o }));
    for (const op of ops) {
      if (op.k === 'add' || op.k === 'upd') this.synced.set(op.o.id, signature(op.o));
      else this.synced.delete(op.id);
    }
    this.history = this.history.map((snap) => {
      let out = snap;
      for (const op of ops) {
        if (op.k === 'rm') out = out.filter((o) => o.id !== op.id);
        else if (op.k === 'add') out = out.some((o) => o.id === op.o.id) ? out.map((o) => (o.id === op.o.id ? op.o : o)) : [...out, op.o];
        else out = out.map((o) => (o.id === op.o.id ? op.o : o));
      }
      return out;
    });
    this.ensureImages(this.objects);
    this.emit();
  }

  /** Полное состояние (для вошедшего позже). */
  loadSnapshot(objects: BoardObject[]) {
    this.objects = objects.map((o) => ({ ...o }));
    this.history = [cloneObjects(this.objects)];
    this.historyIndex = 0;
    this.synced = new Map(this.objects.map((o) => [o.id, signature(o)]));
    this.ensureImages(this.objects);
    this.emit();
  }

  snapshot() {
    return this.objects.map(serialize);
  }

  ensureImages(list: BoardObject[]) {
    for (const o of list) {
      if (o.type === 'image' && o.src && !o.image) {
        loadImageFromSource(o.src).then((img) => { o.image = img; this.emit(); }).catch(() => {});
      }
    }
  }
}
