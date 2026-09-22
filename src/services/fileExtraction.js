async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
  );
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => item.str)
        .join(" ")
        .trim(),
    );
  }

  return pages.filter(Boolean).join("\n\n");
}

async function extractDocxText(file) {
  const mammoth = await import("mammoth/mammoth.browser.js");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return result.value.trim();
}

export async function extractFileText(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "pdf") {
    return {
      kind: "pdf",
      text: await extractPdfText(file),
    };
  }

  if (extension === "docx") {
    return {
      kind: "docx",
      text: await extractDocxText(file),
    };
  }

  if (
    ["txt", "md", "markdown", "csv", "json", "log"].includes(extension)
  ) {
    return {
      kind: extension || "text",
      text: (await file.text()).trim(),
    };
  }

  throw new Error("暂不支持该文件类型，请选择 PDF、DOCX、TXT、MD、CSV 或 JSON");
}

export const supportedFileTypes =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log";
