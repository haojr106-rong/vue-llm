import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  createCumulativeSnapshots,
  createSseFixture,
} from "./fixtures.mjs";
import { BenchmarkIncrementalSseParser } from "./incremental-parser.mjs";
import { LegacyCumulativeSseParser } from "./legacy-parser.mjs";

const EVENT_COUNT = 10_000;
const SPLIT_OPTIONS = {
  seed: 20_261_008,
  minChunkSize: 512,
  maxChunkSize: 4_096,
};

function compareUniqueEvents(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expectedSet.has(value));

  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    missingCount: missing.length,
    unexpectedCount: unexpected.length,
    duplicateCount: actual.length - actualSet.size,
    exactOrderMatch:
      expected.length === actual.length &&
      expected.every((value, index) => value === actual[index]),
  };
}

function runParser(ParserClass, snapshots) {
  const parser = new ParserClass();
  let callbackFailures = 0;
  const startedAt = performance.now();

  for (const cumulativeResponse of snapshots) {
    try {
      parser.push(cumulativeResponse);
    } catch {
      // Continue to measure correctness across the complete deterministic
      // stream even when the legacy progress callback encounters a fragment.
      callbackFailures += 1;
    }
  }

  return {
    parser,
    callbackFailures,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

function createResult({ name, fixture, snapshots, run }) {
  const content = compareUniqueEvents(
    fixture.expectedContent,
    run.parser.content,
  );
  const reasoning = compareUniqueEvents(
    fixture.expectedReasoning,
    run.parser.reasoning,
  );

  return {
    benchmark: name,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
    },
    fixture: {
      eventCount: fixture.eventCount,
      responseCharacters: fixture.stream.length,
      responseBytes: Buffer.byteLength(fixture.stream, "utf8"),
      cumulativeCallbackCount: snapshots.length,
      splitOptions: SPLIT_OPTIONS,
    },
    correctness: {
      content,
      reasoning,
      doneCount: run.parser.doneCount,
      callbackFailures: run.callbackFailures,
      parseErrors: run.parser.metrics.parseErrors,
      zeroDuplicateAndLoss:
        content.missingCount === 0 &&
        content.unexpectedCount === 0 &&
        content.duplicateCount === 0 &&
        reasoning.missingCount === 0 &&
        reasoning.unexpectedCount === 0 &&
        reasoning.duplicateCount === 0,
    },
    performance: {
      jsonParseCalls: run.parser.metrics.jsonParseCalls,
      scannedDataLines: run.parser.metrics.scannedDataLines ?? null,
      parsedEvents: run.parser.metrics.parsedEvents ?? null,
      durationMs: run.durationMs,
    },
  };
}

function percentageReduction(before, after) {
  return Number((((before - after) / before) * 100).toFixed(2));
}

async function main() {
  const fixture = createSseFixture(EVENT_COUNT);
  const snapshots = createCumulativeSnapshots(fixture.stream, SPLIT_OPTIONS);
  const baseline = createResult({
    name: "legacy-cumulative-sse-parser",
    fixture,
    snapshots,
    run: runParser(LegacyCumulativeSseParser, snapshots),
  });
  const optimizedRun = runParser(BenchmarkIncrementalSseParser, snapshots);
  const optimized = createResult({
    name: "incremental-buffered-sse-parser",
    fixture,
    snapshots,
    run: optimizedRun,
  });
  optimized.correctness.pendingFragmentLength =
    optimizedRun.parser.pendingFragmentLength;

  assert.equal(optimized.correctness.callbackFailures, 0);
  assert.equal(optimized.correctness.parseErrors, 0);
  assert.equal(optimized.correctness.zeroDuplicateAndLoss, true);
  assert.equal(optimized.correctness.content.exactOrderMatch, true);
  assert.equal(optimized.correctness.reasoning.exactOrderMatch, true);
  assert.equal(optimized.correctness.doneCount, 1);
  assert.equal(optimized.correctness.pendingFragmentLength, 0);
  assert.equal(optimized.performance.jsonParseCalls, fixture.eventCount);

  const comparison = {
    benchmark: "sse-parser-comparison",
    generatedAt: new Date().toISOString(),
    fixture: optimized.fixture,
    before: {
      callbackFailures: baseline.correctness.callbackFailures,
      parseErrors: baseline.correctness.parseErrors,
      jsonParseCalls: baseline.performance.jsonParseCalls,
      durationMs: baseline.performance.durationMs,
    },
    after: {
      callbackFailures: optimized.correctness.callbackFailures,
      parseErrors: optimized.correctness.parseErrors,
      jsonParseCalls: optimized.performance.jsonParseCalls,
      durationMs: optimized.performance.durationMs,
    },
    improvement: {
      jsonParseCallsReducedBy:
        baseline.performance.jsonParseCalls -
        optimized.performance.jsonParseCalls,
      jsonParseCallsReductionPercent: percentageReduction(
        baseline.performance.jsonParseCalls,
        optimized.performance.jsonParseCalls,
      ),
      durationReductionPercent: percentageReduction(
        baseline.performance.durationMs,
        optimized.performance.durationMs,
      ),
    },
  };

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  await mkdir(resultDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      `${resultDirectory}/baseline.json`,
      `${JSON.stringify(baseline, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      `${resultDirectory}/optimized.json`,
      `${JSON.stringify(optimized, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      `${resultDirectory}/comparison.json`,
      `${JSON.stringify(comparison, null, 2)}\n`,
      "utf8",
    ),
  ]);

  console.log("SSE parser comparison completed");
  console.table({
    legacy: comparison.before,
    incremental: comparison.after,
  });
  console.log(
    `JSON.parse calls reduced by ${comparison.improvement.jsonParseCallsReductionPercent}%`,
  );
  console.log(`Results written to ${resultDirectory}`);
}

await main();
