import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  createCumulativeSnapshots,
  createSseFixture,
} from "./fixtures.mjs";
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
  const duplicateCount = actual.length - actualSet.size;
  const exactOrderMatch =
    expected.length === actual.length &&
    expected.every((value, index) => value === actual[index]);

  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    missingCount: missing.length,
    unexpectedCount: unexpected.length,
    duplicateCount,
    exactOrderMatch,
  };
}

async function main() {
  const fixture = createSseFixture(EVENT_COUNT);
  const snapshots = createCumulativeSnapshots(fixture.stream, SPLIT_OPTIONS);
  const parser = new LegacyCumulativeSseParser();
  let callbackFailures = 0;

  const startedAt = performance.now();
  for (const cumulativeResponse of snapshots) {
    try {
      parser.push(cumulativeResponse);
    } catch {
      // The current production parser rethrows incomplete JSON. The benchmark
      // records that failure, then continues with the next cumulative snapshot
      // so correctness can still be evaluated over the complete response.
      callbackFailures += 1;
    }
  }
  const durationMs = performance.now() - startedAt;

  const content = compareUniqueEvents(
    fixture.expectedContent,
    parser.content,
  );
  const reasoning = compareUniqueEvents(
    fixture.expectedReasoning,
    parser.reasoning,
  );

  const result = {
    benchmark: "legacy-cumulative-sse-parser",
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
      doneCount: parser.doneCount,
      callbackFailures,
      parseErrors: parser.metrics.parseErrors,
      zeroDuplicateAndLoss:
        content.missingCount === 0 &&
        content.unexpectedCount === 0 &&
        content.duplicateCount === 0 &&
        reasoning.missingCount === 0 &&
        reasoning.unexpectedCount === 0 &&
        reasoning.duplicateCount === 0,
    },
    performance: {
      jsonParseCalls: parser.metrics.jsonParseCalls,
      scannedDataLines: parser.metrics.scannedDataLines,
      durationMs: Number(durationMs.toFixed(2)),
    },
  };

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  const resultPath = `${resultDirectory}/baseline.json`;
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("SSE baseline benchmark completed");
  console.table({
    events: result.fixture.eventCount,
    callbacks: result.fixture.cumulativeCallbackCount,
    missing:
      result.correctness.content.missingCount +
      result.correctness.reasoning.missingCount,
    duplicates:
      result.correctness.content.duplicateCount +
      result.correctness.reasoning.duplicateCount,
    parseErrors: result.correctness.parseErrors,
    jsonParseCalls: result.performance.jsonParseCalls,
    durationMs: result.performance.durationMs,
  });
  console.log(`Result written to ${resultPath}`);
}

await main();
