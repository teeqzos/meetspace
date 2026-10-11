import type { Bounds, BoardObject, Pt } from './types';

export function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) return distance(px, py, x1, y1);

  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));

  return distance(px, py, x1 + t * dx, y1 + t * dy);
}

export function snappedPoint(start: Pt, current: Pt, step = Math.PI / 4) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const distanceFromStart = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / step) * step;

  return {
    x: start.x + Math.cos(snappedAngle) * distanceFromStart,
    y: start.y + Math.sin(snappedAngle) * distanceFromStart,
  };
}

export function normalizedRect(object: BoardObject) {
  return {
    x: Math.min(object.x1, object.x2),
    y: Math.min(object.y1, object.y2),
    width: Math.abs(object.x2 - object.x1),
    height: Math.abs(object.y2 - object.y1),
  };
}

export function objectHitTest(object: BoardObject, px: number, py: number, radius = 0) {
  const tolerance = radius + (object.size || 0) / 2;

  if (object.type === 'stroke') {
    for (let i = 0; i < object.points.length; i += 1) {
      const p = object.points[i];
      if (distance(px, py, p.x, p.y) <= tolerance) return true;
      if (i > 0) {
        const prev = object.points[i - 1];
        if (pointToSegmentDistance(px, py, prev.x, prev.y, p.x, p.y) <= tolerance) return true;
      }
    }
    return false;
  }

  if (object.type === 'line' || object.type === 'arrow') {
    return pointToSegmentDistance(px, py, object.x1, object.y1, object.x2, object.y2) <= tolerance;
  }

  if (object.type === 'rect' || object.type === 'roundRect') {
    const r = normalizedRect(object);
    const edges = [
      [r.x, r.y, r.x + r.width, r.y],
      [r.x + r.width, r.y, r.x + r.width, r.y + r.height],
      [r.x + r.width, r.y + r.height, r.x, r.y + r.height],
      [r.x, r.y + r.height, r.x, r.y],
    ];
    return edges.some(([ax, ay, bx, by]) => pointToSegmentDistance(px, py, ax, ay, bx, by) <= tolerance);
  }

  if (object.type === 'circle' || object.type === 'ellipse') {
    const cx = object.x1;
    const cy = object.y1;
    const dx = object.x2 - object.x1;
    const dy = object.y2 - object.y1;

    if (object.type === 'circle') {
      const r = Math.hypot(dx, dy);
      return Math.abs(distance(px, py, cx, cy) - r) <= tolerance;
    }

    const rx = Math.abs(dx);
    const ry = Math.abs(dy);
    if (rx === 0 || ry === 0) return false;
    const normalized = Math.hypot(px - cx, py - cy);
    const ellipseDistance = Math.abs(((px - cx) ** 2) / (rx ** 2) + ((py - cy) ** 2) / (ry ** 2) - 1);
    return ellipseDistance * Math.max(rx, ry) <= tolerance + normalized * 0.03;
  }

  if (['triangle', 'diamond', 'pentagon', 'hexagon', 'star'].includes(object.type)) {
    const points = polygonPoints(object);
    return polygonEdgeHit(points, px, py, tolerance);
  }

  return false;
}

export function polygonPoints(object: BoardObject) {
  const cx = object.x1;
  const cy = object.y1;
  const dx = object.x2 - object.x1;
  const dy = object.y2 - object.y1;
  const rx = Math.abs(dx);
  const ry = Math.abs(dy);

  if (object.type === 'triangle') {
    return regularPolygon(cx, cy, Math.max(rx, ry), 3, -Math.PI / 2);
  }
  if (object.type === 'diamond') {
    return [
      { x: cx, y: cy - ry },
      { x: cx + rx, y: cy },
      { x: cx, y: cy + ry },
      { x: cx - rx, y: cy },
    ];
  }
  if (object.type === 'pentagon') return regularPolygon(cx, cy, Math.max(rx, ry), 5, -Math.PI / 2);
  if (object.type === 'hexagon') return regularPolygon(cx, cy, Math.max(rx, ry), 6, Math.PI / 6);
  if (object.type === 'star') return starPolygon(cx, cy, Math.max(rx, ry), Math.max(rx, ry) * 0.45, 5);
  return [];
}

export function regularPolygon(cx: number, cy: number, radius: number, sides: number, startAngle = 0) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = startAngle + (i * Math.PI * 2) / sides;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

export function starPolygon(cx: number, cy: number, outerRadius: number, innerRadius: number, pointsCount = 5) {
  const points = [];
  for (let i = 0; i < pointsCount * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / pointsCount;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

export function polygonEdgeHit(points: Pt[], px: number, py: number, tolerance: number) {
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y) <= tolerance) return true;
  }
  return false;
}
