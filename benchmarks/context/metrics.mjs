import { Buffer } from "node:buffer";
import { estimateContextTokens } from "../../src/utils/contextWindow.js";

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
