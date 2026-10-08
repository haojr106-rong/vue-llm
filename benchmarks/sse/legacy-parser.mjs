/**
 * Characterization copy of the current parser in src/apis/deepseek.js.
 *
 * It intentionally rescans the complete cumulative response and uses separate
 * content/reasoning counters. Keeping this behavior unchanged gives the future
 * incremental parser a reproducible baseline.
 */
export class LegacyCumulativeSseParser {
  constructor() {
    this.processedContentChunks = 0;
    this.processedReasonChunks = 0;
    this.content = [];
    this.reasoning = [];
    this.doneCount = 0;
    this.metrics = {
      jsonParseCalls: 0,
      parseErrors: 0,
      scannedDataLines: 0,
    };
  }

  push(cumulativeResponse) {
    const lines = cumulativeResponse
      .split("\n")
      .filter((line) => line.startsWith("data: "));

    this.metrics.scannedDataLines += lines.length;

    let contentIndex = 0;
    let reasoningIndex = 0;

    for (const line of lines) {
      if (line === "data: [DONE]") {
        this.doneCount += 1;
        return;
      }

      this.metrics.jsonParseCalls += 1;

      let payload;
      try {
        payload = JSON.parse(line.slice(6));
      } catch (error) {
        this.metrics.parseErrors += 1;
        throw error;
      }

      const delta = payload.choices?.[0]?.delta;
      const reasoning = delta?.reasoning_content;
      const content = delta?.content;

      if (reasoning) {
        if (reasoningIndex >= this.processedReasonChunks) {
          this.reasoning.push(reasoning);
          this.processedReasonChunks += 1;
        }
        reasoningIndex += 1;
      }

      if (content) {
        if (contentIndex >= this.processedContentChunks) {
          this.content.push(content);
          this.processedContentChunks += 1;
        }
        contentIndex += 1;
      }
    }
  }
}
