"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export const GAP = 10;

/** Размер содержимого элемента. Callback-ref, чтобы работать с элементами, которые появляются позже. */
export function useElementSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!el) return;
    const read = () => ({ width: el.clientWidth, height: el.clientHeight });
    setSize(read());
    // flushSync: размеры плиток пересчитываются в том же кадре, что и размер области —
    // иначе при плавной анимации панелей плитки отставали бы на кадр (лишние зазоры/наложения).
    const ro = new ResizeObserver(() => {
      const next = read();
      flushSync(() => setSize((cur) => (cur.width === next.width && cur.height === next.height ? cur : next)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, size] as const;
}

/**
 * Сетка «как в Google Meet»: все плитки ОДИНАКОВОГО размера и целиком заполняют
 * область. 1 участник — на весь экран, 2–3 — в один ряд, дальше — несколько рядов.
 * Размер плитки не зависит от того, включена камера или нет.
 */
export function pickGrid(n: number, W: number, H: number, gap = GAP) {
  if (n <= 0 || W <= 0 || H <= 0) return { w: 0, h: 0, cols: 1, rows: 1 };
  const TARGET = 1.2; // желаемое отношение сторон плитки (ширина / высота)
  type Cand = { score: number; w: number; h: number; cols: number; rows: number };
  let best: Cand | null = null;
  let fallback: Cand | null = null; // если участников слишком много — берём самую крупную плитку

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (W - gap * (cols - 1)) / cols;
    const h = (H - gap * (rows - 1)) / rows;
    if (w <= 0 || h <= 0) continue;
    const empty = cols * rows - n;
    const cand: Cand = { score: Math.abs(Math.log(w / h / TARGET)) + empty * 0.12, w, h, cols, rows };
    if (!fallback || w * h > fallback.w * fallback.h) fallback = cand;
    if (w < 80 || h < 60) continue;
    if (!best || cand.score < best.score) best = cand;
  }
  best = best ?? fallback ?? { score: 0, w: W, h: H, cols: 1, rows: 1 };
  return { w: Math.floor(best.w), h: Math.floor(best.h), cols: best.cols, rows: best.rows };
}

/** Размер плитки при заданной форме сетки (cols × rows) в области W × H. */
export function fitCells(cols: number, rows: number, W: number, H: number, gap = GAP) {
  return {
    w: Math.max(0, Math.floor((W - gap * (cols - 1)) / cols)),
    h: Math.max(0, Math.floor((H - gap * (rows - 1)) / rows)),
  };
}

/**
 * Режим «демонстрация / закреплённый»: слева крупный экран, справа колонка
 * одинаковых плиток (на узком экране — лента снизу).
 */
export function pickSplit(n: number, W: number, H: number, gap = GAP, shape?: { w: number; h: number }) {
  // «Узкий» режим решаем по конечному размеру области, чтобы раскладка не переключалась посреди анимации.
  const sw = shape?.w ?? W;
  const sh = shape?.h ?? H;
  const narrow = sw < 760 || sw < sh;
  if (narrow) {
    const h = Math.max(84, Math.min(120, Math.floor(sh * 0.2)));
    return { narrow, colW: W, w: Math.floor(h * 1.5), h };
  }
  const colW = Math.round(Math.min(460, Math.max(220, W * 0.26)));
  const fill = n > 0 ? (H - gap * (n - 1)) / n : H;
  const h = Math.floor(Math.max(130, Math.min(fill, colW * 0.9)));
  return { narrow, colW, w: colW, h };
}
