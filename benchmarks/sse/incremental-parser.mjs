import { IncrementalSseParser } from "../../src/utils/incrementalSseParser.js";

// The benchmark directly wraps the production parser instead of maintaining a
// second implementation that could drift away from application behavior.
export class BenchmarkIncrementalSseParser {
  constructor() {
    this.content = [];
    this.reasoning = [];
    this.doneCount = 0;
    this.parser = new IncrementalSseParser({
      onContent: (value) => this.content.push(value),
      onReasoning: (value) => this.reasoning.push(value),
      onDone: () => {
        this.doneCount += 1;
      },
    });
  }

  push(cumulativeResponse) {
    this.parser.push(cumulativeResponse);
  }

  get metrics() {
    return this.parser.metrics;
  }

  get pendingFragmentLength() {
    return this.parser.pendingFragmentLength;
  }
}
