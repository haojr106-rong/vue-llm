import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { createMarkdownRenderFixture } from "./fixtures.mjs";
import { LegacyMarkdownRenderer } from "./legacy-renderer.mjs";

function digestHtml(outputs) {
  return createHash("sha256").update(outputs.join("\n")).digest("hex");
}

function runLegacyBenchmark(fixture) {
  const renderer = new LegacyMarkdownRenderer();
  const messages = fixture.messages.map((message) => ({ ...message }));
  let finalOutputs = [];
  const startedAt = performance.now();

  for (const chunk of fixture.streamingChunks) {
    messages.at(-1).content += chunk;
    finalOutputs = messages.map((message) =>
      renderer.render(message.id, message.content),
    );
  }

  return {
    metrics: {
      ...renderer.metrics,
      unchangedHistoricalParseCalls:
        (fixture.visibleMessageCount - 1) * fixture.streamingUpdateCount,
      changingMessageParseCalls: fixture.streamingUpdateCount,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    },
    outputDigest: digestHtml(finalOutputs),
    finalStreamingCharacters: messages.at(-1).content.length,
  };
}

async function main() {
  const fixture = createMarkdownRenderFixture();
  const baseline = runLegacyBenchmark(fixture);
  const expectedCalls =
    fixture.visibleMessageCount * fixture.streamingUpdateCount;

  assert.equal(baseline.metrics.markdownParseCalls, expectedCalls);
  assert.equal(
    baseline.metrics.unchangedHistoricalParseCalls +
      baseline.metrics.changingMessageParseCalls,
    expectedCalls,
  );
  assert.equal(baseline.outputDigest.length, 64);

  const result = {
    benchmark: "legacy-markdown-rendering",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
    },
    fixture: {
      visibleMessageCount: fixture.visibleMessageCount,
      unchangedHistoricalMessageCount: fixture.visibleMessageCount - 1,
      streamingUpdateCount: fixture.streamingUpdateCount,
      content: "Markdown headings, lists, tables, and JavaScript blocks",
    },
    baseline,
    notes: {
      networkRequestsSent: 0,
      timingIsAuxiliary: true,
      primaryMetrics: [
        "markdownParseCalls",
        "parsedCharacters",
      ],
    },
  };

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  const resultPath = `${resultDirectory}/baseline.json`;
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("Markdown baseline benchmark completed");
  console.table({
    visibleMessages: fixture.visibleMessageCount,
    streamingUpdates: fixture.streamingUpdateCount,
    markdownParseCalls: baseline.metrics.markdownParseCalls,
    unchangedHistoricalParseCalls:
      baseline.metrics.unchangedHistoricalParseCalls,
    parsedCharacters: baseline.metrics.parsedCharacters,
    durationMs: baseline.metrics.durationMs,
  });
  console.log(`Result written to ${resultPath}`);
}

await main();
