import { Buffer } from "node:buffer";

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
  // Four tokens approximate the role and message framing overhead.
  return 4 + estimateTextTokens(message.content);
}

export function estimateContextTokens(messages) {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
}

export function createRequestBody(messages) {
  return {
    model: "deepseek-reasoner",
    messages,
    stream: true,
  };
}

export function measureRequest(messages) {
  const serialized = JSON.stringify(createRequestBody(messages));

  return {
    messageCount: messages.length,
    requestCharacters: serialized.length,
    requestBytes: Buffer.byteLength(serialized, "utf8"),
    estimatedTokens: estimateContextTokens(messages),
  };
}
