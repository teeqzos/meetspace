import type { BoardObject, Pt } from './types';

const MAX_SIDE = 1600;       // длинная сторона после сжатия
const KEEP_AS_IS_BYTES = 1_200_000;

export function loadImageFromSource(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    image.src = src;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Файл не является изображением'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(file);
  });
}

/** Читает файл и при необходимости уменьшает его: картинка уходит всем участникам по сети. */
export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const original = await fileToDataUrl(file);
  const img = await loadImageFromSource(original);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (file.size <= KEEP_AS_IS_BYTES && longest <= MAX_SIDE) return img;

  const scale = Math.min(1, MAX_SIDE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
  const compressed = canvas.toDataURL(keepAlpha ? 'image/webp' : 'image/jpeg', 0.85);
  return loadImageFromSource(compressed);
}

export function createImageObject(image: HTMLImageElement, center: Pt): BoardObject {
  const maxWidth = 500;
  const maxHeight = 350;
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(40, image.naturalWidth * scale);
  const height = Math.max(40, image.naturalHeight * scale);
  return {
    id: crypto.randomUUID(),
    type: 'image',
    image,
    src: image.src,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  } as BoardObject;
}
