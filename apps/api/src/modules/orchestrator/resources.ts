import os from 'node:os';
import { statfs } from 'node:fs/promises';

export interface ResourceSample {
  totalRamBytes: number;
  freeRamBytes: number;
  freeDiskBytes: number | null;
  loadAverage: number[];
  cpuCount: number;
  sampledAt: string;
}
export type ResourceSampler = () => Promise<ResourceSample>;

export const sampleResources: ResourceSampler = async () => {
  let freeDiskBytes: number | null = null;
  try {
    const s = await statfs(process.cwd());
    freeDiskBytes = s.bavail * s.bsize;
  } catch {
    // Unsupported filesystem: report unknown rather than guessing.
  }
  return {
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    freeDiskBytes,
    loadAverage: os.loadavg(),
    cpuCount: os.cpus().length,
    sampledAt: new Date().toISOString(),
  };
};

export interface Admission {
  ok: boolean;
  reason: string;
}

/** Decides whether a lazily-loaded local model may start; never loads anything itself. */
export class ResourceMonitor {
  constructor(
    private readonly sampler: ResourceSampler = sampleResources,
    private readonly reserveRamBytes = 512 * 1024 * 1024,
  ) {}
  sample() {
    return this.sampler();
  }
  async admit(requirement: { minFreeRamGb?: number; minFreeDiskGb?: number }): Promise<Admission> {
    const s = await this.sampler();
    const needRam = (requirement.minFreeRamGb ?? 0) * 1024 ** 3 + this.reserveRamBytes;
    if (requirement.minFreeRamGb && s.freeRamBytes < needRam)
      return {
        ok: false,
        reason: `Insufficient free RAM: ${(s.freeRamBytes / 1024 ** 3).toFixed(1)} GiB free, ${(needRam / 1024 ** 3).toFixed(1)} GiB needed including reserve.`,
      };
    if (
      requirement.minFreeDiskGb &&
      s.freeDiskBytes !== null &&
      s.freeDiskBytes < requirement.minFreeDiskGb * 1024 ** 3
    )
      return { ok: false, reason: 'Insufficient free disk space for this model.' };
    return { ok: true, reason: 'Resources sufficient.' };
  }
}
