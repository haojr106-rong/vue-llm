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

The comparison uses a 16,000 estimated-token input budget. System messages and
the latest conversation turn are retained, then earlier complete turns are
added from newest to oldest while they fit. This prevents an assistant answer
from being retained without its corresponding user question.

Results are stored in `results/baseline.json`, `results/optimized.json`, and
`results/comparison.json`. Automatic assertions verify that every request in
the fixture stays within budget, the latest user message is always retained,
and no assistant message is kept without its matching user message.
