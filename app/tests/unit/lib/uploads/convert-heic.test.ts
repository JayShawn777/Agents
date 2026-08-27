import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `heic-to` ships a real WebAssembly decoder that needs browser APIs this
 * Vitest environment (`node`, per `vitest.config.mts`) doesn't have —
 * mocked here the same way the codebase already mocks `@/lib/db` and
 * `next/headers` in service-layer tests (see `tests/unit/lib/notice/service.test.ts`).
 * This also documents the exact contract `convert-heic.ts` depends on:
 * `heicTo({ blob, type, quality }) => Promise<Blob>`.
 */
const heicToMock = vi.fn();
vi.mock("heic-to", () => ({ heicTo: heicToMock }));

const { convertHeicToJpeg, HeicConversionError } = await import("@/lib/uploads/convert-heic");
const { HEIC_JPEG_QUALITY } = await import("@/lib/config");

function heicFile(name = "photo.heic"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/heic" });
}

describe("convertHeicToJpeg", () => {
  beforeEach(() => {
    heicToMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts using HEIC_JPEG_QUALITY and returns a JPEG File", async () => {
    const jpegBlob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    heicToMock.mockResolvedValue(jpegBlob);

    const result = await convertHeicToJpeg(heicFile("vacation.heic"));

    expect(heicToMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/jpeg", quality: HEIC_JPEG_QUALITY }),
    );
    expect(result).toBeInstanceOf(File);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("vacation.jpg");
  });

  it("strips any existing extension and appends .jpg", async () => {
    heicToMock.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));

    const result = await convertHeicToJpeg(heicFile("IMG_0001.HEIC"));

    expect(result.name).toBe("IMG_0001.jpg");
  });

  /**
   * ADR-0004: "We do not fall back to uploading the HEIC." A decode
   * failure (corrupt file, out-of-memory decode) must throw a
   * `HeicConversionError` with the exact specified user-facing copy, never
   * resolve with the original bytes.
   */
  it("throws HeicConversionError, never the original file, when decoding fails", async () => {
    heicToMock.mockRejectedValue(new Error("libheif: corrupt bitstream"));

    await expect(convertHeicToJpeg(heicFile())).rejects.toBeInstanceOf(HeicConversionError);
  });

  it("HeicConversionError never leaks the underlying exception's message", async () => {
    heicToMock.mockRejectedValue(new Error("some internal wasm panic with a stack trace"));

    try {
      await convertHeicToJpeg(heicFile());
      expect.unreachable("expected convertHeicToJpeg to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HeicConversionError);
      expect((err as Error).message).not.toContain("wasm panic");
      expect((err as Error).message).toContain("Try taking it again");
    }
  });
});
