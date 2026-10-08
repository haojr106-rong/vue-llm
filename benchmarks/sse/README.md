# SSE parser benchmark

This benchmark compares the legacy cumulative-response parser with the
incremental parser used by `src/apis/deepseek.js`. It does not call DeepSeek,
use an API key, consume model tokens, or send network requests.

## Run

```bash
npm run benchmark:sse
```

The script generates 10,000 deterministic DeepSeek-shaped SSE events, divides
the stream at reproducible random character positions, and feeds the exact same
cumulative response snapshots to both parsers.

The resume-facing baseline focuses on two outcomes:

1. Missing or duplicated content/reasoning events.
2. The number of `JSON.parse` calls required by cumulative rescanning.

The summaries are stored in `results/baseline.json`, `results/optimized.json`,
and `results/comparison.json`. Both parsers reuse the same fixture size, seed,
and chunk boundaries so the comparison remains reproducible and fair.

The command exits with an error if the incremental parser loses, duplicates, or
reorders any event, fails on a random fragment, leaves an unconsumed fragment,
emits the completion signal more than once, or parses an event more than once.
