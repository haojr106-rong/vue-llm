import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";

import {
  DEFAULT_MAX_TEXT_PREVIEW,
  truncatePreview,
} from "./shared";

if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export async function extractPdfText(
  file,
  { maxTextPreview = DEFAULT_MAX_TEXT_PREVIEW } = {},
) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const chunks = [];
  let collectedLength = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (pageText) {
      chunks.push(pageText);
      collectedLength += pageText.length + 2;
    }

    if (collectedLength > maxTextPreview * 1.5) break;
  }

  const combined = chunks.join("\n\n");
  if (!combined.trim()) {
    return {
      body: "",
      note: "PDF 文件未检测到可提取的文本内容。",
    };
  }

  return truncatePreview(combined, maxTextPreview);
}
