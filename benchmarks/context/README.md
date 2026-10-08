# Context-window benchmark

This benchmark characterizes the current full-history request strategy used by
`getMessagesForModel()`. It runs locally and does not call DeepSeek, use an API
key, consume provider tokens, or send network requests.

## Run

```bash
npm run benchmark:context
```

The deterministic fixture contains 120 rounds of mixed Chinese and ASCII chat
content. A request is measured after each user message, matching the point at
which the application calls the model. The baseline records:

1. Final request bytes and estimated context tokens.
2. Cumulative bytes and estimated tokens repeatedly sent across all 120 calls.
3. Request growth at fixed conversation checkpoints.

The token value is a deterministic local estimate rather than a claim about
DeepSeek billing tokens. Byte size is measured from the serialized request and
is the primary transport-size metric.

The generated result is stored at `results/baseline.json`. The future
token-budget strategy must reuse this exact fixture and measurement method.
