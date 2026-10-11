import { normalizedRect, polygonPoints } from './geometry';
import type { BoardObject, Pt } from './types';

export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, zoom: number, camera: Pt) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Точечная сетка, как на Miro: шаг подстраивается под масштаб.
  let step = 24 * zoom;
  while (step < 14) step *= 2;
  while (step > 56) step /= 2;
  const worldStep = step / zoom;
  const startX = Math.floor(camera.x / worldStep) * worldStep;
  const startY = Math.floor(camera.y / worldStep) * worldStep;
  const r = Math.max(0.8, Math.min(1.6, zoom * 1.1));

  ctx.fillStyle = '#c9ced8';
  ctx.beginPath();
  for (let wx = startX; ; wx += worldStep) {
    const sx = (wx - camera.x) * zoom;
    if (sx > width + 2) break;
    for (let wy = startY; ; wy += worldStep) {
      const sy = (wy - camera.y) * zoom;
      if (sy > height + 2) break;
      ctx.rect(Math.round(sx) - r / 2, Math.round(sy) - r / 2, r, r);
    }
  }
  ctx.fill();
  ctx.restore();
}

export function worldToScreen(point: Pt, zoom: number, camera: Pt) {
  return { x: (point.x - camera.x) * zoom, y: (point.y - camera.y) * zoom };
}

export function screenToWorld(x: number, y: number, zoom: number, camera: Pt) {
  return { x: x / zoom + camera.x, y: y / zoom + camera.y };
}


function objectMayBeVisible(object: BoardObject, zoom: number, camera: Pt, width: number, height: number) {
  const padding = 32 / Math.max(zoom, 0.01);
  let x: number; let y: number; let w: number; let h: number;

  if (object.type === 'image') {
    x = object.x; y = object.y; w = object.width; h = object.height;
  } else if (object.type === 'text') {
    const fontSize = Math.max(8, object.fontSize || 22);
    const lines = String(object.text ?? '').split('\n');
    const maxLength = Math.max(1, ...lines.map((line) => line.length));
    x = object.x; y = object.y - fontSize; w = maxLength * fontSize * 0.65; h = lines.length * fontSize * 1.25;
  } else if (object.type === 'line' || object.type === 'arrow' || object.type === 'rect' || object.type === 'roundRect') {
    x = Math.min(object.x1, object.x2); y = Math.min(object.y1, object.y2);
    w = Math.abs(object.x2 - object.x1); h = Math.abs(object.y2 - object.y1);
  } else if (object.type === 'circle' || object.type === 'ellipse') {
    x = object.x1 - Math.abs(object.x2 - object.x1); y = object.y1 - Math.abs(object.y2 - object.y1);
    w = Math.abs(object.x2 - object.x1) * 2; h = Math.abs(object.y2 - object.y1) * 2;
  } else if (['triangle', 'diamond', 'pentagon', 'hexagon', 'star'].includes(object.type)) {
    const rx = Math.abs(object.x2 - object.x1); const ry = Math.abs(object.y2 - object.y1);
    x = object.x1 - rx; y = object.y1 - ry; w = rx * 2; h = ry * 2;
  } else {
    // Long strokes can contain many points; avoid scanning them during every scene render.
    return true;
  }

  const viewLeft = camera.x - padding;
  const viewTop = camera.y - padding;
  const viewRight = camera.x + width / zoom + padding;
  const viewBottom = camera.y + height / zoom + padding;
  return x + w >= viewLeft && x <= viewRight && y + h >= viewTop && y <= viewBottom;
}

export function isObjectVisible(object: BoardObject, zoom: number, camera: Pt, width: number, height: number) {
  return objectMayBeVisible(object, zoom, camera, width, height);
}

export function drawObject(ctx: CanvasRenderingContext2D, object: BoardObject, zoom: number, camera: Pt, options: { preview?: boolean; skipId?: string | null } = {}) {
  const { preview = false, skipId = null } = options;
  if (skipId && object.id === skipId) return;
  ctx.save();
  ctx.globalAlpha = preview ? 0.65 : 1;
  ctx.strokeStyle = object.color || '#111827';
  ctx.fillStyle = object.fill ?? 'transparent';
  ctx.lineWidth = Math.max(0.75, (object.size || 1) * zoom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const sx = (worldX: number) => (worldX - camera.x) * zoom;
  const sy = (worldY: number) => (worldY - camera.y) * zoom;

  if (object.type === 'stroke') {
    if (!object.points?.length) { ctx.restore(); return; }
    ctx.beginPath();
    const first = object.points[0];
    const firstX = (first.x - camera.x) * zoom;
    const firstY = (first.y - camera.y) * zoom;
    ctx.moveTo(firstX, firstY);
    for (let i = 1; i < object.points.length; i += 1) {
      const point = object.points[i];
      ctx.lineTo((point.x - camera.x) * zoom, (point.y - camera.y) * zoom);
    }
    if (object.points.length === 1) {
      ctx.arc(firstX, firstY, Math.max(0.75, (object.size || 1) * zoom / 2), 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  if (object.type === 'line' || object.type === 'arrow') {
    const x1 = sx(object.x1); const y1 = sy(object.y1); const x2 = sx(object.x2); const y2 = sy(object.y2);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (object.type === 'arrow') {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(10, 5 * (object.size || 1) * zoom);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  }

  if (object.type === 'rect' || object.type === 'roundRect') {
    const r = normalizedRect(object);
    const x = sx(r.x); const y = sy(r.y); const w = r.width * zoom; const h = r.height * zoom;
    ctx.beginPath();
    if (object.type === 'roundRect' && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(18 * zoom, Math.min(w, h) / 3));
    else ctx.rect(x, y, w, h);
    if (object.fill && object.fill !== 'transparent') ctx.fill();
    ctx.stroke();
  }

  if (object.type === 'circle') {
    const center = worldToScreen({ x: object.x1, y: object.y1 }, zoom, camera);
    const radius = Math.hypot(object.x2 - object.x1, object.y2 - object.y1) * zoom;
    ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    if (object.fill && object.fill !== 'transparent') ctx.fill();
    ctx.stroke();
  }

  if (object.type === 'ellipse') {
    const center = worldToScreen({ x: object.x1, y: object.y1 }, zoom, camera);
    const rx = Math.abs(object.x2 - object.x1) * zoom;
    const ry = Math.abs(object.y2 - object.y1) * zoom;
    ctx.beginPath(); ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2);
    if (object.fill && object.fill !== 'transparent') ctx.fill();
    ctx.stroke();
  }

  if (['triangle', 'diamond', 'pentagon', 'hexagon', 'star'].includes(object.type)) {
    const points = polygonPoints(object);
    if (points.length) {
      ctx.beginPath();
      const first = points[0];
      ctx.moveTo((first.x - camera.x) * zoom, (first.y - camera.y) * zoom);
      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        ctx.lineTo((point.x - camera.x) * zoom, (point.y - camera.y) * zoom);
      }
      ctx.closePath();
      if (object.fill && object.fill !== 'transparent') ctx.fill();
      ctx.stroke();
    }
  }

  if (object.type === 'image') {
    if (object.image) {
      const x = sx(object.x); const y = sy(object.y); const w = object.width * zoom; const h = object.height * zoom;
      ctx.drawImage(object.image, x, y, w, h);
      ctx.strokeStyle = 'rgba(17,24,39,0.14)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    }
  }

  if (object.type === 'text') {
    const fontSize = Math.max(8, object.fontSize || 22);
    const lineHeight = fontSize * 1.25;
    const lines = String(object.text ?? '').split('\n');
    ctx.fillStyle = object.color || '#111827';
    ctx.font = `${object.fontWeight || 500} ${fontSize * zoom}px ${object.fontFamily || 'Inter, Arial, sans-serif'}`;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], sx(object.x), sy(object.y) + i * lineHeight * zoom);
    }
  }

  ctx.restore();
}
