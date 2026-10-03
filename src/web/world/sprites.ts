import { alphaFromColor } from "./math";

export interface SpriteArt {
  bitmap: ImageBitmap;
  hue: number;
  glyph: boolean;
}

const SIZE = 256;

function averageHue(data: Uint8ClampedArray): number {
  let x = 0;
  let y = 0;

  for (let i = 0; i < data.length; i += 16) {
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    if (chroma < 0.08) continue;
    let hue = 0;

    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    const angle = (hue / 6) * Math.PI * 2;
    x += Math.cos(angle) * chroma;
    y += Math.sin(angle) * chroma;
  }

  return ((Math.atan2(y, x) / (Math.PI * 2)) * 360 + 360) % 360;
}

export function keyOutBlack(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = Math.round(alphaFromColor(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) * 255);
  }
}

interface OpaqueBox {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export function opaqueBox(data: Uint8ClampedArray, size: number): OpaqueBox {
  let left = size;
  let top = size;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((data[(y * size + x) * 4 + 3] ?? 0) < 60) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right <= left || bottom <= top) return { centerX: size / 2, centerY: size / 2, width: size, height: size };
  const pad = 6;

  return {
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width: Math.min(size, right - left + pad * 2),
    height: Math.min(size, bottom - top + pad * 2),
  };
}

async function transparentFrom(source: ImageBitmap): Promise<SpriteArt | null> {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) return null;
  context.drawImage(source, 0, 0, SIZE, SIZE);
  const pixels = context.getImageData(0, 0, SIZE, SIZE);
  keyOutBlack(pixels.data);
  context.putImageData(pixels, 0, 0);
  const box = opaqueBox(pixels.data, SIZE);
  const side = Math.max(box.width, box.height);

  const cropped = await createImageBitmap(canvas, box.centerX - side / 2, box.centerY - side / 2, side, side, {
    resizeWidth: SIZE,
    resizeHeight: SIZE,
  });

  return { bitmap: cropped, hue: averageHue(pixels.data), glyph: false };
}

export async function glyphArt(name: string, hue: number): Promise<SpriteArt | null> {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d");

  if (!context) return null;
  const letter = name.slice(0, 1).toUpperCase() || "?";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `bold ${SIZE * 0.6}px ui-monospace, monospace`;
  context.shadowColor = `hsl(${hue}, 100%, 60%)`;
  context.shadowBlur = 30;
  context.fillStyle = `hsl(${hue}, 100%, 75%)`;
  context.fillText(letter, SIZE / 2, SIZE / 2);
  context.shadowBlur = 0;
  context.font = `${SIZE * 0.1}px ui-monospace, monospace`;
  context.fillText(name.slice(0, 10), SIZE / 2, SIZE * 0.88);

  return { bitmap: await createImageBitmap(canvas), hue, glyph: true };
}

export async function loadSprite(id: string): Promise<SpriteArt | null> {
  try {
    const response = await fetch(`/api/sprite/${id}`);

    if (!response.ok) return null;

    return transparentFrom(await createImageBitmap(await response.blob()));
  } catch {
    return null;
  }
}

export async function loadFloor(): Promise<ImageBitmap | null> {
  for (const url of ["/api/floor", "/floor.jpg"]) {
    try {
      const response = await fetch(url);

      if (response.ok) return await createImageBitmap(await response.blob());
    } catch {}
  }

  return null;
}
