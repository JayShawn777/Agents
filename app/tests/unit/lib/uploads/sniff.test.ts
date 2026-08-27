import { describe, expect, it } from "vitest";

import { sniffFileKind, sniffIsHeic } from "@/lib/uploads/sniff";

function fileFromBytes(bytes: number[], name: string, type = "application/octet-stream"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const PDF_HEADER = [...Buffer.from("%PDF-1.4\nrest of file")];

function webpHeader(): number[] {
  const bytes = new Array(16).fill(0);
  const riff = [...Buffer.from("RIFF")];
  const webp = [...Buffer.from("WEBP")];
  riff.forEach((b, i) => (bytes[i] = b));
  // bytes 4-8 are the RIFF chunk size — arbitrary for a header-only fixture.
  webp.forEach((b, i) => (bytes[8 + i] = b));
  return bytes;
}

function heicHeader(brand: string): number[] {
  const bytes = new Array(12).fill(0);
  const ftyp = [...Buffer.from("ftyp")];
  const brandBytes = [...Buffer.from(brand)];
  ftyp.forEach((b, i) => (bytes[4 + i] = b));
  brandBytes.forEach((b, i) => (bytes[8 + i] = b));
  return bytes;
}

describe("sniffIsHeic", () => {
  it("detects a HEIC ftyp box regardless of filename or declared type", async () => {
    const file = fileFromBytes(heicHeader("heic"), "photo.jpg", "image/jpeg");
    expect(await sniffIsHeic(file)).toBe(true);
  });

  it("recognizes every documented HEIC/HEIF brand", async () => {
    const brands = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];
    for (const brand of brands) {
      const file = fileFromBytes(heicHeader(brand), "photo.heic");
      expect(await sniffIsHeic(file)).toBe(true);
    }
  });

  it("returns false for a non-HEIC ftyp brand (e.g. a plain MP4)", async () => {
    const file = fileFromBytes(heicHeader("isom"), "video.mp4");
    expect(await sniffIsHeic(file)).toBe(false);
  });

  it("returns false for a JPEG", async () => {
    const file = fileFromBytes(JPEG_HEADER, "photo.jpg", "image/jpeg");
    expect(await sniffIsHeic(file)).toBe(false);
  });

  it("returns false for a file shorter than the ftyp box", async () => {
    const file = fileFromBytes([0x00, 0x01], "tiny.bin");
    expect(await sniffIsHeic(file)).toBe(false);
  });
});

describe("sniffFileKind", () => {
  it("identifies JPEG by magic bytes", async () => {
    expect(await sniffFileKind(fileFromBytes(JPEG_HEADER, "a.jpg"))).toBe("image/jpeg");
  });

  it("identifies PNG by magic bytes", async () => {
    expect(await sniffFileKind(fileFromBytes(PNG_HEADER, "a.png"))).toBe("image/png");
  });

  it("identifies WEBP by the RIFF/WEBP container", async () => {
    expect(await sniffFileKind(fileFromBytes(webpHeader(), "a.webp"))).toBe("image/webp");
  });

  it("identifies PDF by the %PDF- signature", async () => {
    expect(await sniffFileKind(fileFromBytes(PDF_HEADER, "a.pdf"))).toBe("application/pdf");
  });

  it("identifies HEIC by ftyp brand", async () => {
    expect(await sniffFileKind(fileFromBytes(heicHeader("heic"), "a.heic"))).toBe("image/heic");
  });

  /**
   * M1 AC 4, the whole reason this module exists: a HEIC file renamed to
   * end in `.jpg`, with the browser reporting `image/jpeg` as its type
   * (exactly what an attacker or a confused OS could produce), must still
   * be detected as HEIC. Extension-based detection alone fails this test.
   */
  it("detects a HEIC file mislabelled with a .jpg extension and image/jpeg type", async () => {
    const mislabelled = fileFromBytes(heicHeader("heic"), "vacation.jpg", "image/jpeg");
    expect(await sniffFileKind(mislabelled)).toBe("image/heic");
  });

  it("returns null for an unrecognized file type (e.g. plain text)", async () => {
    const file = fileFromBytes([...Buffer.from("just some text, not a real file")], "notes.txt", "text/plain");
    expect(await sniffFileKind(file)).toBeNull();
  });

  it("returns null for an empty file", async () => {
    const file = fileFromBytes([], "empty.bin");
    expect(await sniffFileKind(file)).toBeNull();
  });
});
