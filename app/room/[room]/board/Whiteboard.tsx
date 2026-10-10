"use client";

import { useEffect, useRef, useState } from "react";
import { BoardEngine } from "./engine";
import type { BoardSync } from "./sync";
import type { ShapeName, Tool } from "./types";
import { BIcon, type BoardIconName } from "./icons";

const SHAPES: Array<[ShapeName, string]> = [
  ["line", "Линия"], ["arrow", "Стрелка"], ["rect", "Прямоугольник"], ["roundRect", "Скруглённый"],
  ["circle", "Круг"], ["ellipse", "Эллипс"], ["triangle", "Треугольник"], ["diamond", "Ромб"],
  ["pentagon", "Пятиугольник"], ["hexagon", "Шестиугольник"], ["star", "Звезда"]
];

const COLORS = [
  "#1a1a1a", "#7a7f8c", "#e03c31", "#f5821f", "#f2c400", "#2fb344",
  "#12a7c2", "#4262ff", "#8b4dff", "#e5379b", "#8a5a2b", "#ffffff"
];

type Pop = null | "shapes" | "color" | "size";

type Props = {
  sync: BoardSync;
  roomName: string;
  touch: boolean;
  onClose: () => void;
};

/** Онлайн-доска в стиле Miro: левая панель инструментов, плавающие кнопки, точечная сетка. */
export function Whiteboard({ sync, roomName, touch, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BoardEngine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, setTick] = useState(0);
  const [pop, setPop] = useState<Pop>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new BoardEngine(host, sync.store, {
      onUi: () => setTick((t) => t + 1),
      onCursor: (p) => sync.sendCursor(p),
      onDraft: (o) => sync.sendDraft(o),
      onDraftEnd: (id) => sync.endDraft(id)
    });
    engine.remoteCursors = sync.cursors;
    engine.remoteDrafts = sync.drafts;
    sync.cursorListener = () => engine.requestOverlay();
    engineRef.current = engine;
    setTick((t) => t + 1);
    return () => {
      sync.cursorListener = null;
      sync.sendCursor(null);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sync]);

  // Закрываем всплывающие панели кликом снаружи.
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".wb-pop, .wb-rail")) setPop(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pop]);

  const e = engineRef.current;
  const tool: Tool = e?.tool ?? "pen";
  const store = sync.store;

  const pick = (t: Tool) => { e?.setTool(t); setPop(null); };
  const togglePop = (p: Exclude<Pop, null>) => setPop((cur) => (cur === p ? null : p));

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file || !e) return;
    try { await e.insertImageFile(file); setError(""); } catch { setError("Не удалось вставить изображение"); window.setTimeout(() => setError(""), 3500); }
  }

  const toolBtn = (t: Tool, icon: BoardIconName, title: string) => (
    <button className={`wb-btn ${tool === t ? "on" : ""}`} onClick={() => pick(t)} title={title} aria-label={title} aria-pressed={tool === t}>
      <BIcon name={icon} />
    </button>
  );

  return (
    <div className="wb">
      <div className="wb-host" ref={hostRef} />

      <div className="wb-panel wb-title" title={`Доска встречи ${roomName}`}>
        <BIcon name="board" size={18} />
        <span>Доска</span>
        <small>{roomName}</small>
      </div>

      <div className="wb-panel wb-topright">
        <button className="wb-btn wb-btn-text" onClick={onClose} title="Скрыть доску у себя (у остальных она останется)">
          <BIcon name="close" size={18} /> <span>Скрыть</span>
        </button>
      </div>

      <div className="wb-panel wb-rail" role="toolbar" aria-label="Инструменты доски">
        {toolBtn("select", "select", "Выбор (V)")}
        {toolBtn("hand", "hand", "Перемещение (H, Пробел)")}
        <div className="wb-sep" />
        {toolBtn("pen", "pen", "Кисть (P)")}
        {toolBtn("eraser", "eraser", "Ластик (E)")}
        {toolBtn("text", "text", "Текст (T)")}
        <button className={`wb-btn ${tool === "shape" ? "on" : ""}`} onClick={() => togglePop("shapes")} title="Фигуры" aria-label="Фигуры" aria-expanded={pop === "shapes"}>
          <BIcon name={tool === "shape" && e ? e.shape : "shapes"} />
        </button>
        <button className="wb-btn" onClick={() => fileRef.current?.click()} title="Изображение (или Ctrl+V)" aria-label="Изображение">
          <BIcon name="image" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(ev) => { onFile(ev.target.files); ev.target.value = ""; }} />
        <div className="wb-sep" />
        <button className={`wb-btn ${pop === "color" ? "on" : ""}`} onClick={() => togglePop("color")} title="Цвет" aria-label="Цвет">
          <span className="wb-swatch" style={{ background: e?.color ?? "#1a1a1a" }} />
        </button>
        <button className={`wb-btn ${pop === "size" ? "on" : ""}`} onClick={() => togglePop("size")} title="Толщина" aria-label="Толщина">
          <span className="wb-size-dot" style={{ width: 4 + (e?.brushSize ?? 5) * 0.28, height: 4 + (e?.brushSize ?? 5) * 0.28 }} />
        </button>
        <div className="wb-sep" />
        <button className="wb-btn wb-danger" onClick={() => { if (store.objects.length && window.confirm("Очистить доску для всех участников?")) e?.clear(); }} title="Очистить доску" aria-label="Очистить доску">
          <BIcon name="trash" />
        </button>
      </div>

      {pop && (
        <div className="wb-panel wb-pop" role="dialog">
          {pop === "shapes" && (
            <div className="wb-shapes">
              {SHAPES.map(([name, title]) => (
                <button key={name} className={`wb-btn ${tool === "shape" && e?.shape === name ? "on" : ""}`} onClick={() => { e?.setShape(name); setPop(null); }} title={title} aria-label={title}>
                  <BIcon name={name} />
                </button>
              ))}
            </div>
          )}
          {pop === "color" && (
            <div className="wb-colors">
              {COLORS.map((c) => (
                <button key={c} className={`wb-color ${e?.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => e?.setColor(c)} title={c} aria-label={`Цвет ${c}`} />
              ))}
              <label className="wb-color wb-color-custom" title="Свой цвет">
                <input type="color" value={e?.color ?? "#1a1a1a"} onChange={(ev) => e?.setColor(ev.target.value)} />
                <span>+</span>
              </label>
            </div>
          )}
          {pop === "size" && (
            <div className="wb-size">
              <div className="wb-size-preview"><i style={{ width: Math.max(2, e?.brushSize ?? 5), height: Math.max(2, e?.brushSize ?? 5), background: e?.color ?? "#1a1a1a" }} /></div>
              <input type="range" min={1} max={40} value={e?.brushSize ?? 5} onChange={(ev) => e?.setBrushSize(Number(ev.target.value))} aria-label="Толщина линии" />
              <b>{e?.brushSize ?? 5}</b>
            </div>
          )}
        </div>
      )}

      <div className="wb-panel wb-hist">
        <button className="wb-btn" onClick={() => e?.undo()} disabled={!store.canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить"><BIcon name="undo" size={20} /></button>
        <button className="wb-btn" onClick={() => e?.redo()} disabled={!store.canRedo} title="Повторить (Ctrl+Y)" aria-label="Повторить"><BIcon name="redo" size={20} /></button>
      </div>

      <div className="wb-panel wb-zoom">
        <button className="wb-btn" onClick={() => e?.zoomBy(1 / 1.2)} title="Отдалить" aria-label="Отдалить"><BIcon name="minus" size={18} /></button>
        <button className="wb-btn wb-zoom-val" onClick={() => e?.resetZoom()} title="Сбросить масштаб (100%)">{e?.zoomPercent ?? 100}%</button>
        <button className="wb-btn" onClick={() => e?.zoomBy(1.2)} title="Приблизить" aria-label="Приблизить"><BIcon name="plus" size={18} /></button>
        <button className="wb-btn" onClick={() => e?.fit()} title="Показать всё" aria-label="Показать всё"><BIcon name="fit" size={18} /></button>
      </div>

      {!touch && <div className="wb-hint">Колесо — масштаб · Пробел или H — перемещение · Shift — прямая линия</div>}
      {error && <div className="wb-toast">{error}</div>}
    </div>
  );
}
