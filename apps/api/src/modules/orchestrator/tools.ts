import { createHash, randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { AppError } from '../../utils/errors';

/** read = no side effects; write/execute/external always need a fresh human confirmation. */
export type ToolRisk = 'read' | 'write' | 'execute' | 'external';

export interface ToolContext {
  ownerId: string;
  signal: AbortSignal;
}
export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  risk: ToolRisk;
  schema: ZodType<I>;
  timeoutMs: number;
  run(input: I, ctx: ToolContext): Promise<O>;
}

interface Approval {
  id: string;
  ownerId: string;
  tool: string;
  inputHash: string;
  expiresAt: number;
  confirmed: boolean;
  used: boolean;
}
export interface AuditEntry {
  at: string;
  ownerId: string;
  tool: string;
  risk: ToolRisk;
  outcome: 'ok' | 'denied' | 'failed' | 'timeout' | 'cancelled';
  detail?: string;
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const APPROVAL_TTL_MS = 5 * 60_000;
const AUDIT_LIMIT = 500;

/**
 * Deny-by-default tool gateway. A tool must be both registered and named in the operator's
 * allowlist. Approval is a separate, user-initiated step bound to owner, tool and exact input,
 * single use and short lived, so model output can never approve its own action.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly approvals = new Map<string, Approval>();
  private readonly audit: AuditEntry[] = [];
  constructor(private readonly enabled: ReadonlySet<string>) {}

  register<I, O>(tool: ToolDefinition<I, O>) {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool as ToolDefinition);
  }
  list() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      risk: t.risk,
      enabled: this.enabled.has(t.name),
      requiresApproval: t.risk !== 'read',
    }));
  }
  auditLog(ownerId: string) {
    return this.audit.filter((e) => e.ownerId === ownerId);
  }
  private record(entry: Omit<AuditEntry, 'at'>) {
    this.audit.push({ at: new Date().toISOString(), ...entry });
    if (this.audit.length > AUDIT_LIMIT) this.audit.shift();
  }
  private lookup(name: string) {
    const tool = this.tools.get(name);
    if (!tool) throw AppError.notFound('Tool');
    return tool;
  }

  /** Step 1 (for non-read tools): describe the exact action; nothing runs. */
  requestApproval(ownerId: string, name: string, rawInput: unknown) {
    const tool = this.lookup(name);
    if (!this.enabled.has(name))
      throw new AppError(403, 'VALIDATION_ERROR', `Tool "${name}" is not enabled by the operator.`);
    if (tool.risk === 'read') throw AppError.badRequest('Read-only tools do not need approval.');
    const input = tool.schema.parse(rawInput);
    const approval: Approval = {
      id: randomUUID(),
      ownerId,
      tool: name,
      inputHash: hash(input),
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      confirmed: false,
      used: false,
    };
    this.approvals.set(approval.id, approval);
    return {
      approvalId: approval.id,
      tool: name,
      risk: tool.risk,
      input,
      expiresInMs: APPROVAL_TTL_MS,
    };
  }
  /** Step 2: only an explicit user action reaches this. */
  confirm(ownerId: string, approvalId: string) {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.ownerId !== ownerId || approval.expiresAt < Date.now())
      throw AppError.notFound('Approval');
    approval.confirmed = true;
  }

  async invoke(name: string, rawInput: unknown, ctx: ToolContext & { approvalId?: string }) {
    const tool = this.lookup(name);
    const deny = (message: string): never => {
      this.record({
        ownerId: ctx.ownerId,
        tool: name,
        risk: tool.risk,
        outcome: 'denied',
        detail: message,
      });
      throw new AppError(403, 'VALIDATION_ERROR', message);
    };
    if (!this.enabled.has(name)) deny(`Tool "${name}" is not enabled by the operator.`);
    const input = tool.schema.parse(rawInput);
    if (tool.risk !== 'read') {
      const approval = ctx.approvalId ? this.approvals.get(ctx.approvalId) : undefined;
      if (
        !approval ||
        approval.ownerId !== ctx.ownerId ||
        approval.tool !== name ||
        approval.inputHash !== hash(input) ||
        !approval.confirmed ||
        approval.used ||
        approval.expiresAt < Date.now()
      )
        deny(`"${name}" (${tool.risk}) needs a current, matching confirmation from you.`);
      approval!.used = true;
    }
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeoutMs)]);
    try {
      const result = await Promise.race([
        tool.run(input, { ownerId: ctx.ownerId, signal }),
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
      ]);
      this.record({ ownerId: ctx.ownerId, tool: name, risk: tool.risk, outcome: 'ok' });
      return result;
    } catch (error) {
      const cancelled = ctx.signal.aborted;
      const timedOut = !cancelled && signal.aborted;
      this.record({
        ownerId: ctx.ownerId,
        tool: name,
        risk: tool.risk,
        outcome: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed',
        detail: (error as Error).message.slice(0, 200),
      });
      if (timedOut) throw new AppError(504, 'AI_TIMEOUT', `Tool "${name}" timed out.`);
      throw error;
    }
  }
}
