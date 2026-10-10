import type { ReactNode } from 'react';
import type { ShapeName } from './types';

export type BoardIconName =
  | 'select' | 'hand' | 'pen' | 'eraser' | 'text' | 'shapes' | 'image' | 'undo' | 'redo'
  | 'trash' | 'plus' | 'minus' | 'fit' | 'close' | 'board' | ShapeName;

const P: Record<BoardIconName, ReactNode> = {
  select: <path d="M6 3.5 18.5 10l-5.7 1.8L10.7 18z" />,
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.8a6 6 0 0 1-4.9-2.5L4.3 14a1.4 1.4 0 0 1 2.2-1.6L8 14" />,
  pen: <><path d="m4 20 1-4.2L16.6 4.2a2.1 2.1 0 0 1 3 3L8 19z" /><path d="m14.5 6.3 3.2 3.2" /></>,
  eraser: <><path d="m8 20-4.2-4.2a1.8 1.8 0 0 1 0-2.5L13.2 4a1.8 1.8 0 0 1 2.5 0l4.3 4.3a1.8 1.8 0 0 1 0 2.5L12 19" /><path d="M8 20h12M9.5 7.7l6.8 6.8" /></>,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  shapes: <><rect x="3.5" y="10" width="9" height="9" rx="1.5" /><circle cx="15.5" cy="8.5" r="5" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  trash: <path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l.9 12.5h9.2L17.5 7M10 11v5M14 11v5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  board: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="m7 13 3-3 2.5 2.5L17 8M9 21l1.5-4M15 21l-1.5-4" /></>,
  line: <path d="M5 19 19 5" />,
  arrow: <path d="M5 19 19 5M10 5h9v9" />,
  rect: <rect x="4" y="6" width="16" height="12" />,
  roundRect: <rect x="4" y="6" width="16" height="12" rx="4" />,
  circle: <circle cx="12" cy="12" r="8" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6" />,
  triangle: <path d="M12 4 21 20H3z" />,
  diamond: <path d="m12 3 9 9-9 9-9-9z" />,
  pentagon: <path d="m12 3 9 7-3.5 10h-11L3 10z" />,
  hexagon: <path d="M7 4h10l5 8-5 8H7l-5-8z" />,
  star: <path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3-5.6-3-5.6 3 1.2-6.3L3 9.6l6.3-.8z" />,
};

/** Сдвиги, выравнивающие рисунок каждой иконки по центру рамки 24×24 (считаны по реальным границам). */
const NUDGE: Partial<Record<BoardIconName, [number, number]>> = { select: [-0.25, 1.25], hand: [1.4, 0], pen: [0, 0.21], eraser: [0, 0.25], shapes: [0, 0.75], board: [0, -0.5], pentagon: [0, 0.5], star: [0, 0.35] };

export function BIcon({ name, size = 22 }: { name: BoardIconName; size?: number }) {
  const nudge = NUDGE[name] ?? [0, 0];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {nudge[0] || nudge[1] ? <g transform={`translate(${nudge[0]} ${nudge[1]})`}>{P[name]}</g> : P[name]}
    </svg>
  );
}
