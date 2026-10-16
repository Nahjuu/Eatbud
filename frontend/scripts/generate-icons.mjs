// Genera los iconos de la PWA de Eatbud a partir del arte de marca, sin
// dependencias externas:
//
//   node scripts/generate-icons.mjs
//
// El arte original es `scripts/icon-source.png` (el logo de Eatbud sobre fondo
// blanco). Este script lo decodifica, le quita el fondo, lo recorta al propio
// dibujo y escribe los PNG que piden el manifest, Android y iOS.
//
// Dos acabados, según lo que espera cada plataforma:
//   - `any` (Android, escritorio): se conserva el cuadrado redondeado con las
//     esquinas transparentes, tal como lo dibujó la marca.
//   - `maskable` (Android) y Apple touch icon (iOS): sangran hasta el borde,
//     porque el sistema los recorta con su propia máscara; el borde se rellena
//     prolongando el fondo del propio dibujo, así que no se ve costura.
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'icon-source.png');
const OUT_DIR = join(HERE, '..', 'public');

// ─── Lectura del PNG de origen (8 bits, RGB o RGBA, sin entrelazar) ──────────
function decodePng(file) {
  const buffer = readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => buffer[index] === byte)) {
    throw new Error(`${file} no es un PNG.`);
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];
  let cursor = 8;
  while (cursor < buffer.length) {
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.toString('ascii', cursor + 4, cursor + 8);
    const data = buffer.subarray(cursor + 8, cursor + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('Solo se admiten PNG de 8 bits por canal.');
      if (data[12] !== 0) throw new Error('No se admiten PNG entrelazados.');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (channels === 0) throw new Error('Solo se admiten PNG RGB o RGBA.');
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    cursor += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? lines[row + x - channels] : 0;
      const up = y > 0 ? lines[previous + x] : 0;
      const upLeft = y > 0 && x >= channels ? lines[previous + x - channels] : 0;
      let value = raw[position++];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      lines[row + x] = value & 0xff;
    }
  }

  const pixels = new Float32Array(width * height * 4);
  for (let i = 0, total = width * height; i < total; i++) {
    pixels[i * 4] = lines[i * channels] / 255;
    pixels[i * 4 + 1] = lines[i * channels + 1] / 255;
    pixels[i * 4 + 2] = lines[i * channels + 2] / 255;
    pixels[i * 4 + 3] = channels === 4 ? lines[i * channels + 3] / 255 : 1;
  }

  return { width, height, pixels };
}

// ─── Recorte del fondo blanco ────────────────────────────────────────────────
// El fondo es blanco casi puro (254 aprox.) pero con ruido de compresión: junto
// al borde del dibujo el canal más bajo llega a bajar a 242-250. Por debajo de
// WHITE_FROM el píxel es dibujo (opaco) y por encima de WHITE_TO es fondo
// (transparente); en medio queda el borde suavizado con alfa parcial, y ahí se
// deshace la mezcla con el blanco para no arrastrar un halo claro.
const WHITE_FROM = 236;
const WHITE_TO = 250;
const BACKDROP = 254 / 255; // blanco real del fondo, para deshacer la mezcla

function removeWhiteBackground(image) {
  const { pixels } = image;
  for (let i = 0; i < pixels.length; i += 4) {
    const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) * 255;
    const alpha = Math.min(1, Math.max(0, (WHITE_TO - min) / (WHITE_TO - WHITE_FROM)));
    if (alpha >= 1) continue;

    pixels[i + 3] = alpha;
    if (alpha <= 0) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      continue;
    }
    // color = (observado - fondo * (1 - alfa)) / alfa
    for (let channel = 0; channel < 3; channel++) {
      const observed = pixels[i + channel];
      pixels[i + channel] = Math.min(1, Math.max(0, (observed - BACKDROP * (1 - alpha)) / alpha));
    }
  }
  return image;
}

// ─── Recorte al cuadrado del dibujo ──────────────────────────────────────────
// El logo trae margen blanco alrededor; se recorta al rectángulo de píxeles
// opacos (con un pequeño respiro) para que el dibujo ocupe el icono entero.
const PADDING = 0.02; // 2% extra por lado, para que no toque el borde

function cropToArtwork(image) {
  const { width, height, pixels } = image;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 0.35) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error('El origen no tiene ningún píxel opaco.');

  const side = Math.max(right - left + 1, bottom - top + 1);
  const margin = Math.round(side * PADDING);
  const size = side + margin * 2;
  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;
  const originX = Math.round(centreX - size / 2);
  const originY = Math.round(centreY - size / 2);

  const cropped = { width: size, height: size, pixels: new Float32Array(size * size * 4) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sourceX = originX + x;
      const sourceY = originY + y;
      if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;
      const from = (sourceY * width + sourceX) * 4;
      const to = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel++) cropped.pixels[to + channel] = pixels[from + channel];
    }
  }
  return cropped;
}


// ─── Fondo continuo (maskable y Apple touch icon) ────────────────────────────
// Los iconos que el sistema recorta no pueden tener esquinas transparentes: se
// prolonga hacia fuera el color del borde del propio dibujo (cada píxel de
// fuera toma el del interior más cercano), así el cuadrado queda lleno sin
// costuras y el dibujo no cambia de tamaño ni de sitio.
//
// Las "semillas" de las que se copia el color son los píxeles sólidos que
// sobreviven a una erosión de SEED_EROSION píxeles: descarta la fina banda
// mezclada con el fondo (que es más clara y, si se usara, pintaría un halo
// alrededor del dibujo).
const SEED_EROSION = 3;

function erodedCoreMask(pixels, width, height, radius) {
  const bad = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const min = Math.min(pixels[p], pixels[p + 1], pixels[p + 2]) * 255;
    bad[i] = pixels[p + 3] >= 0.95 && min < 235 ? 0 : 1;
  }

  // Erosión separable: primero en horizontal y luego en vertical (una ventana
  // de radio r equivale a un cuadrado de lado 2r+1). Fuera del lienzo se cuenta
  // como fondo, para no realimentar los bordes de la imagen.
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let outside = 0;
    for (let x = -radius; x <= radius; x++) outside += x < 0 || x >= width ? 1 : bad[base + x];
    for (let x = 0; x < width; x++) {
      horizontal[base + x] = outside === 0 ? 1 : 0;
      const leaving = x - radius;
      const entering = x + radius + 1;
      outside -= leaving >= 0 ? bad[base + leaving] : 1;
      outside += entering < width ? bad[base + entering] : 1;
    }
  }

  const cores = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let outside = 0;
    for (let y = -radius; y <= radius; y++) {
      outside += y < 0 || y >= height ? 1 : 1 - horizontal[y * width + x];
    }
    for (let y = 0; y < height; y++) {
      cores[y * width + x] = outside === 0 ? 1 : 0;
      const leaving = y - radius;
      const entering = y + radius + 1;
      outside -= leaving >= 0 ? 1 - horizontal[leaving * width + x] : 1;
      outside += entering < height ? 1 - horizontal[entering * width + x] : 1;
    }
  }
  return cores;
}

// Difusión por capas desde el dibujo hacia fuera (BFS: la primera semilla que
// llega a un píxel es la más cercana, sin necesidad de calcular distancias).
// Devuelve, para cada píxel, el índice de la semilla de la que copia el color;
// las semillas se apuntan a sí mismas.
function nearestArtwork(pixels, width, height, radius) {
  const nearest = new Int32Array(width * height).fill(-1);
  const queue = [];

  const cores = erodedCoreMask(pixels, width, height, radius);
  for (let index = 0; index < width * height; index++) {
    if (cores[index] !== 1) continue;
    nearest[index] = index;
    queue.push(index);
  }
  if (queue.length === 0) throw new Error('No hay nada que rellenar: el dibujo está vacío.');

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % width;
    const owner = nearest[index];
    if (x > 0 && nearest[index - 1] < 0) {
      nearest[index - 1] = owner;
      queue.push(index - 1);
    }
    if (x < width - 1 && nearest[index + 1] < 0) {
      nearest[index + 1] = owner;
      queue.push(index + 1);
    }
    if (index >= width && nearest[index - width] < 0) {
      nearest[index - width] = owner;
      queue.push(index - width);
    }
    if (index < width * (height - 1) && nearest[index + width] < 0) {
      nearest[index + width] = owner;
      queue.push(index + width);
    }
  }
  return nearest;
}

function fillOutsideWithNearest(image) {
  const { width, height, pixels } = image;
  const nearest = nearestArtwork(pixels, width, height, SEED_EROSION);
  for (let index = 0; index < width * height; index++) {
    const owner = nearest[index];
    if (owner === index) continue;
    pixels[index * 4] = pixels[owner * 4];
    pixels[index * 4 + 1] = pixels[owner * 4 + 1];
    pixels[index * 4 + 2] = pixels[owner * 4 + 2];
    pixels[index * 4 + 3] = 1;
  }
  return image;
}

// ─── Suavizado del borde (iconos con esquinas transparentes) ─────────────────
// La silueta del logo trae un píxel de mezcla con el fondo (más claro) en todo
// el contorno; si se deja tal cual, al mirar el icono sobre un fondo oscuro se
// ve un reborde claro. Aquí ese píxel de contorno recupera el color del propio
// dibujo y se queda con el alfa que le corresponde según cuánto blanco tenía.
function softenSilhouette(image) {
  const { width, height, pixels } = image;
  const nearest = nearestArtwork(pixels, width, height, SEED_EROSION);
  const solid = Float32Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (solid[index] <= 0.02) continue;

      let inContour = false;
      for (let dy = -1; dy <= 1 && !inContour; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= height || nx >= width) continue;
          if (solid[ny * width + nx] <= 0.02) {
            inContour = true;
            break;
          }
        }
      }
      if (!inContour) continue;

      const owner = nearest[index];
      const coreMin = Math.min(pixels[owner * 4], pixels[owner * 4 + 1], pixels[owner * 4 + 2]);
      const hereMin = Math.min(pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2]);
      const coverage = coreMin < hereMin ? 1 - (hereMin - coreMin) / (BACKDROP - coreMin) : 1;

      pixels[index * 4] = pixels[owner * 4];
      pixels[index * 4 + 1] = pixels[owner * 4 + 1];
      pixels[index * 4 + 2] = pixels[owner * 4 + 2];
      pixels[index * 4 + 3] = Math.min(1, Math.max(0, coverage));
    }
  }
  return image;
}

// ─── Reducción de tamaño (media por área, en alfa premultiplicado) ───────────
// Evita que las esquinas redondeadas queden con escalones o manchas claras: el
// alfa se interpola junto al color, no por separado.
function spanOf(index, input, output) {
  return [index * (input / output), Math.min(input, (index + 1) * (input / output))];
}

function resize(image, size) {
  const { width, height, pixels } = image;
  const premultiplied = new Float64Array(width * height * 4);
  for (let i = 0, total = width * height; i < total; i++) {
    const alpha = pixels[i * 4 + 3];
    premultiplied[i * 4] = pixels[i * 4] * alpha;
    premultiplied[i * 4 + 1] = pixels[i * 4 + 1] * alpha;
    premultiplied[i * 4 + 2] = pixels[i * 4 + 2] * alpha;
    premultiplied[i * 4 + 3] = alpha;
  }

  const horizontal = new Float64Array(size * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      const [from, to] = spanOf(x, width, size);
      const sums = [0, 0, 0, 0];
      let coverageTotal = 0;
      for (let source = Math.floor(from); source < Math.ceil(to); source++) {
        const coverage = Math.min(to, source + 1) - Math.max(from, source);
        if (coverage <= 0) continue;
        for (let channel = 0; channel < 4; channel++) {
          sums[channel] += premultiplied[(y * width + source) * 4 + channel] * coverage;
        }
        coverageTotal += coverage;
      }
      for (let channel = 0; channel < 4; channel++) {
        horizontal[(y * size + x) * 4 + channel] = sums[channel] / coverageTotal;
      }
    }
  }

  const output = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const [from, to] = spanOf(y, height, size);
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0, 0];
      let coverageTotal = 0;
      for (let source = Math.floor(from); source < Math.ceil(to); source++) {
        const coverage = Math.min(to, source + 1) - Math.max(from, source);
        if (coverage <= 0) continue;
        for (let channel = 0; channel < 4; channel++) {
          sums[channel] += horizontal[(source * size + x) * 4 + channel] * coverage;
        }
        coverageTotal += coverage;
      }
      const alpha = sums[3] / coverageTotal;
      const target = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        // Se vuelve a separar el color del alfa (el promedio se hizo premixto).
        const value = alpha > 0 ? sums[channel] / coverageTotal / alpha : 0;
        output[target + channel] = Math.round(Math.min(1, Math.max(0, value)) * 255);
      }
      output[target + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  return output;
}


// ─── Escritura del PNG (RGBA, 8 bits, sin entrelazar) ────────────────────────
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

  // Cada línea lleva delante su byte de filtro; 0 = sin filtro, que para un
  // dibujo suave comprime igual de bien y mantiene el código simple.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}


// ─── Comprobación de la zona segura del icono maskable ───────────────────────
// Android recorta los iconos maskable con su propia forma y garantiza que sólo
// se vea el círculo central (el 80% del ancho). Si el dibujo se sale de ahí,
// más vale enterarse al generar los iconos que verlo recortado en el móvil.
const SAFE_RADIUS = 0.4;

function glyphRadius(image) {
  const { width, height, pixels } = image;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 0.5) continue;
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      // Verde de la marca (el cuenco y los brotes), no el fondo oscuro ni el
      // blanco: se exige dominancia clara del canal verde.
      if (!(green > 0.45 && green > red + 0.15 && green > blue + 0.07)) continue;
      const distance = Math.hypot(x / width - 0.5, y / height - 0.5);
      if (distance > max) max = distance;
    }
  }
  return max;
}

// ─── Iconos a generar ────────────────────────────────────────────────────────
const ICONS = [
  { file: 'icons/icon-192.png', size: 192, bleed: false },
  { file: 'icons/icon-512.png', size: 512, bleed: false },
  { file: 'icons/maskable-512.png', size: 512, bleed: true },
  { file: 'apple-touch-icon.png', size: 180, bleed: true },
  { file: 'favicon-32.png', size: 32, bleed: false },
];

const artwork = cropToArtwork(removeWhiteBackground(decodePng(SOURCE)));
console.log(`origen: recortado a ${artwork.width}x${artwork.height} (el dibujo, sin el fondo blanco)`);

const radius = glyphRadius(artwork);
console.log(`glifo: radio ${radius.toFixed(3)} desde el centro; zona segura del maskable ${SAFE_RADIUS.toFixed(3)}`);
if (radius > SAFE_RADIUS) {
  throw new Error('El dibujo sobresale de la zona segura del icono maskable.');
}

for (const { file, size, bleed } of ICONS) {
  const target = join(OUT_DIR, file);
  mkdirSync(dirname(target), { recursive: true });
  const image = { width: artwork.width, height: artwork.height, pixels: artwork.pixels.slice() };
  if (bleed) fillOutsideWithNearest(image);
  else softenSilhouette(image);
  const png = encodePng(size, resize(image, size));
  writeFileSync(target, png);
  const finish = bleed ? 'a sangre (lo recorta el sistema)' : 'esquinas transparentes';
  console.log(`${file.padEnd(28)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB  ${finish}`);
}

