# AX OS

Hierarchical Adaptive Dimensionality Expansion (AX) Operating System for LLM reliability.

## Overview

AX OS is a reliability layer for LLM/agent systems that improves reliability and reduces cost without changing base model weights. It controls effective capacity through adaptive mechanisms.

## Architecture

```
┌─────────────────────────────────────────┐
│  Layer 4: Monitor (Telemetry, Alerts)  │
├─────────────────────────────────────────┤
│  Layer 3: Resilience Manager           │
│  (Rollback, Degradation, Recovery)     │
├─────────────────────────────────────────┤
│  Layer 2: Gate Manager                 │
│  (compute_g(), Routing Decisions)      │
├─────────────────────────────────────────┤
│  Layer 1: Capacity Controllers         │
│  (Top-K, Entropy)                      │
├─────────────────────────────────────────┤
│  Layer 0: Core Types & Interfaces      │
└─────────────────────────────────────────┘
```

## Installation

```bash
npm install
npm run build
```

## Usage

### Basic Usage

```typescript
import { createAXRuntime } from "./ax-os-index.js";

const ax = createAXRuntime("openai", {
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4"
});

const result = await ax.execute({
  prompt: "Explain quantum computing",
  maxTokens: 500,
  temperature: 0.7
});

console.log(result.data);
console.log(`Capacity used: ${result.capacityUsed}`);
console.log(`Gate value: ${result.gateValue}`);
```

### With Mock LLM (Testing)

```typescript
import { createAXRuntime } from "./ax-os-index.js";

const ax = createAXRuntime("mock", {
  latencyMs: 100,
  failRate: 0.1
});

// Use for testing...
```

### Custom Configuration

```typescript
import { AXRuntime } from "./ax-os-index.js";

const ax = new AXRuntime({
  topK: {
    defaultLevel: 3,
    kValues: [1, 5, 20, 50, 100, 500]
  },
  entropy: {
    targetEntropy: 2.5,
    windowSize: 10
  },
  resilience: {
    rollbackStrategy: {
      maxRollbackSteps: 3,
      rollbackThreshold: 0.3
    }
  },
  monitoring: {
    enabled: true,
    sampleRate: 1.0
  }
});
```

## Components

### Layer 0: Core Types (`ax-os-types.ts`)
- Token and embedding types
- Capacity control interfaces
- Gate and routing types
- Error types

### Layer 1: Capacity Controllers
- **TopK Controller** (`ax-os-topk-controller.ts`): Controls capacity via Top-K sampling
- **Entropy Controller** (`ax-os-entropy-controller.ts`): Adapts based on output entropy

### Layer 2: Gate Manager (`ax-os-gate-manager.ts`)
- `compute_g()`: Core gate computation
- Routing decisions based on task complexity, history, and load

### Layer 3: Resilience Manager (`ax-os-resilience-manager.ts`)
- Checkpoint creation and rollback
- Automatic degradation on failure
- Recovery detection

### Layer 4: Monitor (`ax-os-monitor.ts`)
- Telemetry event recording
- Performance metrics aggregation
- Alert threshold monitoring

### AX Runtime (`ax-os-runtime.ts`)
- Main orchestrator integrating all layers
- Request execution with automatic capacity management
- Statistics and state management

### LLM Adapters (`ax-os-llm-adapter.ts`)
- OpenAI adapter with capacity-aware model selection
- Mock adapter for testing

## Running Examples

```bash
npm run build
node ax-os-dist/ax-os-example.js
```

## Testing

Tests run on node's built-in test runner — **zero external dependencies**.
The specs import the compiled `ax-os-dist/`, so build first:

```bash
npm run build                       # tsc -> ax-os-dist/
node --test ax-os-tests/*.test.mjs  # 27 specs, no install needed
node ax-os-verify-build.mjs         # standalone end-to-end smoke check
```

27 specs across parser, agent registry, BRAIN loop, and adaptive router.

> Note: this project's manifest is `ax-os-package.json` (it lives flat in a
> shared home directory), so `npm test` / `npm run verify` only resolve when
> npm reads it as `package.json`. The `node --test` and `node` commands above
> always work and are the canonical entry points.

## API Reference

### AXRuntime

```typescript
class AXRuntime {
  constructor(config?: Partial<AXConfig>);
  setLLMClient(client: LLMClient): void;
  execute<T>(request: LLMRequest): Promise<AXOutput<T>>;
  getState(): AXState;
  getStats(): RuntimeStats;
  forceCapacityLevel(level: CapacityLevel): void;
  reset(): void;
}
```

### Types

```typescript
interface AXOutput<T> {
  data: T;
  capacityUsed: CapacityLevel;  // 0-5
  gateValue: number;            // 0.0-1.0
  performance: PerformanceSnapshot;
  resilienceActions: string[];
}
```

## License

MIT