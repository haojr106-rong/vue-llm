import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createConversationFixture } from "./fixtures.mjs";
import { selectLegacyContext } from "./legacy-context.mjs";
import { measureRequest } from "./metrics.mjs";

const ROUND_COUNT = 120;
const CHECKPOINTS = new Set([10, 25, 50, 100, 120]);

function runLegacyBenchmark(fixture) {
  const growth = [];
  let cumulativeRequestBytes = 0;
  let cumulativeEstimatedTokens = 0;

  for (let round = 1; round <= fixture.roundCount; round += 1) {
    // A real request is sent after the user message and before that round's
    // assistant response exists, so the active history has an odd length.
    const activeMessages = fixture.messages.slice(0, round * 2 - 1);
    const selected = selectLegacyContext(activeMessages);
    const measurement = measureRequest(selected);

    cumulativeRequestBytes += measurement.requestBytes;
    cumulativeEstimatedTokens += measurement.estimatedTokens;

    if (CHECKPOINTS.has(round)) {
      growth.push({ round, ...measurement });
    }
  }

  const finalInput = fixture.messages.slice(0, fixture.messages.length - 1);
  const finalContext = selectLegacyContext(finalInput);
  const finalRequest = measureRequest(finalContext);

  return {
    policy: "full-history-without-budget",
    finalRequest,
    cumulativeAcrossRounds: {
      requestCount: fixture.roundCount,
      requestBytes: cumulativeRequestBytes,
      estimatedTokens: cumulativeEstimatedTokens,
    },
    growth,
    retained: {
      messageCount: finalContext.length,
      messageRatio: 1,
      containsFirstMessage: finalContext[0]?.content.includes("turn-1-user"),
      containsLatestMessage: finalContext.at(-1)?.content.includes(
        `turn-${fixture.roundCount}-user`,
      ),
    },
  };
}

async function main() {
  const fixture = createConversationFixture(ROUND_COUNT);
  const baseline = runLegacyBenchmark(fixture);

  assert.equal(fixture.messages.length, ROUND_COUNT * 2);
  assert.equal(baseline.finalRequest.messageCount, ROUND_COUNT * 2 - 1);
  assert.equal(baseline.retained.containsFirstMessage, true);
  assert.equal(baseline.retained.containsLatestMessage, true);

  const result = {
    benchmark: "legacy-full-history-context",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
    },
    fixture: {
      roundCount: fixture.roundCount,
      totalMessageCount: fixture.messages.length,
      content: "deterministic mixed Chinese and ASCII conversation",
    },
    baseline,
    notes: {
      networkRequestsSent: 0,
      tokenMetric: "deterministic estimate, not provider billing tokens",
    },
  };

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  const resultPath = `${resultDirectory}/baseline.json`;
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("Context baseline benchmark completed");
  console.table({
    rounds: fixture.roundCount,
    finalMessages: baseline.finalRequest.messageCount,
    finalRequestBytes: baseline.finalRequest.requestBytes,
    finalEstimatedTokens: baseline.finalRequest.estimatedTokens,
    cumulativeRequestBytes:
      baseline.cumulativeAcrossRounds.requestBytes,
    cumulativeEstimatedTokens:
      baseline.cumulativeAcrossRounds.estimatedTokens,
  });
  console.log(`Result written to ${resultPath}`);
}

await main();
