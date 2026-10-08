function emitValue(value, callback) {
  if (!callback || value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((item) => callback(item));
    return;
  }

  callback(value);
}

/**
 * Incrementally parses the cumulative SSE text exposed by Axios/XHR.
 * Only newly received characters are scanned; an incomplete trailing event is
 * retained until a later callback supplies its blank-line terminator.
 */
export class IncrementalSseParser {
  constructor({ onContent, onReasoning, onDone } = {}) {
    this.onContent = onContent;
    this.onReasoning = onReasoning;
    this.onDone = onDone;
    this.processedLength = 0;
    this.fragmentBuffer = "";
    this.finished = false;
    this.metrics = {
      jsonParseCalls: 0,
      parseErrors: 0,
      parsedEvents: 0,
    };
  }

  push(cumulativeResponse) {
    if (typeof cumulativeResponse !== "string") {
      throw new TypeError("SSE response must be a string");
    }
    if (cumulativeResponse.length < this.processedLength) {
      throw new Error("SSE cumulative response length moved backwards");
    }

    const incrementalText = cumulativeResponse.slice(this.processedLength);
    this.processedLength = cumulativeResponse.length;
    if (!incrementalText || this.finished) return;

    this.fragmentBuffer += incrementalText;
    this.#consumeCompleteEvents();
  }

  #consumeCompleteEvents() {
    let delimiter = this.fragmentBuffer.match(/\r?\n\r?\n/);

    while (delimiter) {
      const eventBlock = this.fragmentBuffer.slice(0, delimiter.index);
      this.fragmentBuffer = this.fragmentBuffer.slice(
        delimiter.index + delimiter[0].length,
      );
      this.#parseEvent(eventBlock);

      if (this.finished) {
        this.fragmentBuffer = "";
        return;
      }
      delimiter = this.fragmentBuffer.match(/\r?\n\r?\n/);
    }
  }

  #parseEvent(eventBlock) {
    const data = eventBlock
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");

    if (!data) return;

    this.metrics.parsedEvents += 1;
    if (data === "[DONE]") {
      this.finished = true;
      this.onDone?.();
      return;
    }

    this.metrics.jsonParseCalls += 1;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      this.metrics.parseErrors += 1;
      throw error;
    }

    const delta = payload.choices?.[0]?.delta;
    emitValue(delta?.reasoning_content, this.onReasoning);
    emitValue(delta?.content, this.onContent);
  }

  get pendingFragmentLength() {
    return this.fragmentBuffer.length;
  }
}
