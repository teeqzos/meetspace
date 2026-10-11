export interface Pt { x: number; y: number }
export interface Bounds { x: number; y: number; width: number; height: number }

/**
 * Объект доски. Поля зависят от type (stroke, line, rect, text, image …),
 * поэтому типы «широкие»: так перенесённая математика остаётся близкой к оригиналу.
 */
export interface BoardObject {
  id: string;
  type: string;
  color: string;
  size: number;
  fill?: string;
  points: Pt[];
  x1: number; y1: number; x2: number; y2: number;
  x: number; y: number; width: number; height: number;
  text?: string;
  fontSize: number;
  fontWeight?: number;
  fontFamily?: string;
  parentId?: string;
  src?: string;
  image?: HTMLImageElement | null;
}

export type Tool = 'select' | 'hand' | 'pen' | 'eraser' | 'text' | 'shape';
export type ShapeName =
  | 'line' | 'arrow' | 'rect' | 'roundRect' | 'circle' | 'ellipse'
  | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star';

export type BoardOp =
  | { k: 'add'; o: BoardObject }
  | { k: 'upd'; o: BoardObject }
  | { k: 'rm'; id: string };
