import {
  DEFAULT_MAX_TEXT_PREVIEW,
  truncatePreview,
} from "./shared";

const WORKER_TIMEOUT_MS = 30_000;

function extractXmlInWorker(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/docxParser.worker.js", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("DOCX worker timed out"));
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = ({ data }) => {
      clearTimeout(timeout);
      worker.terminate();
      if (data.ok) {
        resolve(data.xml);
      } else {
        reject(new Error(data.error || "DOCX worker failed"));
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "DOCX worker failed"));
    };

    worker.postMessage({ arrayBuffer }, [arrayBuffer]);
  });
}

export async function extractDocxText(
  file,
  { maxTextPreview = DEFAULT_MAX_TEXT_PREVIEW } = {},
) {
  const arrayBuffer = await file.arrayBuffer();
  const xml = await extractXmlInWorker(arrayBuffer);
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
  const text = paragraphs
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagName("w:t"))
        .map((node) => node.textContent)
        .join(""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  if (!text.trim()) {
    return {
      body: "",
      note: "DOCX 文件未检测到可提取的文本内容。",
    };
  }

  return truncatePreview(text, maxTextPreview);
}
