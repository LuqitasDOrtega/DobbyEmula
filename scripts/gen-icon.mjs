import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'icon.ico');
const SOURCE = path.join(__dirname, '..', 'dist', 'Icono DobbyEmula.png');

// Elimina el fondo negro haciendo transparentes los píxeles oscuros
async function removeBlackBg(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const brightness = Math.max(r, g, b);
    if (brightness < 25) {
      pixels[i + 3] = 0; // negro puro → transparente
    } else if (brightness < 55) {
      // zona de transición (anti-aliasing del borde)
      pixels[i + 3] = Math.round(((brightness - 25) / 30) * 255);
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toBuffer();
}

const noBgBuffer = await removeBlackBg(SOURCE);

const sizes = [16, 24, 32, 48, 64, 128, 256];

const pngBuffers = await Promise.all(
  sizes.map(s =>
    sharp(noBgBuffer)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  )
);

const icoBuffer = await pngToIco(pngBuffers);
writeFileSync(OUT, icoBuffer);
console.log(`✓ Ícono generado en ${OUT} (${(icoBuffer.length / 1024).toFixed(1)} KB)`);

const previewPath = path.join(__dirname, '..', 'assets', 'icon-preview.png');
await sharp(noBgBuffer).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(previewPath);
console.log(`✓ Preview guardado en ${previewPath}`);
