const CONTENT_VARIANTS = [
  "普通中文回答",
  "const value = 42;",
  "**Markdown** 表格与代码",
  "emoji-🙂-stream",
];

function createDeltaEvent(index) {
  const isReasoning = index % 3 === 0;
  const prefix = isReasoning ? "reasoning" : "content";
  const value = `${prefix}-${String(index).padStart(5, "0")}-${CONTENT_VARIANTS[index % CONTENT_VARIANTS.length]}`;
  const delta = isReasoning
    ? { reasoning_content: value }
    : { content: value };

  return {
    channel: isReasoning ? "reasoning" : "content",
    value,
    wire: `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`,
  };
}

export function createSseFixture(eventCount = 10_000) {
  const events = Array.from({ length: eventCount }, (_, index) =>
    createDeltaEvent(index),
  );

  return {
    eventCount,
    stream: `${events.map((event) => event.wire).join("")}data: [DONE]\n\n`,
    expectedContent: events
      .filter((event) => event.channel === "content")
      .map((event) => event.value),
    expectedReasoning: events
      .filter((event) => event.channel === "reasoning")
      .map((event) => event.value),
  };
}

function createSeededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function createCumulativeSnapshots(
  stream,
  { seed = 20_261_008, minChunkSize = 512, maxChunkSize = 4_096 } = {},
) {
  const random = createSeededRandom(seed);
  const snapshots = [];
  let receivedLength = 0;

  while (receivedLength < stream.length) {
    const chunkSize = Math.floor(
      minChunkSize + random() * (maxChunkSize - minChunkSize + 1),
    );
    receivedLength = Math.min(stream.length, receivedLength + chunkSize);
    snapshots.push(stream.slice(0, receivedLength));
  }

  return snapshots;
}
