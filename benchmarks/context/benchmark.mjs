import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  buildContextWindow,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  estimateContextTokens,
} from "../../src/utils/contextWindow.js";
import { createConversationFixture } from "./fixtures.mjs";
import { selectLegacyContext } from "./legacy-context.mjs";
import { measureRequest } from "./metrics.mjs";

const ROUND_COUNT = 120;
const TOKEN_BUDGET = DEFAULT_CONTEXT_TOKEN_BUDGET;
const CHECKPOINTS = new Set([10, 25, 50, 100, 120]);
const TURN_MARKER = /\[turn-(\d+)-(user|assistant)\]/u;

function analyzeRetainedMessages(messages, roundCount) {
  const userTurns = new Set();
  const assistantTurns = new Set();

  for (const message of messages) {
    const marker = message.content.match(TURN_MARKER);
    if (!marker) continue;

    const turn = Number(marker[1]);
    if (marker[2] === "user") userTurns.add(turn);
    if (marker[2] === "assistant") assistantTurns.add(turn);
  }

  const assistantWithoutUserCount = [...assistantTurns].filter(
    (turn) => !userTurns.has(turn),
  ).length;
  const completeRoundCount = [...assistantTurns].filter((turn) =>
    userTurns.has(turn),
  ).length;

  return {
    messageCount: messages.length,
    containsFirstMessage: userTurns.has(1),
    containsLatestMessage: userTurns.has(roundCount),
    completeRoundCount,
    assistantWithoutUserCount,
    oldestRetainedUserTurn: userTurns.size ? Math.min(...userTurns) : null,
    newestRetainedUserTurn: userTurns.size ? Math.max(...userTurns) : null,
  };
}

function runPolicy(fixture, selectMessages) {
  const growth = [];
  let cumulativeRequestBytes = 0;
  let cumulativeEstimatedTokens = 0;
  let allRequestsWithinBudget = true;
  let latestMessageAlwaysRetained = true;

  for (let round = 1; round <= fixture.roundCount; round += 1) {
    // Requests are made after the user message and before the assistant reply.
    const activeMessages = fixture.messages.slice(0, round * 2 - 1);
    const selection = selectMessages(activeMessages);
    const measurement = measureRequest(selection.messages);
    const retained = analyzeRetainedMessages(selection.messages, round);

    cumulativeRequestBytes += measurement.requestBytes;
    cumulativeEstimatedTokens += measurement.estimatedTokens;
    allRequestsWithinBudget &&=
      measurement.estimatedTokens <= TOKEN_BUDGET;
    latestMessageAlwaysRetained &&= retained.containsLatestMessage;

    if (CHECKPOINTS.has(round)) {
      growth.push({
        round,
        ...measurement,
        droppedMessageCount:
          activeMessages.length - selection.messages.length,
      });
    }
  }

  const finalInput = fixture.messages.slice(0, fixture.messages.length - 1);
  const finalSelection = selectMessages(finalInput);
  const finalRequest = measureRequest(finalSelection.messages);
  const retained = analyzeRetainedMessages(
    finalSelection.messages,
    fixture.roundCount,
  );

  return {
    finalRequest,
    cumulativeAcrossRounds: {
      requestCount: fixture.roundCount,
      requestBytes: cumulativeRequestBytes,
      estimatedTokens: cumulativeEstimatedTokens,
    },
    growth,
    retained: {
      ...retained,
      messageRatio: Number(
        (retained.messageCount / finalInput.length).toFixed(4),
      ),
    },
    guarantees: {
      allRequestsWithinBudget,
      latestMessageAlwaysRetained,
    },
  };
}

function percentageReduction(before, after) {
  return Number((((before - after) / before) * 100).toFixed(2));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function verifyPolicyEdgeCases() {
  const shortConversation = [
    { role: "user", content: "简短问题" },
    { role: "assistant", content: "简短回答" },
  ];
  const unchanged = buildContextWindow(shortConversation, {
    tokenBudget: 100,
  });
  assert.deepEqual(unchanged.messages, shortConversation);
  assert.equal(unchanged.metadata.droppedMessageCount, 0);

  const constrainedConversation = [
    { role: "system", content: "始终使用中文回答" },
    { role: "user", content: "旧问题".repeat(100) },
    { role: "assistant", content: "旧回答".repeat(100) },
    { role: "user", content: "最新问题" },
  ];
  const mandatoryMessages = [
    constrainedConversation[0],
    constrainedConversation[3],
  ];
  const constrained = buildContextWindow(constrainedConversation, {
    tokenBudget: estimateContextTokens(mandatoryMessages),
  });
  assert.deepEqual(constrained.messages, mandatoryMessages);

  const oversizedLatest = buildContextWindow(
    [{ role: "user", content: "必须保留".repeat(20) }],
    { tokenBudget: 1 },
  );
  assert.equal(oversizedLatest.messages.length, 1);
  assert.equal(oversizedLatest.metadata.overBudget, true);
}

async function main() {
  verifyPolicyEdgeCases();
  const fixture = createConversationFixture(ROUND_COUNT);
  const baseline = {
    policy: "full-history-without-budget",
    ...runPolicy(fixture, (messages) => ({
      messages: selectLegacyContext(messages),
    })),
  };
  const optimized = {
    policy: "estimated-token-budget-with-complete-recent-turns",
    tokenBudget: TOKEN_BUDGET,
    ...runPolicy(fixture, (messages) =>
      buildContextWindow(messages, { tokenBudget: TOKEN_BUDGET }),
    ),
  };

  assert.equal(fixture.messages.length, ROUND_COUNT * 2);
  assert.equal(baseline.finalRequest.messageCount, ROUND_COUNT * 2 - 1);
  assert.equal(baseline.retained.containsFirstMessage, true);
  assert.equal(optimized.guarantees.allRequestsWithinBudget, true);
  assert.equal(optimized.guarantees.latestMessageAlwaysRetained, true);
  assert.equal(optimized.retained.containsLatestMessage, true);
  assert.equal(optimized.retained.assistantWithoutUserCount, 0);
  assert.ok(optimized.finalRequest.estimatedTokens <= TOKEN_BUDGET);
  assert.ok(
    optimized.finalRequest.requestBytes < baseline.finalRequest.requestBytes,
  );

  const environment = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
  };
  const fixtureSummary = {
    roundCount: fixture.roundCount,
    totalMessageCount: fixture.messages.length,
    content: "deterministic mixed Chinese and ASCII conversation",
  };
  const notes = {
    networkRequestsSent: 0,
    tokenMetric: "deterministic estimate, not provider billing tokens",
  };
  const generatedAt = new Date().toISOString();
  const baselineResult = {
    benchmark: "legacy-full-history-context",
    generatedAt,
    environment,
    fixture: fixtureSummary,
    baseline,
    notes,
  };
  const optimizedResult = {
    benchmark: "budgeted-context-window",
    generatedAt,
    environment,
    fixture: fixtureSummary,
    optimized,
    notes,
  };
  const comparison = {
    benchmark: "context-window-comparison",
    generatedAt,
    fixture: fixtureSummary,
    tokenBudget: TOKEN_BUDGET,
    before: {
      finalRequestBytes: baseline.finalRequest.requestBytes,
      finalEstimatedTokens: baseline.finalRequest.estimatedTokens,
      cumulativeRequestBytes: baseline.cumulativeAcrossRounds.requestBytes,
      cumulativeEstimatedTokens:
        baseline.cumulativeAcrossRounds.estimatedTokens,
      finalMessageCount: baseline.finalRequest.messageCount,
    },
    after: {
      finalRequestBytes: optimized.finalRequest.requestBytes,
      finalEstimatedTokens: optimized.finalRequest.estimatedTokens,
      cumulativeRequestBytes: optimized.cumulativeAcrossRounds.requestBytes,
      cumulativeEstimatedTokens:
        optimized.cumulativeAcrossRounds.estimatedTokens,
      finalMessageCount: optimized.finalRequest.messageCount,
      retainedCompleteRounds: optimized.retained.completeRoundCount,
      oldestRetainedUserTurn: optimized.retained.oldestRetainedUserTurn,
      latestMessageAlwaysRetained:
        optimized.guarantees.latestMessageAlwaysRetained,
      assistantWithoutUserCount:
        optimized.retained.assistantWithoutUserCount,
    },
    improvement: {
      finalRequestBytesReductionPercent: percentageReduction(
        baseline.finalRequest.requestBytes,
        optimized.finalRequest.requestBytes,
      ),
      finalEstimatedTokensReductionPercent: percentageReduction(
        baseline.finalRequest.estimatedTokens,
        optimized.finalRequest.estimatedTokens,
      ),
      cumulativeRequestBytesReductionPercent: percentageReduction(
        baseline.cumulativeAcrossRounds.requestBytes,
        optimized.cumulativeAcrossRounds.requestBytes,
      ),
      cumulativeEstimatedTokensReductionPercent: percentageReduction(
        baseline.cumulativeAcrossRounds.estimatedTokens,
        optimized.cumulativeAcrossRounds.estimatedTokens,
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

  console.log("Context-window comparison completed");
  console.table({
    fullHistory: comparison.before,
    tokenBudget: comparison.after,
  });
  console.table(comparison.improvement);
  console.log(`Results written to ${resultDirectory}`);
}

await main();
