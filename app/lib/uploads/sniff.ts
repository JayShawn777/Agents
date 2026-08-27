/**
 * Magic-byte file-type detection (plan §5.2, F14; M1 AC 4, 5; ADR-0004).
 * Pure — no React, no network, and critically, no filename or `File.type`
 * inspection. Every function here reads only the bytes at the front of the
 * file, which is what makes a HEIC file renamed to end in `.jpg` still
 * detected as HEIC (M1 AC 4: "Extension-based detection alone fails this
 * test").
 *
 * Kept dependency-free on purpose (ADR-0004: "`lib/uploads/sniff-heic.ts` —
 * zero dependencies"), so nothing in this module can be the reason a HEIC
 * decoder chunk gets fetched for a JPEG upload (M1 AC 5) — that risk lives
 * entirely in `convert-heic.ts`'s dynamic `import()`, which this module
 * never touches.
 */

import type { AcceptedPickerType } from "@/lib/config";

/**
 * ISO base media file format "ftyp" box brands that indicate HEIC/HEIF
 * (ADR-0004's exact list). `heic`/`heix`/`hevc`/`hevx`/`heim`/`heis`/
 * `hevm`/`hevs` are the HEIC-photo brands; `mif1`/`msf1` are generic HEIF
 * containers. Both convert the same way, so `sniffFileKind` reports both as
 * `"image/heic"` — there is no downstream code path that needs to tell them
 * apart.
 */
const HEIC_FTYP_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

async function readHeader(file: File, byteCount: number): Promise<Uint8Array> {
  const buf = await file.slice(0, byteCount).arrayBuffer();
  return new Uint8Array(buf);
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/**
 * True when the first 12 bytes contain an ISOBMFF `ftyp` box (bytes 4-8)
 * whose brand (bytes 8-12) is a HEIC/HEIF brand. Never looks at `file.name`
 * or `file.type` (M1 AC 4).
 */
export async function sniffIsHeic(file: File): Promise<boolean> {
  const header = await readHeader(file, 12);
  if (header.length < 12) return false;
  if (asciiAt(header, 4, 8) !== "ftyp") return false;
  return HEIC_FTYP_BRANDS.has(asciiAt(header, 8, 12));
}

/**
 * The picker-accepted MIME type this file's BYTES actually are, or `null`
 * if they match none of `ACCEPTED_PICKER_TYPES` (`lib/config.ts`). Checked
 * purely from magic bytes — HEIC first (since a mislabelled HEIC is the
 * whole point of AC 4), then the JPEG/PNG/WEBP/PDF signatures the server
 * ultimately allows.
 */
export async function sniffFileKind(file: File): Promise<AcceptedPickerType | null> {
  if (await sniffIsHeic(file)) return "image/heic";

  const header = await readHeader(file, 12);

  // JPEG: FF D8 FF
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (header.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => header[i] === byte)) {
    return "image/png";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (header.length >= 12 && asciiAt(header, 0, 4) === "RIFF" && asciiAt(header, 8, 12) === "WEBP") {
    return "image/webp";
  }

  // PDF: "%PDF-"
  if (header.length >= 5 && asciiAt(header, 0, 5) === "%PDF-") {
    return "application/pdf";
  }

  return null;
}
