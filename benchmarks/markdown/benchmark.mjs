import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { MessageMarkdownRenderCache } from "../../src/utils/markdownRenderer.js";
import { createMarkdownRenderFixture } from "./fixtures.mjs";
import { LegacyMarkdownRenderer } from "./legacy-renderer.mjs";

function digestHtml(outputs) {
  return createHash("sha256").update(outputs.join("\n")).digest("hex");
}

function runBenchmark(fixture, renderer) {
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
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    },
    outputDigest: digestHtml(finalOutputs),
    finalStreamingCharacters: messages.at(-1).content.length,
    cacheSize: renderer.size ?? null,
  };
}

function percentageReduction(before, after) {
  return Number((((before - after) / before) * 100).toFixed(2));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function verifyCacheLifecycle() {
  const cache = new MessageMarkdownRenderCache();
  const first = cache.render("message-1", "**相同内容**");
  const second = cache.render("message-1", "**相同内容**");
  assert.equal(first, second);
  assert.equal(cache.metrics.markdownParseCalls, 1);
  assert.equal(cache.metrics.cacheHits, 1);

  cache.render("message-1", "**更新内容**");
  assert.equal(cache.size, 1);
  assert.equal(cache.metrics.markdownParseCalls, 2);

  cache.render("message-2", "另一条消息");
  cache.prune(["message-2"]);
  assert.equal(cache.size, 1);
  cache.clear();
  assert.equal(cache.size, 0);

  const limitedCache = new MessageMarkdownRenderCache({ maxEntries: 2 });
  limitedCache.render("message-1", "一");
  limitedCache.render("message-2", "二");
  limitedCache.render("message-3", "三");
  assert.equal(limitedCache.size, 2);
  assert.equal(limitedCache.metrics.evictions, 1);
}

async function main() {
  verifyCacheLifecycle();
  const fixture = createMarkdownRenderFixture();
  const baseline = runBenchmark(fixture, new LegacyMarkdownRenderer());
  baseline.metrics.unchangedHistoricalParseCalls =
    (fixture.visibleMessageCount - 1) * fixture.streamingUpdateCount;
  baseline.metrics.changingMessageParseCalls = fixture.streamingUpdateCount;

  const optimized = runBenchmark(
    fixture,
    new MessageMarkdownRenderCache(),
  );
  const expectedBaselineCalls =
    fixture.visibleMessageCount * fixture.streamingUpdateCount;
  const expectedOptimizedCalls =
    fixture.visibleMessageCount + fixture.streamingUpdateCount - 1;

  assert.equal(baseline.metrics.markdownParseCalls, expectedBaselineCalls);
  assert.equal(optimized.metrics.markdownParseCalls, expectedOptimizedCalls);
  assert.equal(
    optimized.metrics.cacheHits,
    expectedBaselineCalls - expectedOptimizedCalls,
  );
  assert.equal(optimized.cacheSize, fixture.visibleMessageCount);
  assert.equal(optimized.outputDigest, baseline.outputDigest);

  const environment = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
  };
  const fixtureSummary = {
    visibleMessageCount: fixture.visibleMessageCount,
    unchangedHistoricalMessageCount: fixture.visibleMessageCount - 1,
    streamingUpdateCount: fixture.streamingUpdateCount,
    content: "Markdown headings, lists, tables, and JavaScript blocks",
  };
  const generatedAt = new Date().toISOString();
  const notes = {
    networkRequestsSent: 0,
    timingIsAuxiliary: true,
    primaryMetrics: ["markdownParseCalls", "parsedCharacters"],
  };
  const baselineResult = {
    benchmark: "legacy-markdown-rendering",
    generatedAt,
    environment,
    fixture: fixtureSummary,
    baseline,
    notes,
  };
  const optimizedResult = {
    benchmark: "message-keyed-markdown-cache",
    generatedAt,
    environment,
    fixture: fixtureSummary,
    optimized,
    notes,
  };
  const comparison = {
    benchmark: "markdown-rendering-comparison",
    generatedAt,
    fixture: fixtureSummary,
    before: {
      markdownParseCalls: baseline.metrics.markdownParseCalls,
      parsedCharacters: baseline.metrics.parsedCharacters,
      durationMs: baseline.metrics.durationMs,
    },
    after: {
      markdownParseCalls: optimized.metrics.markdownParseCalls,
      parsedCharacters: optimized.metrics.parsedCharacters,
      cacheHits: optimized.metrics.cacheHits,
      cacheEntries: optimized.cacheSize,
      durationMs: optimized.metrics.durationMs,
      identicalFinalHtml: optimized.outputDigest === baseline.outputDigest,
    },
    improvement: {
      markdownParseCallsReductionPercent: percentageReduction(
        baseline.metrics.markdownParseCalls,
        optimized.metrics.markdownParseCalls,
      ),
      parsedCharactersReductionPercent: percentageReduction(
        baseline.metrics.parsedCharacters,
        optimized.metrics.parsedCharacters,
      ),
      durationReductionPercent: percentageReduction(
        baseline.metrics.durationMs,
        optimized.metrics.durationMs,
      ),
    },
  };

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  await mkdir(resultDirectory, { recursive: true });
  await Promise.all([
    writeJson(`${resultDirectory}/baseline.json`, baselineResult),
    writeJson(`${resultDirectory}/optimized.json`, optimizedResult),
    writeJson(`${resultDirectory}/comparison.json`, comparison),
  ]);

  console.log("Markdown rendering comparison completed");
  console.table({
    uncached: comparison.before,
    cached: comparison.after,
  });
  console.table(comparison.improvement);
  console.log(`Results written to ${resultDirectory}`);
}

await main();
