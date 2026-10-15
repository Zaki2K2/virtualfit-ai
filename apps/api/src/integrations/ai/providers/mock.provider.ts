import sharp from 'sharp';
import type {
  TryOnInput,
  TryOnOutput,
  VirtualTryOnProvider,
} from '../interfaces/virtual-try-on-provider';

const SIZE = { width: 768, height: 1024 };

/**
 * Local development provider. It performs NO AI inference. It returns the person's photo with a
 * permanent, unmistakable banner and the garment shown as a thumbnail, so nobody can mistake the
 * output for a real try-on. It exists only to exercise the upload -> generate -> preview workflow.
 */
export class MockProvider implements VirtualTryOnProvider {
  readonly id = 'mock' as const;
  readonly model = 'mock-simulation';
  readonly simulated = true;
  readonly externalProcessing = false;
  readonly allowedImageHosts = [] as const;

  constructor(private readonly delayMs = 1500) {}

  isConfigured() {
    return true;
  }

  async generate({
    personImage,
    garmentImage,
    category,
    signal,
  }: TryOnInput): Promise<TryOnOutput> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });

    const base = await sharp(personImage)
      .resize(SIZE.width, SIZE.height, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();

    const thumb = await sharp(garmentImage)
      .resize(208, 208, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();

    const overlay = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" height="${SIZE.height}">
        <rect x="0" y="0" width="${SIZE.width}" height="72" fill="#1e1b4b" fill-opacity="0.92"/>
        <text x="24" y="32" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#ffffff">SIMULATION - NOT AI OUTPUT</text>
        <text x="24" y="58" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#c7d2fe">Mock provider (${category}). Your photo is unchanged.</text>
        <rect x="${SIZE.width - 248}" y="${SIZE.height - 280}" width="228" height="260" rx="12" fill="#ffffff" stroke="#1e1b4b" stroke-width="3"/>
        <text x="${SIZE.width - 134}" y="${SIZE.height - 30}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#1e1b4b">Selected garment</text>
      </svg>`,
    );

    const imageBuffer = await sharp(base)
      .composite([
        { input: overlay, top: 0, left: 0 },
        { input: thumb, top: SIZE.height - 270, left: SIZE.width - 238 },
      ])
      .png()
      .toBuffer();

    return { imageBuffer };
  }
}
