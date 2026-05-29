/**
 * AX OS - LLM Adapter
 * Adapters for popular LLM providers
 */

import {
  LLMClient,
  LLMRequest,
  LLMResponse,
  CapacityLevel,
  Logits,
  AttentionWeights
} from "./ax-os-types.js";

/**
 * Configuration for OpenAI adapter
 */
export interface OpenAIAdapterConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  defaultMaxTokens: number;
  defaultTemperature: number;
}

/**
 * Capacity to model parameter mapping
 */
const CAPACITY_MODEL_MAP: Record<CapacityLevel, string> = {
  0: "gpt-3.5-turbo",     // Minimal capacity - cheapest
  1: "gpt-3.5-turbo",
  2: "gpt-3.5-turbo-16k",
  3: "gpt-4",             // Default
  4: "gpt-4",
  5: "gpt-4-turbo"        // Maximum capacity
};

/**
 * OpenAI API adapter
 */
export class OpenAIAdapter implements LLMClient {
  private config: OpenAIAdapterConfig;

  constructor(config: OpenAIAdapterConfig) {
    this.config = {
      baseURL: "https://api.openai.com/v1",
      defaultMaxTokens: 1024,
      defaultTemperature: 0.7,
      ...config
    };
  }

  /**
   * Generate completion with capacity-aware model selection
   */
  async generate(
    request: LLMRequest,
    capacityLevel: CapacityLevel
  ): Promise<LLMResponse> {
    const model = this.selectModel(capacityLevel);
    
    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.maxTokens ?? this.config.defaultMaxTokens,
        temperature: request.temperature ?? this.config.defaultTemperature,
        top_p: request.topP ?? 1.0,
        // Logprobs for entropy calculation
        logprobs: true,
        top_logprobs: 5
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    // Extract logits if available
    let logits: Logits | undefined;
    if (choice.logprobs?.content) {
      logits = new Float32Array(
        choice.logprobs.content.map((c: { logprob: number }) => c.logprob)
      );
    }

    return {
      text: choice.message.content,
      tokensUsed: data.usage?.total_tokens ?? 0,
      finishReason: choice.finish_reason,
      logits
    };
  }

  /**
   * Stream completion (if supported by provider)
   */
  async *stream(
    request: LLMRequest,
    capacityLevel: CapacityLevel
  ): AsyncIterable<LLMResponse> {
    const model = this.selectModel(capacityLevel);
    
    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.maxTokens ?? this.config.defaultMaxTokens,
        temperature: request.temperature ?? this.config.defaultTemperature,
        top_p: request.topP ?? 1.0,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            
            yield {
              text: delta,
              tokensUsed: 1, // Approximate
              finishReason: parsed.choices?.[0]?.finish_reason ?? ""
            };
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Select model based on capacity level
   */
  private selectModel(capacityLevel: CapacityLevel): string {
    // Allow override in config
    if (this.config.model) {
      return this.config.model;
    }
    return CAPACITY_MODEL_MAP[capacityLevel];
  }

  /**
   * Get token count (approximation)
   */
  getTokenCount(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }
}

/**
 * Mock LLM adapter for testing
 */
export class MockLLMAdapter implements LLMClient {
  private latencyMs: number;
  private failRate: number;

  constructor(options: { latencyMs?: number; failRate?: number } = {}) {
    this.latencyMs = options.latencyMs ?? 100;
    this.failRate = options.failRate ?? 0;
  }

  async generate(
    request: LLMRequest,
    _capacityLevel: CapacityLevel
  ): Promise<LLMResponse> {
    // Simulate latency
    await new Promise(r => setTimeout(r, this.latencyMs));

    // Simulate failures
    if (Math.random() < this.failRate) {
      throw new Error("Simulated LLM failure");
    }

    const words = request.prompt.split(" ");
    const response = `Response to: ${words.slice(0, 5).join(" ")}...`;
    
    return {
      text: response,
      tokensUsed: this.getTokenCount(request.prompt) + this.getTokenCount(response),
      finishReason: "stop",
      logits: new Float32Array([0.1, 0.2, 0.3, 0.2, 0.2])
    };
  }

  getTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Adapter factory — supports openai | ollama | anthropic | mock
 */
export function createLLMAdapter(
  provider: "openai" | "ollama" | "anthropic" | "mock",
  config: Record<string, unknown>
): LLMClient {
  switch (provider) {
    case "openai":
      return new OpenAIAdapter(config as OpenAIAdapterConfig);
    case "mock":
      return new MockLLMAdapter(config as { latencyMs?: number; failRate?: number });
    // Dynamic imports to avoid hard dep when provider is unused
    case "ollama": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { OllamaAdapter } = require("./ax-os-ollama-adapter.js");
      return new OllamaAdapter(config) as LLMClient;
    }
    case "anthropic": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AnthropicAdapter } = require("./ax-os-anthropic-adapter.js");
      return new AnthropicAdapter(config) as LLMClient;
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}