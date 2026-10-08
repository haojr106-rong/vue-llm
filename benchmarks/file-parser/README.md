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

The optimized build dynamically imports PDF.js only when a PDF is selected and
moves JSZip into a DOCX Worker. Assertions verify that neither library remains
in the initial dependency graph, PDF.js exists in a lazy chunk, and the DOCX
Worker asset is emitted.

Bundle bytes and the initial dependency graph are the primary metrics. Results
are stored in `results/baseline.json`, `results/optimized.json`, and
`results/comparison.json`.
