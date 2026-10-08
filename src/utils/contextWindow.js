export const DEFAULT_CONTEXT_TOKEN_BUDGET = 16_000;

const CJK_CHARACTER = /[\u3400-\u9fff\uf900-\ufaff]/u;

export function estimateTextTokens(text = "") {
  let cjkCount = 0;
  let nonCjkCharacters = 0;

  for (const character of text) {
    if (CJK_CHARACTER.test(character)) {
      cjkCount += 1;
    } else if (!/\s/u.test(character)) {
      nonCjkCharacters += 1;
    }
  }

  return cjkCount + Math.ceil(nonCjkCharacters / 4);
}

export function estimateMessageTokens(message) {
  // Approximate role and message-framing overhead in addition to content.
  return 4 + estimateTextTokens(message?.content ?? "");
}

export function estimateContextTokens(messages) {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
}

function groupConversationTurns(messages) {
  const turns = [];
  let currentTurn = [];

  for (const message of messages) {
    if (message.role === "user") {
      if (currentTurn.length) turns.push(currentTurn);
      currentTurn = [message];
    } else {
      currentTurn.push(message);
    }
  }

  if (currentTurn.length) turns.push(currentTurn);
  return turns;
}

/**
 * Keeps system messages and the latest conversation turn, then adds earlier
 * complete turns from newest to oldest while they fit within the budget.
 */
export function buildContextWindow(
  messages,
  { tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET } = {},
) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const normalizedBudget =
    Number.isFinite(tokenBudget) && tokenBudget > 0
      ? Math.floor(tokenBudget)
      : DEFAULT_CONTEXT_TOKEN_BUDGET;
  const originalTokens = estimateContextTokens(safeMessages);

  if (originalTokens <= normalizedBudget) {
    return {
      messages: [...safeMessages],
      metadata: {
        tokenBudget: normalizedBudget,
        originalMessageCount: safeMessages.length,
        retainedMessageCount: safeMessages.length,
        droppedMessageCount: 0,
        originalEstimatedTokens: originalTokens,
        retainedEstimatedTokens: originalTokens,
        overBudget: false,
      },
    };
  }

  const systemMessages = safeMessages.filter(
    (message) => message.role === "system",
  );
  const conversationMessages = safeMessages.filter(
    (message) => message.role !== "system",
  );
  const turns = groupConversationTurns(conversationMessages);
  const retainedTurns = [];
  let retainedTokens = estimateContextTokens(systemMessages);

  if (turns.length) {
    const latestTurn = turns.at(-1);
    retainedTurns.push(latestTurn);
    retainedTokens += estimateContextTokens(latestTurn);

    for (let index = turns.length - 2; index >= 0; index -= 1) {
      const turn = turns[index];
      const turnTokens = estimateContextTokens(turn);
      if (retainedTokens + turnTokens > normalizedBudget) break;

      retainedTurns.unshift(turn);
      retainedTokens += turnTokens;
    }
  }

  const retainedMessages = [
    ...systemMessages,
    ...retainedTurns.flat(),
  ];

  return {
    messages: retainedMessages,
    metadata: {
      tokenBudget: normalizedBudget,
      originalMessageCount: safeMessages.length,
      retainedMessageCount: retainedMessages.length,
      droppedMessageCount: safeMessages.length - retainedMessages.length,
      originalEstimatedTokens: originalTokens,
      retainedEstimatedTokens: retainedTokens,
      overBudget: retainedTokens > normalizedBudget,
    },
  };
}

export function selectContextMessages(messages, options) {
  return buildContextWindow(messages, options).messages;
}
