# Markdown rendering benchmark

This benchmark characterizes the uncached `renderMarkdown(item.content)` call
used by `chatMessage.vue`. It runs locally and does not call DeepSeek, use an
API key, consume provider tokens, or send network requests.

## Run

```bash
npm run benchmark:markdown
```

The deterministic fixture simulates 30 messages in the rendered virtual-list
window and 200 batched updates to the active streaming message. On every update
the baseline renders every visible message with the same Markdown-it,
Highlight.js, and table-plugin configuration used by the application.

The primary metrics are the number of Markdown parse calls and the cumulative
number of input characters parsed. Runtime is recorded only as an auxiliary
machine-dependent value.

The optimized strategy keeps one latest source/HTML pair per message ID. An
unchanged message reuses its cached HTML, while a streaming update replaces
only that message's previous entry. Removed messages are pruned so old content
does not accumulate indefinitely, and a 200-entry LRU limit bounds memory when
many historical messages have been viewed.

Results are stored in `results/baseline.json`, `results/optimized.json`, and
`results/comparison.json`. Automatic assertions verify identical final HTML,
expected cache hits, bounded cache size, replacement, pruning, and cleanup.
