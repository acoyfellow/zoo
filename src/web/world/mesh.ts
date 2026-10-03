import { GRID, type MeshPoint, meshVertices } from "./math";

function drawTriangle(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  source: [MeshPoint, MeshPoint, MeshPoint],
  target: [MeshPoint, MeshPoint, MeshPoint],
): void {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = target;
  const denominator = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);

  if (denominator === 0) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denominator;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denominator;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denominator;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denominator;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: MeshPoint) => ({ x: p.x + Math.sign(p.x - cx) * 0.6, y: p.y + Math.sign(p.y - cy) * 0.6 });
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  context.save();
  context.beginPath();
  context.moveTo(g0.x, g0.y);
  context.lineTo(g1.x, g1.y);
  context.lineTo(g2.x, g2.y);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

export function drawMesh(context: CanvasRenderingContext2D, image: ImageBitmap, size: number, sway: number): void {
  const vertices = meshVertices(size, sway);
  const step = image.width / (GRID - 1);

  for (let row = 0; row < GRID - 1; row++) {
    for (let column = 0; column < GRID - 1; column++) {
      const i = row * GRID + column;
      const p00 = vertices[i];
      const p10 = vertices[i + 1];
      const p01 = vertices[i + GRID];
      const p11 = vertices[i + GRID + 1];

      if (!p00 || !p10 || !p01 || !p11) continue;
      const u0 = column * step;
      const v0 = row * step;
      const s00 = { x: u0, y: v0 };
      const s10 = { x: u0 + step, y: v0 };
      const s01 = { x: u0, y: v0 + step };
      const s11 = { x: u0 + step, y: v0 + step };
      drawTriangle(context, image, [s00, s10, s01], [p00, p10, p01]);
      drawTriangle(context, image, [s10, s11, s01], [p10, p11, p01]);
    }
  }
}
