import { pointToSegmentDistance, distance, polygonPoints } from './geometry';
import type { Bounds, BoardObject, Pt } from './types';

export type HandleName = 'nw' | 'ne' | 'se' | 'sw';
export const HANDLE_NAMES: HandleName[] = ['nw', 'ne', 'se', 'sw'];
export const HANDLE_SIZE = 9;

function textBounds(object: BoardObject) {
  const fontSize = Math.max(8, object.fontSize || 22);
  const lines = String(object.text ?? '').split('\n');
  const maxChars = Math.max(1, ...lines.map((line) => line.length));
  // Достаточно точная bounding box без измерения DOM/Canvas текста.
  const width = Math.max(16, maxChars * fontSize * 0.62);
  const height = Math.max(fontSize * 1.2, lines.length * fontSize * 1.25);
  return {
    x: object.x,
    y: object.y - fontSize,
    width,
    height,
  };
}

export function getObjectBounds(object: BoardObject) {
  if (!object) return null;

  if (object.type === 'image') {
    return { x: object.x, y: object.y, width: Math.max(1, object.width), height: Math.max(1, object.height) };
  }

  if (object.type === 'text') return textBounds(object);

  if (object.type === 'stroke') {
    if (!object.points?.length) return null;
    const xs = object.points.map((p) => p.x);
    const ys = object.points.map((p) => p.y);
    const pad = Math.max(2, (object.size || 1) / 2);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  if (object.type === 'circle') {
    const radius = Math.hypot(object.x2 - object.x1, object.y2 - object.y1);
    const pad = Math.max(1, (object.size || 1) / 2);
    return { x: object.x1 - radius - pad, y: object.y1 - radius - pad, width: radius * 2 + pad * 2, height: radius * 2 + pad * 2 };
  }

  if (object.type === 'ellipse') {
    const rx = Math.abs(object.x2 - object.x1);
    const ry = Math.abs(object.y2 - object.y1);
    const pad = Math.max(1, (object.size || 1) / 2);
    return { x: object.x1 - rx - pad, y: object.y1 - ry - pad, width: rx * 2 + pad * 2, height: ry * 2 + pad * 2 };
  }

  if (['triangle', 'diamond', 'pentagon', 'hexagon', 'star'].includes(object.type)) {
    const points = polygonPoints(object);
    if (!points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const pad = Math.max(2, (object.size || 1) / 2);
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      width: Math.max(1, Math.max(...xs) - Math.min(...xs) + pad * 2),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys) + pad * 2),
    };
  }

  if (['line', 'arrow', 'rect', 'roundRect'].includes(object.type)) {
    const pad = Math.max(2, (object.size || 1) / 2);
    const minX = Math.min(object.x1, object.x2) - pad;
    const minY = Math.min(object.y1, object.y2) - pad;
    const maxX = Math.max(object.x1, object.x2) + pad;
    const maxY = Math.max(object.y1, object.y2) + pad;
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  return null;
}

export function selectionHitTest(object: BoardObject, px: number, py: number, extra = 8) {
  if (!object) return false;

  if (object.type === 'text' || object.type === 'image') {
    const bounds = getObjectBounds(object);
    return Boolean(bounds && px >= bounds.x - extra && px <= bounds.x + bounds.width + extra
      && py >= bounds.y - extra && py <= bounds.y + bounds.height + extra);
  }

  if (object.type === 'stroke') {
    const tolerance = extra + (object.size || 1) / 2;
    const points = object.points || [];
    if (points.length === 1) return distance(px, py, points[0].x, points[0].y) <= tolerance;
    for (let i = 1; i < points.length; i += 1) {
      if (pointToSegmentDistance(px, py, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= tolerance) return true;
    }
    return false;
  }

  const bounds = getObjectBounds(object);
  return Boolean(bounds && px >= bounds.x - extra && px <= bounds.x + bounds.width + extra
    && py >= bounds.y - extra && py <= bounds.y + bounds.height + extra);
}

export function getTopmostObjectAt(objects: BoardObject[], px: number, py: number) {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    if (selectionHitTest(objects[i], px, py)) return objects[i];
  }
  return null;
}

export function getHandlePositions(bounds: Bounds) {
  return {
    nw: { x: bounds.x, y: bounds.y },
    ne: { x: bounds.x + bounds.width, y: bounds.y },
    se: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    sw: { x: bounds.x, y: bounds.y + bounds.height },
  };
}

export function getResizeHandle(screenBox: Bounds, screenX: number, screenY: number) {
  const handles = getHandlePositions(screenBox);
  const radius = HANDLE_SIZE / 2 + 3;
  for (const name of HANDLE_NAMES) {
    const handle = handles[name];
    if (Math.hypot(screenX - handle.x, screenY - handle.y) <= radius) return name;
  }
  return null;
}

export function screenBounds(bounds: Bounds, zoom: number, camera: Pt) {
  return {
    x: (bounds.x - camera.x) * zoom,
    y: (bounds.y - camera.y) * zoom,
    width: bounds.width * zoom,
    height: bounds.height * zoom,
  };
}

export function unionBounds(objects: BoardObject[]) {
  const bounds = objects.map(getObjectBounds).filter((b): b is Bounds => Boolean(b));
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map((b) => b.x));
  const minY = Math.min(...bounds.map((b) => b.y));
  const maxX = Math.max(...bounds.map((b) => b.x + b.width));
  const maxY = Math.max(...bounds.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boundsIntersect(a: Bounds, b: Bounds) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function boundsFullyInside(inner: Bounds, outer: Bounds) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function moveObject(object: BoardObject, dx: number, dy: number) {
  if (object.type === 'image' || object.type === 'text') {
    object.x += dx;
    object.y += dy;
    return;
  }

  if (object.type === 'stroke') {
    object.points = object.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    return;
  }

  if ('x1' in object) {
    object.x1 += dx;
    object.y1 += dy;
    object.x2 += dx;
    object.y2 += dy;
  }
}

function transformPoint(point: Pt, oldBounds: Bounds, newBounds: Bounds) {
  const sx = oldBounds.width ? newBounds.width / oldBounds.width : 1;
  const sy = oldBounds.height ? newBounds.height / oldBounds.height : 1;
  return {
    x: newBounds.x + (point.x - oldBounds.x) * sx,
    y: newBounds.y + (point.y - oldBounds.y) * sy,
  };
}

export function resizeImageFromHandle(object: BoardObject, oldBounds: Bounds, handle: string, worldPoint: Pt) {
  const ratio = object.width / Math.max(1, object.height);
  const minWidth = 40;
  let left = oldBounds.x;
  let top = oldBounds.y;
  let right = oldBounds.x + oldBounds.width;
  let bottom = oldBounds.y + oldBounds.height;

  if (handle === 'nw') {
    const anchorX = right; const anchorY = bottom;
    const width = Math.max(minWidth, anchorX - worldPoint.x);
    const height = width / ratio;
    left = anchorX - width; top = anchorY - height;
  }
  if (handle === 'ne') {
    const anchorX = left; const anchorY = bottom;
    const width = Math.max(minWidth, worldPoint.x - anchorX);
    const height = width / ratio;
    right = anchorX + width; top = anchorY - height;
  }
  if (handle === 'se') {
    const anchorX = left; const anchorY = top;
    const width = Math.max(minWidth, worldPoint.x - anchorX);
    const height = width / ratio;
    right = anchorX + width; bottom = anchorY + height;
  }
  if (handle === 'sw') {
    const anchorX = right; const anchorY = top;
    const width = Math.max(minWidth, anchorX - worldPoint.x);
    const height = width / ratio;
    left = anchorX - width; bottom = anchorY + height;
  }

  const width = Math.max(minWidth, right - left);
  const height = width / ratio;
  if (handle === 'nw' || handle === 'sw') object.x = right - width; else object.x = left;
  if (handle === 'nw' || handle === 'ne') object.y = bottom - height; else object.y = top;
  object.width = width;
  object.height = height;
}

export function resizeObject(object: BoardObject, oldBounds: Bounds, newBounds: Bounds) {
  if (!object || !oldBounds || !newBounds) return;
  const safe = { x: newBounds.x, y: newBounds.y, width: Math.max(8, newBounds.width), height: Math.max(8, newBounds.height) };

  if (object.type === 'image') {
    resizeImageFromHandle(object, oldBounds, 'se', { x: safe.x + safe.width, y: safe.y + safe.height });
    return;
  }

  if (object.type === 'text') {
    const sx = safe.width / Math.max(1, oldBounds.width);
    const sy = safe.height / Math.max(1, oldBounds.height);
    const scale = Math.max(0.25, Math.min(5, Math.min(Math.abs(sx), Math.abs(sy))));
    const point = transformPoint({ x: object.x, y: object.y }, oldBounds, safe);
    object.x = point.x;
    object.y = point.y;
    object.fontSize = Math.max(8, (object.fontSize || 22) * scale);
    return;
  }

  if (object.type === 'stroke') {
    object.points = object.points.map((point) => transformPoint(point, oldBounds, safe));
    const sx = safe.width / Math.max(1, oldBounds.width);
    const sy = safe.height / Math.max(1, oldBounds.height);
    object.size = Math.max(1, object.size * Math.min(Math.abs(sx), Math.abs(sy)));
    return;
  }

  if (['line', 'arrow', 'rect', 'roundRect'].includes(object.type)) {
    const a = transformPoint({ x: object.x1, y: object.y1 }, oldBounds, safe);
    const b = transformPoint({ x: object.x2, y: object.y2 }, oldBounds, safe);
    Object.assign(object, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    return;
  }

  if (object.type === 'circle' || object.type === 'ellipse') {
    const cx = safe.x + safe.width / 2;
    const cy = safe.y + safe.height / 2;
    object.x1 = cx;
    object.y1 = cy;
    object.x2 = cx + safe.width / 2;
    object.y2 = object.type === 'circle' ? cy : cy + safe.height / 2;
    return;
  }

  if (['triangle', 'diamond', 'pentagon', 'hexagon', 'star'].includes(object.type)) {
    const cx = safe.x + safe.width / 2;
    const cy = safe.y + safe.height / 2;
    object.x1 = cx;
    object.y1 = cy;
    object.x2 = cx + safe.width / 2;
    object.y2 = cy + safe.height / 2;
  }
}

export function resizeBoundsFromHandle(oldBounds: Bounds, handle: string, worldPoint: Pt, minSize = 12) {
  let left = oldBounds.x;
  let top = oldBounds.y;
  let right = oldBounds.x + oldBounds.width;
  let bottom = oldBounds.y + oldBounds.height;

  if (handle === 'nw') { left = Math.min(worldPoint.x, right - minSize); top = Math.min(worldPoint.y, bottom - minSize); }
  if (handle === 'ne') { right = Math.max(worldPoint.x, left + minSize); top = Math.min(worldPoint.y, bottom - minSize); }
  if (handle === 'se') { right = Math.max(worldPoint.x, left + minSize); bottom = Math.max(worldPoint.y, top + minSize); }
  if (handle === 'sw') { left = Math.min(worldPoint.x, right - minSize); bottom = Math.max(worldPoint.y, top + minSize); }

  return { x: left, y: top, width: right - left, height: bottom - top };
}
