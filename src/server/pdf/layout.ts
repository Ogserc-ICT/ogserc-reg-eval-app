import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { asset } from "./assets";

export const COLOURS = {
  green: rgb(0x1f / 255, 0x5c / 255, 0x3a / 255),
  gold: rgb(0xb0 / 255, 0x8d / 255, 0x2e / 255),
  grey: rgb(0x55 / 255, 0x55 / 255, 0x55 / 255),
  black: rgb(0.1, 0.1, 0.1),
  rule: rgb(0.8, 0.83, 0.8),
  white: rgb(1, 1, 1),
};

export const LETTERHEAD = {
  name: "OGUN STATE ELECTRICITY REGULATORY COMMISSION",
  address:
    "5th and 6th Floors, OPIC Building, Oke-Ilewo, Abeokuta, Ogun State · registration@ogserc.gov.ng",
};

const MM = 72 / 25.4;
export const A4_PORTRAIT: [number, number] = [210 * MM, 297 * MM];
export const A4_LANDSCAPE: [number, number] = [297 * MM, 210 * MM];

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

export async function newDocument(meta: { title: string; subject: string; serif?: boolean }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold, italic] = await Promise.all(
    (meta.serif
      ? (["serif", "serifBold", "serifItalic"] as const)
      : (["sans", "sansBold", "sansItalic"] as const)
    ).map(async (name) => doc.embedFont(await asset(name), { subset: true })),
  );
  doc.setTitle(meta.title);
  doc.setSubject(meta.subject);
  doc.setAuthor(LETTERHEAD.name);
  doc.setCreator("OGSERC Registration & Evaluation System");
  doc.setProducer("OGSERC Registration & Evaluation System");
  doc.setCreationDate(new Date());
  return { doc, fonts: { regular: regular!, bold: bold!, italic: italic! } as Fonts };
}

/** Split text into lines that fit `width` (breaks long unspaced runs too). Honours "\n". */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the line: break it.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Largest size ≤ `max` (not below `min`) at which `text` fits in `width` on one line. */
export function fitSize(text: string, font: PDFFont, max: number, min: number, width: number) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 0.25;
  return size;
}

interface TextOptions {
  size?: number;
  font?: "regular" | "bold" | "italic";
  colour?: RGB;
  indent?: number;
  width?: number;
  align?: "left" | "center" | "right";
  lineGap?: number;
  after?: number;
}

/**
 * Flowing A4 portrait document: a cursor moves down the page and new pages are added as needed.
 * Every page gets the letterhead strip, a footer with "Page n of N" and the reference.
 */
export class FlowDocument {
  private pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  readonly margin = { left: 20 * MM, right: 20 * MM, top: 18 * MM, bottom: 22 * MM };

  private constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    private readonly logo: PDFImage,
    private readonly footerRef: string,
    private readonly draft: boolean,
  ) {}

  static async create(meta: {
    title: string;
    subject: string;
    footerRef: string;
    draft?: boolean;
  }) {
    const { doc, fonts } = await newDocument(meta);
    const logo = await doc.embedPng(await asset("logo"));
    const flow = new FlowDocument(doc, fonts, logo, meta.footerRef, !!meta.draft);
    flow.addPage();
    return flow;
  }

  get width() {
    return A4_PORTRAIT[0] - this.margin.left - this.margin.right;
  }

  addPage() {
    this.page = this.doc.addPage(A4_PORTRAIT);
    this.pages.push(this.page);
    this.y = A4_PORTRAIT[1] - this.margin.top;
    this.letterhead(this.pages.length === 1);
  }

  /** Start a new page if fewer than `height` points remain. */
  ensure(height: number) {
    if (this.y - height < this.margin.bottom) this.addPage();
  }

  private letterhead(full: boolean) {
    const { left } = this.margin;
    const logoH = full ? 34 : 20;
    const logoW = (this.logo.width / this.logo.height) * logoH;
    this.page.drawImage(this.logo, { x: left, y: this.y - logoH, width: logoW, height: logoH });
    const textX = left + logoW + 10;
    const nameSize = full ? 11 : 8.5;
    this.page.drawText(LETTERHEAD.name, {
      x: textX,
      y: this.y - (full ? 14 : 10),
      size: nameSize,
      font: this.fonts.bold,
      color: COLOURS.green,
    });
    if (full) {
      for (const [i, line] of wrap(
        LETTERHEAD.address,
        this.fonts.regular,
        7.5,
        this.width - logoW - 10,
      ).entries()) {
        this.page.drawText(line, {
          x: textX,
          y: this.y - 26 - i * 9,
          size: 7.5,
          font: this.fonts.regular,
          color: COLOURS.grey,
        });
      }
    }
    this.y -= logoH + 6;
    this.page.drawLine({
      start: { x: left, y: this.y },
      end: { x: left + this.width, y: this.y },
      thickness: 1.2,
      color: COLOURS.green,
    });
    this.page.drawLine({
      start: { x: left, y: this.y - 2.5 },
      end: { x: left + this.width, y: this.y - 2.5 },
      thickness: 0.6,
      color: COLOURS.gold,
    });
    this.y -= full ? 22 : 16;
  }

  text(text: string, o: TextOptions = {}) {
    const size = o.size ?? 10;
    const font = this.fonts[o.font ?? "regular"];
    const indent = o.indent ?? 0;
    const width = (o.width ?? this.width) - indent;
    const lineHeight = size * 1.35 + (o.lineGap ?? 0);
    for (const line of wrap(text, font, size, width)) {
      this.ensure(lineHeight);
      const w = font.widthOfTextAtSize(line, size);
      const x =
        this.margin.left +
        indent +
        (o.align === "center" ? (width - w) / 2 : o.align === "right" ? width - w : 0);
      this.page.drawText(line, {
        x,
        y: this.y - size,
        size,
        font,
        color: o.colour ?? COLOURS.black,
      });
      this.y -= lineHeight;
    }
    this.y -= o.after ?? 4;
  }

  heading(text: string, o: { size?: number; colour?: RGB; after?: number } = {}) {
    this.ensure(40);
    this.text(text, {
      size: o.size ?? 10.5,
      font: "bold",
      colour: o.colour ?? COLOURS.green,
      after: o.after ?? 5,
    });
  }

  space(points: number) {
    this.y -= points;
  }

  rule(colour: RGB = COLOURS.rule) {
    this.ensure(8);
    this.page.drawLine({
      start: { x: this.margin.left, y: this.y },
      end: { x: this.margin.left + this.width, y: this.y },
      thickness: 0.5,
      color: colour,
    });
    this.y -= 8;
  }

  /** Two-column label/value rows; long values wrap and rows never split across pages. */
  table(rows: [string, string][], o: { labelWidth?: number; size?: number; zebra?: boolean } = {}) {
    const size = o.size ?? 9.5;
    const labelWidth = o.labelWidth ?? 150;
    const valueWidth = this.width - labelWidth - 8;
    const lh = size * 1.35;
    for (const [i, [label, value]] of rows.entries()) {
      const labelLines = wrap(label, this.fonts.bold, size, labelWidth - 6);
      const valueLines = wrap(value, this.fonts.regular, size, valueWidth - 6);
      const height = Math.max(labelLines.length, valueLines.length) * lh + 6;
      this.ensure(height);
      if (o.zebra !== false && i % 2 === 0) {
        this.page.drawRectangle({
          x: this.margin.left,
          y: this.y - height,
          width: this.width,
          height,
          color: rgb(0.95, 0.97, 0.95),
        });
      }
      labelLines.forEach((l, j) =>
        this.page.drawText(l, {
          x: this.margin.left + 4,
          y: this.y - 4 - size - j * lh,
          size,
          font: this.fonts.bold,
          color: COLOURS.green,
        }),
      );
      valueLines.forEach((l, j) =>
        this.page.drawText(l, {
          x: this.margin.left + labelWidth + 4,
          y: this.y - 4 - size - j * lh,
          size,
          font: this.fonts.regular,
          color: COLOURS.black,
        }),
      );
      this.y -= height;
    }
    this.y -= 8;
  }

  /** Numbered or lettered list with hanging indent. */
  list(items: string[], o: { marker?: (i: number) => string; size?: number } = {}) {
    const marker = o.marker ?? ((i: number) => `${i + 1}.`);
    for (const [i, item] of items.entries()) {
      const size = o.size ?? 10;
      const lines = wrap(item, this.fonts.regular, size, this.width - 22);
      this.ensure(size * 1.35);
      this.page.drawText(marker(i), {
        x: this.margin.left + 2,
        y: this.y - size,
        size,
        font: this.fonts.regular,
        color: COLOURS.black,
      });
      for (const line of lines) {
        this.ensure(size * 1.35);
        this.page.drawText(line, {
          x: this.margin.left + 22,
          y: this.y - size,
          size,
          font: this.fonts.regular,
          color: COLOURS.black,
        });
        this.y -= size * 1.35;
      }
      this.y -= 3;
    }
    this.y -= 4;
  }

  /** Signature block: line, name, and up to two lines below. */
  signature(name: string, lines: string[] = [], o: { x?: number; width?: number } = {}) {
    this.ensure(60);
    const x = this.margin.left + (o.x ?? 0);
    const width = o.width ?? 180;
    this.y -= 26;
    this.page.drawLine({
      start: { x, y: this.y },
      end: { x: x + width, y: this.y },
      thickness: 0.6,
      color: COLOURS.grey,
    });
    this.y -= 12;
    this.page.drawText(name, {
      x,
      y: this.y,
      size: 10,
      font: this.fonts.bold,
      color: COLOURS.black,
    });
    for (const line of lines) {
      this.y -= 12;
      this.page.drawText(line, {
        x,
        y: this.y,
        size: 9,
        font: this.fonts.regular,
        color: COLOURS.grey,
      });
    }
    this.y -= 10;
  }

  /** Finish: footers on every page (and a DRAFT watermark if requested); returns the PDF bytes. */
  async save(): Promise<Uint8Array> {
    const total = this.pages.length;
    for (const [i, page] of this.pages.entries()) {
      const footer = `${this.footerRef}  ·  Page ${i + 1} of ${total}`;
      const size = 7.5;
      const w = this.fonts.regular.widthOfTextAtSize(footer, size);
      page.drawLine({
        start: { x: this.margin.left, y: this.margin.bottom - 10 },
        end: { x: this.margin.left + this.width, y: this.margin.bottom - 10 },
        thickness: 0.4,
        color: COLOURS.rule,
      });
      page.drawText(footer, {
        x: this.margin.left + this.width - w,
        y: this.margin.bottom - 22,
        size,
        font: this.fonts.regular,
        color: COLOURS.grey,
      });
      if (this.draft) {
        page.drawText("DRAFT – NOT ISSUED", {
          x: 80,
          y: 190,
          size: 50,
          font: this.fonts.bold,
          color: rgb(0.75, 0.1, 0.1),
          opacity: 0.12,
          rotate: degrees(40),
        });
      }
    }
    return this.doc.save();
  }
}
