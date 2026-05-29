/**
 * AX OS - Ollama Adapter
 * LLMClient implementation for local Ollama inference server.
 * Supports capacity-aware model selection and system prompts.
 */

import { LLMClient, LLMRequest, LLMResponse, CapacityLevel } from "./ax-os-types.js";

export interface OllamaAdapterConfig {
  /** Ollama base URL. Default: http://localhost:11434 */
  readonly baseURL?: string;
  /** Primary model name (e.g. "qwen2.5-coder:32b"). */
  readonly model: string;
  /**
   * Optional per-capacity-level model overrides.
   * If omitted, all levels use `model` but with different generation params.
   */
  readonly capacityModelMap?: Partial<Record<CapacityLevel, string>>;
  /** Optional system prompt injected on every request. */
  readonly systemPrompt?: string;
}

// capacity level → generation parameters
const CAPACITY_PARAMS: Record<
  CapacityLevel,
  { temperature: number; num_predict: number }
> = {
  0: { temperature: 0.1, num_predict: 256 },
  1: { temperature: 0.3, num_predict: 512 },
  2: { temperature: 0.5, num_predict: 1024 },
  3: { temperature: 0.7, num_predict: 2048 },
  4: { temperature: 0.8, num_predict: 4096 },
  5: { temperature: 0.9, num_predict: 8192 },
};

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
  done_reason?: string;
}

interface OllamaTagsResponse {
  models: { name: string; size: number; modified_at: string }[];
}

export class OllamaAdapter implements LLMClient {
  private readonly baseURL: string;
  private readonly model: string;
  private readonly capacityModelMap: Partial<Record<CapacityLevel, string>>;
  private readonly systemPrompt?: string;

  constructor(config: OllamaAdapterConfig) {
    this.baseURL = config.baseURL ?? "http://localhost:11434";
    this.model = config.model;
    this.capacityModelMap = config.capacityModelMap ?? {};
    this.systemPrompt = config.systemPrompt;
  }

  private selectModel(level: CapacityLevel): string {
    return this.capacityModelMap[level] ?? this.model;
  }

  // ── Core generation ────────────────────────────────────────────────────────

  async generate(request: LLMRequest, capacityLevel: CapacityLevel): Promise<LLMResponse> {
    const model = this.selectModel(capacityLevel);
    const params = CAPACITY_PARAMS[capacityLevel];

    // Use provided messages (ReAct multi-turn) or build single-turn from prompt
    const messages: OllamaMessage[] = request.messages
      ? request.messages.map(m => ({ role: m.role, content: m.content }))
      : (() => {
          const msgs: OllamaMessage[] = [];
          if (this.systemPrompt) msgs.push({ role: "system", content: this.systemPrompt });
          msgs.push({ role: "user", content: request.prompt });
          return msgs;
        })();

    const body = {
      model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature ?? params.temperature,
        num_predict: request.maxTokens ?? params.num_predict,
        top_p: request.topP ?? 0.9,
      },
    };

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    return {
      text: data.message.content,
      tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
      finishReason: data.done_reason ?? "stop",
    };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  async *stream(
    request: LLMRequest,
    capacityLevel: CapacityLevel
  ): AsyncIterable<LLMResponse> {
    const model = this.selectModel(capacityLevel);
    const params = CAPACITY_PARAMS[capacityLevel];

    const messages: OllamaMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });

    const body = {
      model,
      messages,
      stream: true,
      options: {
        temperature: request.temperature ?? params.temperature,
        num_predict: request.maxTokens ?? params.num_predict,
      },
    };

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama stream error ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const chunk = JSON.parse(line) as OllamaChatResponse;
            yield {
              text: chunk.message?.content ?? "",
              tokensUsed: chunk.eval_count ?? 0,
              finishReason: chunk.done ? (chunk.done_reason ?? "stop") : "",
            };
            if (chunk.done) return;
          } catch {
            // skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  getTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Returns true if the Ollama server is reachable. */
  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseURL}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Lists all models currently pulled in Ollama. */
  async listModels(): Promise<string[]> {
    const r = await fetch(`${this.baseURL}/api/tags`);
    if (!r.ok) return [];
    const data = (await r.json()) as OllamaTagsResponse;
    return data.models.map(m => m.name);
  }
}
