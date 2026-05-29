/**
 * AX OS - Tool Registry (Layer 5)
 * Register callable tools that agents can invoke via workflow steps.
 * Tools are pre/post-execution hooks, not LLM-directed tool calls.
 */

import { SharedMemory } from "./ax-os-memory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolParamType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParam {
  readonly type: ToolParamType;
  readonly description: string;
  readonly required: boolean;
  readonly default?: unknown;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, ToolParam>>;
  readonly execute: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<unknown>;
}

export interface ToolContext {
  readonly memory: SharedMemory;
  readonly agentId: string;
  readonly workflowId: string;
  readonly runId: string;
}

export interface ToolCall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** Context key where the result is stored for {{interpolation}} */
  readonly outputKey: string;
}

export interface ToolResult {
  readonly tool: string;
  readonly outputKey: string;
  readonly value: unknown;
  readonly serialized: string;    // JSON-stringified value
  readonly success: boolean;
  readonly error?: string;
  readonly latencyMs: number;
}

export class ToolRegistryError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new ToolRegistryError(`Tool "${def.name}" already registered`, "DUPLICATE_TOOL");
    }
    this.tools.set(def.name, def);
  }

  get(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  list(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(
    call: ToolCall,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const def = this.tools.get(call.tool);
    if (!def) {
      return {
        tool: call.tool,
        outputKey: call.outputKey,
        value: null,
        serialized: "null",
        success: false,
        error: `Tool "${call.tool}" not found`,
        latencyMs: 0,
      };
    }

    const t0 = Date.now();
    try {
      // Fill defaults for missing params
      const args = { ...call.args };
      for (const [key, param] of Object.entries(def.parameters)) {
        if (!(key in args) && param.default !== undefined) {
          args[key] = param.default;
        }
      }

      const value = await def.execute(args, ctx);
      const serialized = JSON.stringify(value, null, 2);
      return {
        tool: call.tool,
        outputKey: call.outputKey,
        value,
        serialized,
        success: true,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        tool: call.tool,
        outputKey: call.outputKey,
        value: null,
        serialized: "null",
        success: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - t0,
      };
    }
  }

  /** Execute a batch of tool calls in order. */
  async executeBatch(
    calls: readonly ToolCall[],
    ctx: ToolContext
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.execute(call, ctx));
    }
    return results;
  }
}

// ── Built-in tools ────────────────────────────────────────────────────────────

/** memory:get — read a value from SharedMemory */
export const memoryGetTool: ToolDefinition = {
  name: "memory_get",
  description: "Read a value from SharedMemory by namespace and key",
  parameters: {
    namespace: { type: "string", description: "Memory namespace", required: true },
    key:       { type: "string", description: "Entry key",        required: true },
  },
  async execute({ namespace, key }, { memory }) {
    return memory.get(String(namespace), String(key));
  },
};

/** memory:set — write a value to SharedMemory */
export const memorySetTool: ToolDefinition = {
  name: "memory_set",
  description: "Write a value to SharedMemory",
  parameters: {
    namespace: { type: "string", description: "Memory namespace",       required: true },
    key:       { type: "string", description: "Entry key",              required: true },
    value:     { type: "string", description: "Value to store",         required: true },
    ttlMs:     { type: "number", description: "TTL in ms (0=forever)",  required: false, default: 0 },
  },
  async execute({ namespace, key, value, ttlMs }, { memory }) {
    memory.set(String(namespace), String(key), String(value), ttlMs ? Number(ttlMs) : undefined);
    return { stored: true };
  },
};

/** memory:list — list all entries in a namespace */
export const memoryListTool: ToolDefinition = {
  name: "memory_list",
  description: "List all entries in a SharedMemory namespace",
  parameters: {
    namespace: { type: "string", description: "Memory namespace", required: true },
  },
  async execute({ namespace }, { memory }) {
    return memory.list(String(namespace));
  },
};

/** Register all built-in tools on a registry. */
export function registerBuiltins(registry: ToolRegistry): void {
  registry.register(memoryGetTool);
  registry.register(memorySetTool);
  registry.register(memoryListTool);
}
