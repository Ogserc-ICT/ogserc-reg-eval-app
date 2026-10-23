import type { CertificateFields } from "@/domain/certificate";
import { formatDate } from "@/domain/dates";
import type { IsoDate } from "@/domain/types";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import QRCode from "qrcode";
import { asset } from "./assets";
import { A4_LANDSCAPE, COLOURS, LETTERHEAD, fitSize, newDocument, wrap } from "./layout";

// CERT-01, A4 landscape, after the original Word template (assets/CERT-01_template.docx): Georgia is
// replaced by DejaVu Serif; sizes, colours and order follow the template.

const [W, H] = A4_LANDSCAPE;
const MICROTEXT = "OGSERC CERTIFICATE OF REGISTRATION CERT-01 2026.1 ";
const NOTE =
  "This certificate is evidence of registration only. It is not a licence or permit and does not authorize any activity that requires one (para 13(5)). It remains valid until cancelled under paragraph 14, subject to annual confirmation by 31 January each year (para 16(2)). The registration number must be quoted on all correspondence and filings with the Commission and on customer bills issued in Ogun State (para 13(6)). Any material change must be notified within fourteen (14) days (para 16(1)).";

export interface CertificateContent extends CertificateFields {
  /** Set on a reissued certificate (the issue date stays the original registration date). */
  reissuedOn: IsoDate | null;
  /** Internal verification page the QR code links to; no QR code when null. */
  verifyUrl: string | null;
}

export async function certificatePdf(c: CertificateContent): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument({
    title: `Certificate of Registration ${c.REG_NO}`,
    subject: "Form OGSERC/CERT-01",
    serif: true,
  });
  const page = doc.addPage(A4_LANDSCAPE);
  const background = await doc.embedPng(await asset("certificateBackground"));
  page.drawImage(background, { x: 0, y: 0, width: W, height: H });

  // Readability panel over the guilloche pattern (the pattern still shows through).
  page.drawRectangle({
    x: 58,
    y: 70,
    width: W - 116,
    height: H - 128,
    color: COLOURS.white,
    opacity: 0.72,
  });

  const center = (
    text: string,
    y: number,
    size: number,
    font: PDFFont,
    colour: RGB = COLOURS.black,
  ) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (W - w) / 2, y, size, font, color: colour });
  };

  // Microtext lines (security feature from the template), top and bottom.
  const micro = (y: number) => {
    let line = "";
    while (fonts.regular.widthOfTextAtSize(line + MICROTEXT, 2.5) < W - 90) line += MICROTEXT;
    center(line.trim(), y, 2.5, fonts.regular, COLOURS.green);
  };
  micro(H - 26);
  micro(24);

  // Serial (top left) and form reference (top right).
  const serial = `Certificate Serial No.: ${c.SERIAL}`;
  page.drawText(serial, { x: 64, y: H - 48, size: 8.5, font: fonts.bold, color: COLOURS.grey });
  if (c.reissuedOn) {
    page.drawText(`Reissued ${formatDate(c.reissuedOn)}`, {
      x: 64,
      y: H - 59,
      size: 7.5,
      font: fonts.italic,
      color: COLOURS.grey,
    });
  }
  const form = "Form OGSERC/CERT-01  ·  Version 2026.1";
  page.drawText(form, {
    x: W - 64 - fonts.regular.widthOfTextAtSize(form, 8.5),
    y: H - 48,
    size: 8.5,
    font: fonts.regular,
    color: COLOURS.grey,
  });

  let y = H - 78;
  const line = (text: string, size: number, font: PDFFont, colour: RGB, gap: number) => {
    center(text, y - size, size, font, colour);
    y -= size + gap;
  };
  line(LETTERHEAD.name, 13, fonts.bold, COLOURS.green, 4);
  line("Established under the Ogun State Power Law, 2024", 8.5, fonts.regular, COLOURS.grey, 12);
  line("CERTIFICATE OF REGISTRATION", 25, fonts.bold, COLOURS.gold, 5);
  line(
    "Register of Licensees and Electricity Operators in Ogun State",
    9.5,
    fonts.regular,
    COLOURS.green,
    12,
  );

  // "Registration No.  {{REG_NO}}" — label 11pt, number 13pt bold.
  const label = "Registration No.  ";
  const lw = fonts.regular.widthOfTextAtSize(label, 11);
  const nw = fonts.bold.widthOfTextAtSize(c.REG_NO, 13);
  page.drawText(label, {
    x: (W - lw - nw) / 2,
    y: y - 13,
    size: 11,
    font: fonts.regular,
    color: COLOURS.grey,
  });
  page.drawText(c.REG_NO, {
    x: (W - lw - nw) / 2 + lw,
    y: y - 13,
    size: 13,
    font: fonts.bold,
    color: COLOURS.black,
  });
  y -= 13 + 12;

  line("This is to certify that", 11, fonts.italic, COLOURS.black, 8);

  // Name: shrink to fit (FitText in the Excel), minimum 11pt, then wrap.
  const maxWidth = W - 180;
  const nameSize = fitSize(c.NAME, fonts.bold, 20, 11, maxWidth);
  for (const l of wrap(c.NAME, fonts.bold, nameSize, maxWidth))
    line(l, nameSize, fonts.bold, COLOURS.green, 3);
  y -= 4;

  const cacLine = `RC / Registration No. ${c.CAC}     of     ${c.ADDRESS}`;
  const cacSize = fitSize(cacLine, fonts.bold, 9.5, 7, maxWidth);
  for (const l of wrap(cacLine, fonts.bold, cacSize, maxWidth))
    line(l, cacSize, fonts.bold, COLOURS.grey, 2);
  y -= 8;

  const body =
    "has been entered in the Register of Licensees and Electricity Operators maintained by the Commission under paragraph 15 of the OGSERC Order on Commencement of Operations and Registration of Licensees and Electricity Operators, 2026, with the following particulars:";
  for (const l of wrap(body, fonts.regular, 10, W - 220))
    line(l, 10, fonts.regular, COLOURS.black, 3);
  y -= 8;

  // Particulars.
  const tableW = 560;
  const labelW = 190;
  const x0 = (W - tableW) / 2;
  const rows: [string, string][] = [
    ["Registration category (Schedule 3)", c.CATEGORY],
    ["Primary activity", c.ACTIVITY],
    ["Other activities", c.OTHER],
    ["Principal LGA and service area", c.AREA],
    ["Licence / permit held", c.LICENCE],
  ];
  for (const [rowLabel, value] of rows) {
    // Values keep the template size and wrap; only very long ones (over three lines) shrink.
    let valueSize = 9.5;
    while (
      valueSize > 7.5 &&
      wrap(value, fonts.regular, valueSize, tableW - labelW - 8).length > 3
    ) {
      valueSize -= 0.5;
    }
    const valueLines = wrap(value, fonts.regular, valueSize, tableW - labelW - 8);
    const height = Math.max(1, valueLines.length) * (valueSize + 3) + 5;
    page.drawText(rowLabel, { x: x0, y: y - 11, size: 9, font: fonts.bold, color: COLOURS.green });
    valueLines.forEach((v, i) =>
      page.drawText(v, {
        x: x0 + labelW,
        y: y - 11 - i * (valueSize + 3),
        size: valueSize,
        font: fonts.regular,
        color: COLOURS.black,
      }),
    );
    y -= height;
    page.drawLine({
      start: { x: x0, y: y + 1 },
      end: { x: x0 + tableW, y: y + 1 },
      thickness: 0.4,
      color: COLOURS.gold,
    });
  }
  y -= 14;

  line(
    `Issued at Abeokuta this ${c.DAY} day of ${c.MONTH}, ${c.YEAR}`,
    10,
    fonts.bold,
    COLOURS.black,
    0,
  );

  // Signatures and seal.
  const sigTop = Math.min(y - 30, 150);
  signatureBlock(page, fonts, W * 0.27, sigTop, c.CHAIR_NAME, "Chairman / Chief Executive Officer");
  signatureBlock(page, fonts, W * 0.73, sigTop, c.COMM_NAME, "Commissioner");
  page.drawCircle({
    x: W / 2,
    y: sigTop - 14,
    size: 34,
    borderColor: COLOURS.gold,
    borderWidth: 1,
    opacity: 0,
  });
  centerAt(page, "COMMISSION", W / 2, sigTop - 10, 6.5, fonts.bold, COLOURS.gold);
  centerAt(page, "SEAL", W / 2, sigTop - 19, 6.5, fonts.bold, COLOURS.gold);

  if (c.verifyUrl) drawQr(page, fonts.regular, c.verifyUrl, W - 64 - 56, sigTop - 48, 56);

  // Footer note (7pt).
  let ny = 66;
  for (const l of wrap(NOTE, fonts.italic, 7, W - 160)) {
    centerAt(page, l, W / 2, ny, 7, fonts.italic, COLOURS.grey);
    ny -= 9;
  }
  return doc.save();
}

/**
 * QR code (bottom right, beside the Commissioner's signature) linking to the internal verification
 * page. Drawn as vector squares so it stays sharp in print; medium error correction survives wear.
 */
function drawQr(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const quiet = 2;
  const cell = size / (modules.size + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: COLOURS.white });
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      page.drawRectangle({
        x: x + (col + quiet) * cell,
        y: y + size - (row + quiet + 1) * cell,
        width: cell,
        height: cell,
        color: COLOURS.black,
      });
    }
  }
  centerAt(page, "Scan to verify (OGSERC staff)", x + size / 2, y - 7, 5, font, COLOURS.grey);
}

function centerAt(
  page: PDFPage,
  text: string,
  cx: number,
  y: number,
  size: number,
  font: PDFFont,
  colour: RGB,
) {
  page.drawText(text, {
    x: cx - font.widthOfTextAtSize(text, size) / 2,
    y,
    size,
    font,
    color: colour,
  });
}

function signatureBlock(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  cx: number,
  top: number,
  name: string,
  title: string,
) {
  page.drawLine({
    start: { x: cx - 100, y: top },
    end: { x: cx + 100, y: top },
    thickness: 0.6,
    color: COLOURS.grey,
  });
  const nameSize = fitSize(name, fonts.bold, 9.5, 7, 200);
  centerAt(page, name, cx, top - 13, nameSize, fonts.bold, COLOURS.black);
  centerAt(page, title, cx, top - 25, 9, fonts.regular, COLOURS.black);
  centerAt(
    page,
    "Ogun State Electricity Regulatory Commission",
    cx,
    top - 36,
    8,
    fonts.regular,
    COLOURS.grey,
  );
}
