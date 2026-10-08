# SSE parser benchmark

This benchmark characterizes the cumulative-response parser currently embedded
in `src/apis/deepseek.js`. It does not call DeepSeek, use an API key, consume
model tokens, or send network requests.

## Run

```bash
npm run benchmark:sse
```

The script generates 10,000 deterministic DeepSeek-shaped SSE events, divides
the stream at reproducible random character positions, and feeds cumulative
response snapshots to the legacy parser.

The resume-facing baseline focuses on two outcomes:

1. Missing or duplicated content/reasoning events.
2. The number of `JSON.parse` calls required by cumulative rescanning.

The generated summary is stored at `results/baseline.json`. The future
incremental parser must reuse the same fixture size, seed, and chunk boundaries
so the comparison remains valid.
