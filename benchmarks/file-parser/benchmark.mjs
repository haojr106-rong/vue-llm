import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
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
    for (const importedName of chunk?.imports ?? []) {
      queue.push(importedName);
    }
  }

  return chunks.filter((chunk) => initialNames.has(chunk.fileName));
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

async function runBuildAnalysis() {
  const startedAt = performance.now();
  const result = await build({
    logLevel: "silent",
    build: {
      write: false,
    },
  });
  const buildDurationMs = performance.now() - startedAt;
  const outputs = collectOutputs(result);
  const chunks = outputs.filter((output) => output.type === "chunk");
  const assets = outputs.filter((output) => output.type === "asset");
  const initialChunks = collectInitialChunks(chunks);
  const initialModules = new Set(
    initialChunks.flatMap((chunk) => Object.keys(chunk.modules)),
  );
  const initialJavaScriptBytes = initialChunks.reduce(
    (total, chunk) => total + byteLength(chunk.code),
    0,
  );
  const initialJavaScriptGzipBytes = initialChunks.reduce(
    (total, chunk) => total + gzipSync(chunk.code).byteLength,
    0,
  );
  const pdfWorkerAsset = assets.find((asset) =>
    asset.fileName.includes("pdf.worker"),
  );

  return {
    initial: {
      chunkCount: initialChunks.length,
      moduleCount: initialModules.size,
      javascriptBytes: initialJavaScriptBytes,
      javascriptGzipBytes: initialJavaScriptGzipBytes,
      includesJsZip: [...initialModules].some((id) =>
        id.includes("node_modules/jszip"),
      ),
      includesPdfJs: [...initialModules].some((id) =>
        id.includes("node_modules/pdfjs-dist"),
      ),
    },
    output: {
      javascriptChunkCount: chunks.length,
      assetCount: assets.length,
      pdfWorkerAssetBytes: pdfWorkerAsset
        ? typeof pdfWorkerAsset.source === "string"
          ? byteLength(pdfWorkerAsset.source)
          : pdfWorkerAsset.source.byteLength
        : 0,
    },
    buildDurationMs: Number(buildDurationMs.toFixed(2)),
  };
}

async function main() {
  const baseline = await runBuildAnalysis();

  assert.ok(baseline.initial.javascriptBytes > 0);
  assert.ok(baseline.initial.javascriptGzipBytes > 0);
  assert.equal(baseline.initial.includesJsZip, true);
  assert.equal(baseline.initial.includesPdfJs, true);

  const result = {
    benchmark: "eager-file-parser-bundle",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
    },
    baseline,
    notes: {
      networkRequestsSent: 0,
      buildMode: "Vite production build with write disabled",
      primaryMetrics: [
        "initial.javascriptBytes",
        "initial.javascriptGzipBytes",
      ],
    },
  };

  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const resultDirectory = `${currentDirectory}/results`;
  const resultPath = `${resultDirectory}/baseline.json`;
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("File-parser bundle baseline completed");
  console.table({
    initialChunks: baseline.initial.chunkCount,
    initialModules: baseline.initial.moduleCount,
    initialJavaScriptBytes: baseline.initial.javascriptBytes,
    initialJavaScriptGzipBytes: baseline.initial.javascriptGzipBytes,
    includesJsZip: baseline.initial.includesJsZip,
    includesPdfJs: baseline.initial.includesPdfJs,
    pdfWorkerAssetBytes: baseline.output.pdfWorkerAssetBytes,
    buildDurationMs: baseline.buildDurationMs,
  });
  console.log(`Result written to ${resultPath}`);
}

await main();
