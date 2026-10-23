// Read generated PDFs back in tests: extract text, and render pages to PNG for visual review.
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

class NapiCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target: { canvas: Canvas }, width: number, height: number) {
    target.canvas.width = Math.ceil(width);
    target.canvas.height = Math.ceil(height);
  }
  destroy(target: { canvas: Canvas | null; context: SKRSContext2D | null }) {
    target.canvas = null;
    target.context = null;
  }
}

async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const { getDocument } = await pdfjs();
  return getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    CanvasFactory: NapiCanvasFactory,
  } as Parameters<typeof getDocument>[0]).promise;
}

/** All text, page by page, with runs joined by spaces and whitespace collapsed. */
export async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await open(bytes);
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  await doc.destroy();
  return pages;
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await open(bytes);
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

/** Render one page to PNG bytes. */
export async function renderPage(bytes: Uint8Array, pageNumber = 1, scale = 1.5): Promise<Buffer> {
  const doc = await open(bytes);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport })
    .promise;
  await doc.destroy();
  return canvas.toBuffer("image/png");
}
