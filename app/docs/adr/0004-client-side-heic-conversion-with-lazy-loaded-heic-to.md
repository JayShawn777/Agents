# ADR-0004: Convert HEIC to JPEG in the browser, with a lazily loaded `heic-to`

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** Jaysh
- **Accepted:** 2026-08-28
- **Spec:** docs/specs/m1-upload-and-extract.md

## Context

The core user story is a student photographing a worksheet with a phone. On
iPhone that is frequently a HEIC file. Three facts collide
(`docs/research/file-upload-storage.md` §4):

- **No mainstream browser decodes HEIC**, including Safari. We cannot render a
  preview from HEIC bytes.
- **Anthropic's vision API accepts JPEG, PNG, GIF and WebP.** HEIC is not on the
  list, so extraction fails on HEIC input.
- **iOS's automatic transcode to JPEG on `<input type="file">` is real but
  unreliable** — choosing an existing file through the Files app, or using
  certain in-app browsers, still delivers a `.heic`.

M1's acceptance criteria are specific about the mechanism:

- AC 3 — a HEIC upload must result in a **stored JPEG**; no object with
  content type `image/heic`/`image/heif` may exist in the store, and the
  original HEIC bytes must never reach the vision API.
- AC 4 — a HEIC file **renamed to `.jpg`** must still be detected and
  converted. "Extension-based detection alone fails this test."
- AC 5 — for a JPEG or PNG upload, **no HEIC decoder module may be fetched**.

AC 4 rules out extension sniffing. AC 5 rules out a statically imported decoder.
AC 3 rules out doing nothing. This requires a WebAssembly decoder, and therefore
a new dependency the constitution says the owner must approve. The spec marks it
**BLOCKING**.

## Decision

We will **convert HEIC to JPEG in the browser, before upload**, in three
separate, individually unit-testable pieces:

1. **`lib/uploads/sniff-heic.ts` — zero dependencies.** Reads the first 12 bytes
   via `file.slice(0, 12).arrayBuffer()` and returns true when bytes 4–8 are
   ASCII `ftyp` and the brand at bytes 8–12 is one of `heic`, `heix`, `hevc`,
   `hevx`, `heim`, `heis`, `hevm`, `hevs`, `mif1`, `msf1`. It never looks at the
   filename. This is what satisfies AC 4, and it is pure enough to test with
   hand-built `Uint8Array` fixtures — no real HEIC file needed for the unit
   test.
2. **`lib/uploads/convert-heic.ts` — dynamic import only.**
   `const { heicTo } = await import('heic-to')` executes *inside* the conversion
   function, which is called only when the sniffer returns true. That is what
   satisfies AC 5: for a JPEG the module is never referenced, so the bundler
   emits it as a separate chunk that is never requested. Output is
   `image/jpeg` at quality 0.85.
3. **The converted `File` is what `upload()` receives**, with a rewritten name
   (`<base>.jpg`) and `type: 'image/jpeg'`. Because the storage token's
   `allowedContentTypes` excludes `image/heic`/`image/heif` (ADR-0003), an
   unconverted HEIC is rejected by the provider even if the client is
   tampered with — so AC 3's "no HEIC object exists in the store" is enforced
   server-side, not merely by client politeness.

We will use **`heic-to`** rather than `heic2any`.

`accept` on the file input still lists `image/heic,image/heif` (M1 AC 1) so iOS
offers the file, and iOS's own transcode is welcomed when it happens — the
sniffer simply finds a JPEG and skips conversion. `accept` is a convenience, not
a control.

**Failure handling:** if the decoder throws (corrupt file, or iOS Safari running
out of memory on a large HEIC), the panel shows "We couldn't read this photo.
Try taking it again, or change Settings → Camera → Formats to 'Most
Compatible'." and no upload is attempted. We do not fall back to uploading the
HEIC.

**PDF page counting (AC 10) follows the identical pattern** — sniff `%PDF-`,
dynamically import `pdf-lib`, call `getPageCount()`, reject above the configured
limit — so the two lazy-decoder paths share one shape. The server re-validates
the page count at confirm time; the client check is UX only.

## Alternatives considered

### `heic2any`
- **Pros:** Long-standing, widely used, many Stack Overflow answers, wraps
  libheif-wasm.
- **Cons:** Ships as CommonJS with no first-party TypeScript types, so a strict
  project needs a `@types` shim or a declaration file. Larger payload. Its
  worker/blob-URL strategy has historically conflicted with strict Content
  Security Policies.
- **Rejected because:** `heic-to` gives the same capability as ESM with bundled
  types, which matters for `tsc --noEmit` under `strict` and for a clean dynamic
  `import()`. Kept as the immediate drop-in fallback if `heic-to` misbehaves on
  a real device — the swap is confined to `convert-heic.ts`.

### Server-side conversion with `sharp`
- **Pros:** No browser payload at all. One code path regardless of device.
- **Cons:** `sharp`'s prebuilt libvips has limited and awkward HEIC support
  requiring special configuration. On Vercel we would have to pull the file back
  out of Blob into a function — burning duration and data transfer on every
  iPhone upload — and the HEIC bytes would then exist in our infrastructure,
  which is exactly what M1 AC 2's rationale is trying to avoid. It also means
  the stored object is HEIC until a job rewrites it, violating AC 3's "no HEIC
  object exists in the store".
- **Rejected because:** it fails AC 3 as literally written and moves a minor's
  file back through our functions.

### Rely on iOS's automatic transcode; add nothing
- **Pros:** Zero dependency, zero payload, zero code.
- **Cons:** Documented as unreliable — it does not fire for files picked through
  the Files app or in some in-app browsers. The failure is silent and
  device-specific, so it will pass every test we write and fail for real
  students.
- **Rejected because:** the research names it as not an alternative, and AC 4
  describes precisely the case where it does not fire.

### Canvas-only conversion, no wasm decoder
- **Pros:** No dependency.
- **Cons:** Factually impossible. Canvas cannot decode what the browser cannot
  decode; canvas is only the encode half. The research flags this as a common
  incorrect suggestion online.
- **Rejected because:** it does not work.

### Reject HEIC uploads and tell the student to change a phone setting
- **Pros:** No dependency, no wasm, no conversion bug surface.
- **Cons:** Directly contradicts the user story "As a student on an iPhone, I
  want my photo to just work, so that I do not have to know what HEIC is", and
  would block a large share of the target users at the first screen.
- **Rejected because:** it converts the product's easiest moment into its
  hardest one. It survives only as the error message when decoding genuinely
  fails.

## Consequences

### Positive
- The stored object is already in an AI-ready format, so extraction, preview
  rendering and any future re-read all work with no conversion step.
- Bytes usually shrink before hitting the network.
- No server CPU and no function duration spent on image decoding.
- Detection is magic-byte based, so a mislabelled file is handled correctly
  (AC 4), and the detector is dependency-free and cheap to test.

### Negative / accepted trade-offs
- A sizeable WebAssembly decoder is downloaded by iPhone users on their first
  HEIC upload. Lazy loading confines the cost to exactly those users
  (AC 5) but does not remove it, and it lands on the slowest connections.
- Decoding a 6–12 MP HEIC in JavaScript on an older iPhone is slow and
  memory-hungry; it may fail. We show a real message rather than pretending.
- Re-encoding to JPEG at quality 0.85 is lossy, and extraction accuracy on faint
  pencil handwriting depends on that quality setting. It is a single constant in
  `lib/config.ts` so it can be tuned against real worksheets.
- Two lazily loaded decoders (`heic-to`, `pdf-lib`) to keep out of the main
  bundle. A bundle-size assertion in the e2e suite guards AC 5 against a future
  accidental static import.

### Follow-up required
- [ ] Owner approval for `heic-to` and `pdf-lib`.
- [ ] Commit a real `.heic` fixture and a copy of it renamed `.jpg` for the
      Playwright specs covering AC 3 and AC 4.
- [ ] Manual verification on a physical iPhone (Safari) and on an Android
      Chrome device before M1 is called done; emulated browsers do not exercise
      the real decoder path or the real memory ceiling.
- [ ] Measure the emitted chunk size for `heic-to` and record it, so a
      regression is visible.

## Revisit when

Browsers ship native HEIC decoding (at which point the dependency can be
dropped behind a capability check); or device telemetry shows conversion
failures or timeouts above a few percent; or a future milestone needs the
original, unre-encoded image, which would force server-side conversion and
supersede this.
