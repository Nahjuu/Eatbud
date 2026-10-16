// Genera los iconos PNG de la PWA de Eatbud sin dependencias externas.
//
//   node scripts/generate-icons.mjs
//
// La marca reutiliza la paleta de la app (tailwind.config.js y App.jsx):
// fondo #07110f con el resplandor #174a3d arriba a la izquierda y la hoja en
// verde de marca #6ee7b7 -> #a7f3d0. El mismo dibujo existe en vectorial en
// public/favicon.svg; este script sólo lo rasteriza a los tamaños que piden
// Android, iOS y el manifest.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ─── Paleta ──────────────────────────────────────────────────────────────────
const BG_TOP = [0x17, 0x4a, 0x3d]; // #174a3d, igual que el radial-gradient de App.jsx
const BG_BOTTOM = [0x07, 0x11, 0x0f]; // #07110f
const LEAF_BASE = [0x6e, 0xe7, 0xb7]; // brand.DEFAULT
const LEAF_TIP = [0xa7, 0xf3, 0xd0]; // brand.light

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

// ─── Formas (coordenadas normalizadas 0..1) ──────────────────────────────────

// Cuadrado con esquinas redondeadas (esquinas transparentes, como iOS/Android).
function insideRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// Hoja: eje vertical, base en (0.5, 0.5 + g/2) y punta en (0.5, 0.5 - g/2).
// El ancho sigue un perfil de pétalo (seno) para que las dos puntas queden finas.
function leafAt(x, y, g, halfWidthFactor) {
  const u = (0.5 + g / 2 - y) / g; // 0 en la base, 1 en la punta
  if (u < 0 || u > 1) return null;
  const halfWidth = halfWidthFactor * g * Math.pow(Math.sin(Math.PI * u), 0.7);
  if (Math.abs(x - 0.5) > halfWidth) return null;
  return u;
}

// Color de una muestra concreta (el supersampling va aparte).
function sample(x, y, { transparentCorners, glyphScale }) {
  if (transparentCorners && !insideRoundedSquare(x, y, 0.22)) {
    return [0, 0, 0, 0];
  }

  // Fondo: gradiente diagonal equivalente al radial de la app.
  const t = Math.min(1, Math.max(0, (x + y) / 2));
  let rgb = mix(BG_TOP, BG_BOTTOM, t);

  const u = leafAt(x, y, glyphScale, 0.34);
  if (u !== null) {
    // Verde de marca, más claro hacia la punta. La mitad izquierda va un poco
    // más oscura para sugerir el pliegue de la hoja (sin líneas negras).
    const leaf = mix(LEAF_BASE, LEAF_TIP, u);
    rgb = x < 0.5 ? leaf.map((value) => value * 0.82) : leaf;
  }

  return [...rgb, 255];
}

// ─── Rasterizado con supersampling (4x4 muestras por píxel) ──────────────────
const SAMPLES = 4;

function render(size, options) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          const [sr, sg, sb, sa] = sample(x, y, options);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += sa;
        }
      }

      const total = SAMPLES * SAMPLES;
      const alphaSum = a / 255;
      const offset = (py * size + px) * 4;
      // Se guarda el color promediado por el alfa para no dejar bordes claros.
      pixels[offset] = alphaSum ? Math.round(r / alphaSum) : 0;
      pixels[offset + 1] = alphaSum ? Math.round(g / alphaSum) : 0;
      pixels[offset + 2] = alphaSum ? Math.round(b / alphaSum) : 0;
      pixels[offset + 3] = Math.round(a / total);
    }
  }

  return pixels;
}

// ─── Escritura de PNG (RGBA, 8 bits) ─────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // filtro adaptativo
  header[12] = 0; // sin entrelazado

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // sin filtro por línea
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Iconos ──────────────────────────────────────────────────────────────────
// `transparentCorners` sólo en los iconos "any": Android los muestra tal cual,
// mientras que los maskable y el de iOS sangran hasta el borde porque el
// sistema los recorta (si tuvieran esquinas transparentes se verían con bordes
// negros).
const ICONS = [
  { file: 'icons/icon-192.png', size: 192, transparentCorners: true, glyphScale: 0.68 },
  { file: 'icons/icon-512.png', size: 512, transparentCorners: true, glyphScale: 0.68 },
  { file: 'icons/maskable-512.png', size: 512, transparentCorners: false, glyphScale: 0.56 },
  { file: 'apple-touch-icon.png', size: 180, transparentCorners: false, glyphScale: 0.68 },
];

for (const { file, size, ...options } of ICONS) {
  const target = join(OUT_DIR, file);
  mkdirSync(dirname(target), { recursive: true });
  const png = encodePng(size, render(size, options));
  writeFileSync(target, png);
  console.log(`${file.padEnd(30)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
