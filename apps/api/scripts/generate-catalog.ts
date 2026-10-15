/**
 * Generates the bundled sample garment illustrations (flat vector style) into assets/catalog.
 * These are placeholders for demos - not photographs of real products.
 * Run with: npm run generate:catalog
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SIZE = 768;
const BG = '#f4f2ee';

const shapes: Record<string, (c: string, s: string) => string> = {
  tee: (c, s) => `
    <path d="M250 150 L130 215 L180 320 L240 290 L240 650 L528 650 L528 290 L588 320 L638 215 L518 150 Q384 215 250 150 Z" fill="${c}" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M250 150 Q384 215 518 150" fill="none" stroke="${s}" stroke-width="6"/>`,
  shirt: (c, s) => `
    <path d="M255 140 L110 230 L150 520 L225 505 L240 650 L528 650 L543 505 L618 520 L658 230 L513 140 L384 190 Z" fill="${c}" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M255 140 L384 260 L513 140 L470 130 L384 190 L298 130 Z" fill="#ffffff" fill-opacity="0.55" stroke="${s}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M384 260 L384 650" stroke="${s}" stroke-width="5"/>
    <g fill="${s}"><circle cx="384" cy="340" r="7"/><circle cx="384" cy="420" r="7"/><circle cx="384" cy="500" r="7"/><circle cx="384" cy="580" r="7"/></g>`,
  jacket: (c, s) => `
    <path d="M260 130 L105 230 L145 600 L230 590 L240 660 L528 660 L538 590 L623 600 L663 230 L508 130 L384 175 Z" fill="${c}" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M260 130 L384 330 L508 130 L460 120 L384 175 L308 120 Z" fill="#000000" fill-opacity="0.18" stroke="${s}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M384 330 L384 660" stroke="${s}" stroke-width="6"/>
    <rect x="270" y="470" width="90" height="70" rx="6" fill="none" stroke="${s}" stroke-width="5"/>
    <rect x="408" y="470" width="90" height="70" rx="6" fill="none" stroke="${s}" stroke-width="5"/>
    <path d="M240 640 H528" stroke="${s}" stroke-width="5"/>`,
  trousers: (c, s) => `
    <path d="M255 110 H513 L545 700 H415 L384 330 L353 700 H223 Z" fill="${c}" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M255 110 V160 H513 V110" fill="#000000" fill-opacity="0.12" stroke="${s}" stroke-width="5"/>
    <path d="M384 160 V330" stroke="${s}" stroke-width="5"/>
    <path d="M300 200 Q330 250 300 290" fill="none" stroke="${s}" stroke-width="4"/>`,
  dress: (c, s) => `
    <path d="M300 110 L260 110 L215 240 L295 275 L215 700 L553 700 L473 275 L553 240 L508 110 L468 110 Q384 215 300 110 Z" fill="${c}" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M295 275 H473" stroke="${s}" stroke-width="6"/>
    <path d="M300 110 Q384 215 468 110" fill="none" stroke="${s}" stroke-width="6"/>`,
};

const items: Array<{ id: string; shape: keyof typeof shapes; color: string; stroke: string }> = [
  { id: 'tee-classic-white', shape: 'tee', color: '#fbfbfa', stroke: '#9a9a9a' },
  { id: 'tee-graphite', shape: 'tee', color: '#4a4d52', stroke: '#2a2c30' },
  { id: 'shirt-oxford-blue', shape: 'shirt', color: '#9db9d8', stroke: '#5f7fa3' },
  { id: 'shirt-linen-sand', shape: 'shirt', color: '#d9c7a6', stroke: '#a89268' },
  { id: 'jacket-denim', shape: 'jacket', color: '#3d5a80', stroke: '#26384f' },
  { id: 'jacket-bomber-olive', shape: 'jacket', color: '#6b7350', stroke: '#454b31' },
  { id: 'trousers-chino-khaki', shape: 'trousers', color: '#c2a878', stroke: '#8f7a52' },
  { id: 'trousers-tailored-charcoal', shape: 'trousers', color: '#3b3d42', stroke: '#1f2023' },
  { id: 'dress-midi-indigo', shape: 'dress', color: '#3f3f8f', stroke: '#27275c' },
  { id: 'dress-summer-rose', shape: 'dress', color: '#d89aa6', stroke: '#a96473' },
];

async function main() {
  const outDir = path.resolve(__dirname, '..', 'assets', 'catalog');
  await mkdir(outDir, { recursive: true });
  for (const item of items) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
      <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
      ${shapes[item.shape]!(item.color, item.stroke)}
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(path.join(outDir, `${item.id}.png`), png);
    console.log(`wrote ${item.id}.png`);
  }
}

void main();
