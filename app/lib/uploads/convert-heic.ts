/**
 * Client-side HEIC → JPEG conversion (plan §5.2, F14; M1 AC 3; ADR-0004).
 *
 * `heic-to` (a sizeable WebAssembly decoder) is imported ONLY inside
 * `convertHeicToJpeg`, and this function is only ever called by
 * `components/uploads/upload-panel.tsx` after `sniffIsHeic()`
 * (`lib/uploads/sniff.ts`) has already returned `true` for the selected
 * file — never on a JPEG/PNG/WebP/PDF path. That is the mechanism behind
 * M1 AC 5: a non-HEIC upload never causes the bundler-emitted decoder chunk
 * to be requested, because the `import()` expression is never evaluated.
 */

import { HEIC_JPEG_QUALITY } from "@/lib/config";

/**
 * The exact user-facing copy ADR-0004 specifies for a decode failure
 * (corrupt file, or the browser running out of memory on a large HEIC).
 * Never an exception message — ADR-0004 is explicit that there is no
 * fallback to uploading the original HEIC bytes.
 */
export class HeicConversionError extends Error {
  constructor() {
    super(
      "We couldn't read this photo. Try taking it again, or change Settings → Camera → Formats to \"Most Compatible\".",
    );
    this.name = "HeicConversionError";
  }
}

function jpegFilename(originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, "");
  return `${base || "photo"}.jpg`;
}

/**
 * Converts a HEIC `File` to a JPEG `File` at `HEIC_JPEG_QUALITY`
 * (`lib/config.ts`, ADR-0004). Throws `HeicConversionError` — never
 * resolves with the original HEIC bytes — if the dynamic import or the
 * decode itself fails.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  let heicTo: typeof import("heic-to").heicTo;
  try {
    ({ heicTo } = await import("heic-to"));
  } catch {
    throw new HeicConversionError();
  }

  let blob: Blob;
  try {
    blob = await heicTo({ blob: file, type: "image/jpeg", quality: HEIC_JPEG_QUALITY });
  } catch {
    throw new HeicConversionError();
  }

  return new File([blob], jpegFilename(file.name), { type: "image/jpeg" });
}
