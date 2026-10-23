import { readFile } from "node:fs/promises";
import path from "node:path";

// Fonts and images for generated PDFs. DejaVu fonts (free licence, assets/fonts/LICENSE-DejaVu.txt)
// include the naira sign, which the 14 standard PDF fonts do not.

const ASSETS = path.join(process.cwd(), "assets");

const FILES = {
  sans: "fonts/DejaVuSans.ttf",
  sansBold: "fonts/DejaVuSans-Bold.ttf",
  sansItalic: "fonts/DejaVuSans-Oblique.ttf",
  serif: "fonts/DejaVuSerif.ttf",
  serifBold: "fonts/DejaVuSerif-Bold.ttf",
  serifItalic: "fonts/DejaVuSerif-Italic.ttf",
  logo: "ogserc-logo.png",
  certificateBackground: "cert-security-background.png",
} as const;

export type AssetName = keyof typeof FILES;

const cache = new Map<AssetName, Promise<Uint8Array>>();

/** Read an asset once per process. */
export function asset(name: AssetName): Promise<Uint8Array> {
  let bytes = cache.get(name);
  if (!bytes) {
    bytes = readFile(path.join(ASSETS, FILES[name]));
    cache.set(name, bytes);
  }
  return bytes;
}
