# File-parser bundle benchmark

This benchmark runs the real Vite production build in memory and inspects the
entry chunk plus its static imports. It does not write a second build folder,
call DeepSeek, use an API key, or send network requests.

## Run

```bash
npm run benchmark:files
```

The baseline records initial JavaScript bytes, gzip bytes, module count, and
whether JSZip and PDF.js are reachable from the initial entry. The PDF worker
asset is reported separately because it is emitted as a worker resource rather
than normal entry JavaScript.

Build duration is auxiliary and machine-dependent. Bundle bytes and the initial
dependency graph are the primary metrics. The generated summary is stored in
`results/baseline.json`.
