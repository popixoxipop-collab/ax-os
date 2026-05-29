/**
 * AX OS - Usage Example
 * Demonstrates AX Runtime with Mock LLM adapter
 */

import {
  AXRuntime,
  MockLLMAdapter,
  createAXRuntime
} from "./ax-os-index.js";

async function basicExample() {
  console.log("=== AX OS Basic Example ===\n");

  // Create AX Runtime with mock LLM
  const ax = createAXRuntime("mock", { latencyMs: 50, failRate: 0.1 });

  // Execute some requests
  const prompts = [
    "What is machine learning?",
    "Explain the theory of relativity in detail",
    "Summarize: The quick brown fox jumps over the lazy dog",
    "Write a comprehensive essay on climate change",
    "What is 2+2?"
  ];

  for (const prompt of prompts) {
    try {
      const result = await ax.execute({
        prompt,
        maxTokens: 500,
        temperature: 0.7
      });

      console.log(`Prompt: ${prompt.slice(0, 40)}...`);
      console.log(`  Response: ${result.data.slice(0, 50)}...`);
      console.log(`  Capacity: ${result.capacityUsed}`);
      console.log(`  Gate: ${result.gateValue.toFixed(3)}`);
      console.log(`  Quality: ${result.performance.qualityScore.toFixed(2)}`);
      console.log(`  Latency: ${result.performance.latencyMs}ms`);
      console.log();
    } catch (error) {
      console.error(`Error for "${prompt.slice(0, 40)}...": ${error}`);
    }
  }

  // Print statistics
  const stats = ax.getStats();
  console.log("=== Statistics ===");
  console.log(`Total requests: ${stats.totalRequests}`);
  console.log(`Total tokens: ${stats.totalTokens}`);
  console.log(`Avg tokens/request: ${stats.avgTokensPerRequest.toFixed(1)}`);
  console.log(`Current capacity: ${stats.currentCapacity}`);
  console.log(`Resilience state: ${stats.resilienceState}`);
  console.log(`Error stats:`, stats.errorStats);
}

async function advancedExample() {
  console.log("\n=== AX OS Advanced Example ===\n");

  // Create custom-configured AX Runtime
  const ax = new AXRuntime({
    topK: {
      defaultLevel: 2,
      kValues: [1, 10, 50, 100, 200, 500]
    },
    entropy: {
      targetEntropy: 2.0,
      windowSize: 5
    },
    resilience: {
      rollbackStrategy: {
        maxRollbackSteps: 5,
        rollbackThreshold: 0.2
      }
    },
    monitoring: {
      sampleRate: 1.0,
      alertThresholds: [
        { metric: "latency", operator: "gt", value: 100, durationMs: 0 }
      ]
    }
  });

  // Use mock adapter with higher latency
  const mockAdapter = new MockLLMAdapter({ latencyMs: 200 });
  ax.setLLMClient(mockAdapter);

  // Execute with manual capacity override
  console.log("Executing with dynamic capacity...");
  
  for (let i = 0; i < 3; i++) {
    const result = await ax.execute({
      prompt: `Query ${i + 1}: Explain the concept ${i + 1}`,
      maxTokens: 200,
      temperature: 0.5 + i * 0.1
    });

    console.log(`Request ${i + 1}:`);
    console.log(`  Capacity used: ${result.capacityUsed}`);
    console.log(`  Gate value: ${result.gateValue.toFixed(3)}`);
    console.log(`  Resilience actions: ${result.resilienceActions.join(", ") || "none"}`);
  }

  // Force capacity level (emergency override)
  console.log("\nForcing capacity level to 1...");
  ax.forceCapacityLevel(1);

  const forcedResult = await ax.execute({
    prompt: "Forced low capacity query",
    maxTokens: 100
  });

  console.log(`Forced result capacity: ${forcedResult.capacityUsed}`);

  // Get final stats
  const finalStats = ax.getStats();
  console.log("\n=== Final Metrics ===");
  console.log(`Uptime: ${finalStats.uptimeMs}ms`);
  console.log(`Metrics window:`, finalStats.metricsWindow.aggregated);
}

async function resilienceExample() {
  console.log("\n=== AX OS Resilience Example ===\n");

  // Create runtime with high failure rate
  const ax = createAXRuntime("mock", { 
    latencyMs: 50, 
    failRate: 0.5  // 50% failure rate
  });

  console.log("Executing with high failure rate (50%)...");
  
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < 10; i++) {
    try {
      await ax.execute({
        prompt: `Resilience test ${i + 1}`,
        maxTokens: 100
      });
      successCount++;
      console.log(`  Request ${i + 1}: ✓ Success`);
    } catch (error) {
      failureCount++;
      console.log(`  Request ${i + 1}: ✗ Failed`);
    }
  }

  console.log(`\nResults: ${successCount} success, ${failureCount} failures`);
  
  const stats = ax.getStats();
  console.log(`Final resilience state: ${stats.resilienceState}`);
  console.log(`Error breakdown:`, stats.errorStats.byCategory);
}

// Run examples
async function main() {
  try {
    await basicExample();
    await advancedExample();
    await resilienceExample();
    
    console.log("\n=== All examples completed ===");
  } catch (error) {
    console.error("Example failed:", error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}