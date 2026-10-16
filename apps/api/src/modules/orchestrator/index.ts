import { z } from 'zod';
import type { CollectionFactory } from '../../db/collection';
import type { Env } from '../../config/env';
import { KnowledgeService } from './knowledge';
import { ModelRegistry, defaultDescriptors, type HealthProbe } from './registry';
import { ResourceMonitor, type ResourceSampler } from './resources';
import { routeTask, type TaskInput } from './router';
import { ToolRegistry } from './tools';

export interface OrchestratorDeps {
  collections: CollectionFactory;
  /** Health of the always-on text runtime, reusing the existing styling/Qwen status check. */
  textStatus: () => Promise<{ available: boolean; reason: string }>;
  sampler?: ResourceSampler;
}

/**
 * Thin coordination layer. It owns no model weights and starts no processes; it decides, gates
 * and records. Chat streaming, queues and media jobs stay in NovaService and are reused as is.
 */
export class Orchestrator {
  readonly monitor: ResourceMonitor;
  readonly registry: ModelRegistry;
  readonly tools: ToolRegistry;
  readonly knowledge: KnowledgeService;
  constructor(env: Env, deps: OrchestratorDeps) {
    this.monitor = new ResourceMonitor(deps.sampler);
    const probes: Record<string, HealthProbe> = {
      'nova-text-qwen': async () => {
        const status = await deps.textStatus();
        return { healthy: status.available, reason: status.reason };
      },
    };
    this.registry = new ModelRegistry(defaultDescriptors(env), probes, this.monitor);
    this.tools = new ToolRegistry(
      new Set(
        (env.NOVA_TOOLS_ENABLED ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    );
    this.tools.register({
      name: 'system.resources',
      description: 'Read current RAM, disk and CPU load of the API host.',
      risk: 'read',
      schema: z.object({}).strict(),
      timeoutMs: 2000,
      run: () => this.monitor.sample(),
    });
    this.knowledge = new KnowledgeService(deps.collections);
  }
  route(input: TaskInput, options: { modelId?: string } = {}) {
    return routeTask(this.registry, input, options);
  }
}
