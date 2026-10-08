import JSZip from "jszip";

self.onmessage = async ({ data }) => {
  try {
    const zip = await JSZip.loadAsync(data.arrayBuffer);
    const documentFile = zip.file("word/document.xml");

    if (!documentFile) {
      self.postMessage({
        ok: false,
        error: "DOCX_DOCUMENT_XML_MISSING",
      });
      return;
    }

    const xml = await documentFile.async("string");
    self.postMessage({ ok: true, xml });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
