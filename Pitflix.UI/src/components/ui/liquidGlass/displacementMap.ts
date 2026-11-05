/**
 * Builds the displacement map for a liquid-glass lens: a rounded rectangle whose rim
 * (the outer `bezel` px) bends the backdrop inward, like light through the curved edge
 * of a glass slab. The flat centre is neutral (128,128) so it only blurs.
 *
 * Encoding matches feDisplacementMap: R = x shift, G = y shift, 128 = no shift.
 */
export function buildDisplacementMap(width: number, height: number, radius: number, bezel: number): string {
  // Half resolution is plenty — feImage stretches it back up and the shift is blurred anyway.
  const scale = width * height > 40_000 ? 0.5 : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.min(radius, hw, hh);
  const innerW = hw - r;
  const innerH = hh - r;

  for (let y = 0; y < h; y++) {
    const py = (y + 0.5) / scale - hh;
    const ay = Math.abs(py);
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) / scale - hw;
      const ax = Math.abs(px);
      const qx = ax - innerW;
      const qy = ay - innerH;

      // Signed distance to the rounded-rect edge (negative inside) and the outward normal.
      let depth: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        depth = r - len;
        nx = (qx / (len || 1)) * Math.sign(px);
        ny = (qy / (len || 1)) * Math.sign(py);
      } else if (qx > qy) {
        depth = r - qx;
        nx = Math.sign(px);
        ny = 0;
      } else {
        depth = r - qy;
        nx = 0;
        ny = Math.sign(py);
      }

      let dx = 0;
      let dy = 0;
      if (depth > 0 && depth < bezel) {
        // Steepest at the very edge, flattening out toward the centre (convex squircle-ish profile).
        const t = 1 - depth / bezel;
        const mag = t * t;
        dx = -nx * mag;
        dy = -ny * mag;
      }

      const i = (y * w + x) * 4;
      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
