/**
 * AX OS - Anthropic Adapter
 * LLMClient implementation for Claude API.
 * Capacity levels map to haiku / sonnet / opus tiers.
 */

import { LLMClient, LLMRequest, LLMResponse, CapacityLevel } from "./ax-os-types.js";

export interface AnthropicAdapterConfig {
  readonly apiKey: string;
  /** Override the capacity-based model selection with a fixed model. */
  readonly model?: string;
  readonly baseURL?: string;
  readonly systemPrompt?: string;
}

// capacity level → Claude model
// 0-2: haiku (fast, cheap), 3-4: sonnet (balanced), 5: opus (best)
const CAPACITY_MODEL_MAP: Record<CapacityLevel, string> = {
  0: "claude-haiku-4-5-20251001",
  1: "claude-haiku-4-5-20251001",
  2: "claude-haiku-4-5-20251001",
  3: "claude-sonnet-4-6",
  4: "claude-sonnet-4-6",
  5: "claude-opus-4-8",
};

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponseBody {
  content: { type: string; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  index?: number;
  usage?: { output_tokens: number };
}

export class AnthropicAdapter implements LLMClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly modelOverride?: string;
  private readonly systemPrompt?: string;

  constructor(config: AnthropicAdapterConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL ?? "https://api.anthropic.com";
    this.modelOverride = config.model;
    this.systemPrompt = config.systemPrompt;
  }

  private selectModel(level: CapacityLevel): string {
    return this.modelOverride ?? CAPACITY_MODEL_MAP[level];
  }

  private get headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
  }

  // ── Core generation ────────────────────────────────────────────────────────

  async generate(request: LLMRequest, capacityLevel: CapacityLevel): Promise<LLMResponse> {
    const model = this.selectModel(capacityLevel);
    const messages: AnthropicMessage[] = [
      { role: "user", content: request.prompt },
    ];

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      messages,
    };

    if (this.systemPrompt) {
      body.system = this.systemPrompt;
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as AnthropicResponseBody;
    const text = data.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("");

    return {
      text,
      tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
      finishReason: data.stop_reason ?? "stop",
    };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  async *stream(
    request: LLMRequest,
    capacityLevel: CapacityLevel
  ): AsyncIterable<LLMResponse> {
    const model = this.selectModel(capacityLevel);
    const messages: AnthropicMessage[] = [
      { role: "user", content: request.prompt },
    ];

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      messages,
      stream: true,
    };

    if (this.systemPrompt) {
      body.system = this.systemPrompt;
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Anthropic stream error ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const event = JSON.parse(payload) as AnthropicStreamEvent;

            if (
              event.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              event.delta.text
            ) {
              yield {
                text: event.delta.text,
                tokensUsed: event.usage?.output_tokens ?? 0,
                finishReason: "",
              };
            } else if (event.type === "message_stop") {
              return;
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  getTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
