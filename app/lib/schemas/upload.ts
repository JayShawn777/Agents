/**
 * zod input schemas for the upload flow (plan §3, endpoints 14-18):
 * `POST /api/blob/upload`, `POST /api/uploads/confirm`,
 * `GET|DELETE /api/uploads/[uploadId]`, `GET .../preview-url`.
 */

import { z } from "zod";

// ─────────────────────────── POST /api/blob/upload (#14) ───────────────────────────

/**
 * The overall request body for a `blob.generate-client-token` /
 * `blob.upload-completed` round trip is defined and validated by
 * `@vercel/blob`'s own `handleUpload()` (B16, `lib/storage/vercel-blob.ts`) —
 * that discriminated-on-`type` envelope is a provider detail, not ours to
 * duplicate here.
 *
 * `clientPayload` is OUR external input inside that envelope: an
 * attacker-controlled, JSON-stringified string the client attaches to its
 * token request. This is the one shape from endpoint 14 that must be parsed
 * with zod before use (plan §3, #14).
 */
export const uploadClientPayloadSchema = z
  .object({
    studentProfileId: z.cuid(),
    originalFilename: z.string().min(1).max(255),
  })
  .strict();

export type UploadClientPayload = z.infer<typeof uploadClientPayloadSchema>;

// ─────────────────────────── POST /api/uploads/confirm (#15) ───────────────────────────

export const confirmUploadInputSchema = z
  .object({
    studentProfileId: z.cuid(),
    pathname: z.string().max(512),
    originalFilename: z.string().min(1).max(255),
  })
  .strict();

export type ConfirmUploadInput = z.infer<typeof confirmUploadInputSchema>;

// ─────────────────────────── GET|DELETE /api/uploads/[uploadId] (#16, #17) ───────────────────────────
// ─────────────────────────── GET .../preview-url (#18) ───────────────────────────
// No request bodies — the id comes from the route param, validated by the DAL
// (`requireUpload`), not by a body schema.
