import "server-only";

import { z } from "zod";

/**
 * M6's vendor client — the only file in the application that knows how to
 * CREATE or DELETE a voice at ElevenLabs. `lib/narration/provider.ts` is its
 * sibling and owns synthesis; the two are deliberately separate files because
 * they need different credentials (see below) and carry very different risk.
 *
 * Plain `fetch`, no SDK, for the same reason ADR-0020 gives for narration: the
 * measurement that proved this vendor does what we need
 * (`docs/research/m6-voice-clone-measurement.md`) was taken with `fetch`, so
 * production exercises the wire path that was actually measured. Adding
 * `@elevenlabs/elevenlabs-js` is a new major dependency and needs the owner's
 * approval; nothing here requires it.
 *
 * ## Two keys, and why this file reads a different one
 *
 * `resolveVoiceAdminKey()` prefers `ELEVENLABS_VOICE_ADMIN_KEY` and falls back
 * to `ELEVENLABS_API_KEY`.
 *
 * The narration key runs on every lesson, every step — thousands of calls, in
 * server logs, error traces and deploy environments. This file's operations run
 * only when an account owner creates or deletes a voice. Measured 2026-09-02,
 * the single key currently in `.env` carries `voices_write`, which means the
 * high-traffic narration credential can also **delete every voice on the
 * account** — and because `VOICE_SAMPLE_RETENTION_DAYS` is 0, a deleted voice
 * cannot be regenerated without the parent recording themselves again.
 *
 * The fallback exists so this works today with one key. Setting the admin key
 * and removing `voices_write` from the narration key is a config change with no
 * code change, and it moves the one unrecoverable power onto the credential that
 * is least exposed.
 *
 * ## What this file must never do
 *
 * **Never log a response body or an error object.** A create request's body
 * carries a real person's voice; a failure body can echo request detail back.
 * Same rule as the narration provider, for a subject that is arguably more
 * sensitive: this is biometric-adjacent data about a named adult.
 */

const API_BASE = "https://api.elevenlabs.io";

/**
 * The vendor's create response. Only the fields we actually rely on — a schema
 * that accepted everything would let a shape change pass silently.
 *
 * `requires_fine_tuning` is the vendor's own signal that a voice needs further
 * work before use. The 2026-09-02 measurement observed `requires_verification:
 * false` on the create response and an immediately usable voice, so AC 13's
 * pending state is a DEFENSIVE branch. Both fields are optional here because a
 * vendor may add, rename or drop either without warning, and a missing flag must
 * mean "no verification needed" rather than crashing a parent's flow.
 */
const CreateVoiceResponseSchema = z.object({
  voice_id: z.string().min(1),
  requires_verification: z.boolean().optional(),
});

export type CreateVoiceInput = {
  /**
   * The vendor-visible name. **Never a child's name and never an email** — the
   * caller passes an account-scoped label, and `lib/voice/naming.ts`'s
   * `vendorVoiceName` is the only thing that should produce it.
   */
  name: string;
  /** The raw sample bytes, read from our own private blob store. */
  sample: ArrayBuffer;
  /** The sample's MIME type, so the vendor gets a correctly typed part. */
  sampleContentType: string;
  /** The filename in the multipart part. Deliberately generic — see `vendorSampleFilename`. */
  sampleFilename: string;
};

export type CreateVoiceSuccess = {
  ok: true;
  providerVoiceId: string;
  /** AC 13. `false` in every measured case; carried through rather than assumed. */
  requiresVerification: boolean;
};

/**
 * `QUOTA` is separated from `UPSTREAM` because it is the one failure a parent
 * can do nothing about and we can: it means the account's voice slots are full.
 * The spec's still-unanswered open question — how many voices the plan allows —
 * is exactly this condition, and lumping it into UPSTREAM would hide the signal
 * that answers it.
 */
export type VoiceFailureCode = "TIMEOUT" | "RATE_LIMITED" | "QUOTA" | "UNAUTHORIZED" | "UPSTREAM" | "INTERNAL";

export type VoiceFailure = {
  ok: false;
  failureCode: VoiceFailureCode;
  retryable: boolean;
};

export type CreateVoiceResult = CreateVoiceSuccess | VoiceFailure;

export type DeleteVoiceSuccess = { ok: true; alreadyGone: boolean };
export type DeleteVoiceResult = DeleteVoiceSuccess | VoiceFailure;

/** See the module docstring. Exported for the config-shape test, not for callers. */
export function resolveVoiceAdminKey(): string | undefined {
  return process.env.ELEVENLABS_VOICE_ADMIN_KEY || process.env.ELEVENLABS_API_KEY || undefined;
}

/**
 * Creates a voice from a sample. **One HTTP round trip, no retry** — retry
 * policy belongs to the caller, which is the only thing that knows whether a
 * second attempt would double-charge a voice slot.
 *
 * The multipart body carries exactly `name` and `files`. No profile id, no
 * lesson id, no email, no child's name — the same discipline M5 AC 12 applies
 * to narration text, and for a stronger reason here.
 */
export async function createVoice(
  input: CreateVoiceInput,
  opts?: { signal?: AbortSignal; apiKey?: string },
): Promise<CreateVoiceResult> {
  const apiKey = opts?.apiKey ?? resolveVoiceAdminKey();
  if (!apiKey) {
    console.error("createVoice: no ELEVENLABS_VOICE_ADMIN_KEY or ELEVENLABS_API_KEY is set.");
    return { ok: false, failureCode: "INTERNAL", retryable: false };
  }

  const form = new FormData();
  form.append("name", input.name);
  form.append(
    "files",
    new Blob([new Uint8Array(input.sample)], { type: input.sampleContentType }),
    input.sampleFilename,
  );

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/voices/add`, {
      method: "POST",
      // No `content-type` header: `fetch` sets the multipart boundary itself,
      // and setting it by hand produces a body the vendor cannot parse.
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: opts?.signal,
    });
  } catch (err) {
    // Never `console.error(err)` — a fetch error can carry request context, and
    // this request's body is a recording of a real person's voice.
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, failureCode: "TIMEOUT", retryable: true };
    }
    console.error("createVoice: network failure calling the voice vendor.");
    return { ok: false, failureCode: "UPSTREAM", retryable: true };
  }

  if (!response.ok) return { ok: false, ...classifyFailure(response.status) };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A 200 we cannot parse is the worst case here: a voice may exist at the
    // vendor that we have no id for. Not retryable — a second attempt would
    // create a SECOND voice rather than recovering the first.
    console.error("createVoice: vendor returned 200 with an unparseable body; a voice may be orphaned.");
    return { ok: false, failureCode: "UPSTREAM", retryable: false };
  }

  const parsed = CreateVoiceResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error("createVoice: vendor returned 200 with an unrecognised shape; a voice may be orphaned.");
    return { ok: false, failureCode: "UPSTREAM", retryable: false };
  }

  return {
    ok: true,
    providerVoiceId: parsed.data.voice_id,
    requiresVerification: parsed.data.requires_verification ?? false,
  };
}

/**
 * Deletes a voice at the vendor — AC 19/20's "a deletion that stops at our
 * database is not a deletion".
 *
 * **A voice that is already gone is a SUCCESS, not an error** (`alreadyGone`).
 * Every caller of this is trying to reach a state, not perform an event: if the
 * voice is not there, the state is reached. Treating it as a failure would make
 * a retried deletion fail forever and leave a `VENDOR_DELETE_FAILED` audit row
 * claiming residue that does not exist.
 *
 * The measurement recorded how this vendor says "gone": **HTTP 400 with a typed
 * `voice_not_found` body**, not a 404. The check keys on both, because the
 * status alone was the thing that was wrong — the measurement's own first run
 * reported a successful deletion as UNCERTAIN for exactly this reason.
 */
export async function deleteVoice(
  providerVoiceId: string,
  opts?: { signal?: AbortSignal; apiKey?: string },
): Promise<DeleteVoiceResult> {
  const apiKey = opts?.apiKey ?? resolveVoiceAdminKey();
  if (!apiKey) {
    console.error("deleteVoice: no ELEVENLABS_VOICE_ADMIN_KEY or ELEVENLABS_API_KEY is set.");
    return { ok: false, failureCode: "INTERNAL", retryable: false };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/voices/${encodeURIComponent(providerVoiceId)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
      signal: opts?.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, failureCode: "TIMEOUT", retryable: true };
    }
    console.error("deleteVoice: network failure calling the voice vendor.");
    return { ok: false, failureCode: "UPSTREAM", retryable: true };
  }

  if (response.ok) return { ok: true, alreadyGone: false };

  if (response.status === 404 || (await isVoiceNotFound(response))) {
    return { ok: true, alreadyGone: true };
  }

  return { ok: false, ...classifyFailure(response.status) };
}

/**
 * Whether a non-OK response is this vendor's "no such voice". Reads the body
 * only to inspect the typed code — never logs it.
 */
async function isVoiceNotFound(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    const body = (await response.clone().json()) as { detail?: { status?: string } } | null;
    return body?.detail?.status === "voice_not_found";
  } catch {
    return false;
  }
}

function classifyFailure(status: number): { failureCode: VoiceFailureCode; retryable: boolean } {
  if (status === 401 || status === 403) {
    // Almost always a scope problem rather than a transient one — most likely
    // `voices_write` missing from whichever key was resolved. Retrying cannot
    // fix a permission, and the message must reach an operator, not a parent.
    console.error(
      "voice provider: vendor rejected the credential (missing voices_write?). " +
        "See app/CLAUDE.md on ELEVENLABS_VOICE_ADMIN_KEY.",
    );
    return { failureCode: "UNAUTHORIZED", retryable: false };
  }
  if (status === 429) return { failureCode: "RATE_LIMITED", retryable: true };
  // The vendor uses 422 for a body it will not accept, which for a create
  // includes "no voice slots left". A retry cannot create room.
  if (status === 422) return { failureCode: "QUOTA", retryable: false };
  return { failureCode: "UPSTREAM", retryable: status >= 500 };
}
