import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { build } from "vite";

function collectOutputs(buildResult) {
  const results = Array.isArray(buildResult) ? buildResult : [buildResult];
  return results.flatMap((result) => result.output ?? []);
}

function collectInitialChunks(chunks) {
  const chunkByName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const initialNames = new Set();
  const queue = chunks
    .filter((chunk) => chunk.isEntry)
    .map((chunk) => chunk.fileName);

  while (queue.length) {
    const fileName = queue.shift();
    if (initialNames.has(fileName)) continue;
    initialNames.add(fileName);

    const chunk = chunkByName.get(fileName);
    for (const importedName of chunk?.imports ?? []) queue.push(importedName);
  }

  return chunks.filter((chunk) => initialNames.has(chunk.fileName));
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function assetByteLength(asset) {
  if (!asset) return 0;
  return typeof asset.source === "string"
    ? byteLength(asset.source)
    : asset.source.byteLength;
}

function summarizeChunks(chunks) {
  const modules = new Set(
    chunks.flatMap((chunk) => Object.keys(chunk.modules)),
  );

  return {
    chunkCount: chunks.length,
    moduleCount: modules.size,
    javascriptBytes: chunks.reduce(
      (total, chunk) => total + byteLength(chunk.code),
      0,
    ),
    javascriptGzipBytes: chunks.reduce(
      (total, chunk) => total + gzipSync(chunk.code).byteLength,
      0,
    ),
    includesJsZip: [...modules].some((id) =>
      id.includes("node_modules/jszip"),
    ),
    includesPdfJs: [...modules].some((id) =>
      id.includes("node_modules/pdfjs-dist"),
    ),
  };
}

async function runBuildAnalysis() {
  const startedAt = performance.now();
  const result = await build({
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = collectOutputs(result);
  const chunks = outputs.filter((output) => output.type === "chunk");
  const assets = outputs.filter((output) => output.type === "asset");
  const initialChunks = collectInitialChunks(chunks);
  const initialNames = new Set(initialChunks.map((chunk) => chunk.fileName));
  const lazyChunks = chunks.filter(
    (chunk) => !initialNames.has(chunk.fileName),
  );
  const pdfWorkerAsset = assets.find((asset) =>
    asset.fileName.includes("pdf.worker"),
  );
  const docxWorkerAsset = assets.find((asset) =>
    asset.fileName.includes("docxParser.worker"),
  );

  return {
    initial: summarizeChunks(initialChunks),
    lazy: summarizeChunks(lazyChunks),
    output: {
      javascriptChunkCount: chunks.length,
      assetCount: assets.length,
      pdfWorkerAssetBytes: assetByteLength(pdfWorkerAsset),
      docxWorkerAssetBytes: assetByteLength(docxWorkerAsset),
    },
    buildDurationMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

function percentageReduction(before, after) {
  return Number((((before - after) / before) * 100).toFixed(2));
}

async function main() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  const baselinePath = `${resultDirectory}/baseline.json`;
  const baselineResult = JSON.parse(await readFile(baselinePath, "utf8"));
  const baseline = baselineResult.baseline;
  const optimized = await runBuildAnalysis();

  assert.equal(baseline.initial.includesJsZip, true);
  assert.equal(baseline.initial.includesPdfJs, true);
  assert.equal(optimized.initial.includesJsZip, false);
  assert.equal(optimized.initial.includesPdfJs, false);
  assert.ok(optimized.lazy.chunkCount >= 2);
  assert.ok(optimized.lazy.includesPdfJs);
  assert.ok(optimized.output.docxWorkerAssetBytes > 0);
  assert.ok(
    optimized.initial.javascriptBytes < baseline.initial.javascriptBytes,
  );

  const generatedAt = new Date().toISOString();
  const environment = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
  };
  const optimizedResult = {
    benchmark: "lazy-worker-file-parser-bundle",
    generatedAt,
    environment,
    optimized,
    notes: baselineResult.notes,
  };
  const comparison = {
    benchmark: "file-parser-bundle-comparison",
    generatedAt,
    before: {
      initialJavaScriptBytes: baseline.initial.javascriptBytes,
      initialJavaScriptGzipBytes: baseline.initial.javascriptGzipBytes,
      initialModuleCount: baseline.initial.moduleCount,
      initialIncludesJsZip: baseline.initial.includesJsZip,
      initialIncludesPdfJs: baseline.initial.includesPdfJs,
    },
    after: {
      initialJavaScriptBytes: optimized.initial.javascriptBytes,
      initialJavaScriptGzipBytes: optimized.initial.javascriptGzipBytes,
      initialModuleCount: optimized.initial.moduleCount,
      initialIncludesJsZip: optimized.initial.includesJsZip,
      initialIncludesPdfJs: optimized.initial.includesPdfJs,
      lazyJavaScriptChunkCount: optimized.lazy.chunkCount,
      lazyJavaScriptBytes: optimized.lazy.javascriptBytes,
      docxWorkerAssetBytes: optimized.output.docxWorkerAssetBytes,
      pdfWorkerAssetBytes: optimized.output.pdfWorkerAssetBytes,
    },
    improvement: {
      initialJavaScriptBytesReductionPercent: percentageReduction(
        baseline.initial.javascriptBytes,
        optimized.initial.javascriptBytes,
      ),
      initialJavaScriptGzipBytesReductionPercent: percentageReduction(
        baseline.initial.javascriptGzipBytes,
        optimized.initial.javascriptGzipBytes,
      ),
      initialModuleCountReductionPercent: percentageReduction(
        baseline.initial.moduleCount,
        optimized.initial.moduleCount,
      ),
    },
  };

  await Promise.all([
    writeFile(
      `${resultDirectory}/optimized.json`,
      `${JSON.stringify(optimizedResult, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      `${resultDirectory}/comparison.json`,
      `${JSON.stringify(comparison, null, 2)}\n`,
      "utf8",
    ),
  ]);

  console.log("File-parser bundle comparison completed");
  console.table({ eager: comparison.before, lazy: comparison.after });
  console.table(comparison.improvement);
  console.log(`Results written to ${resultDirectory}`);
}

await main();
