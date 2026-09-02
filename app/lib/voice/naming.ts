import "server-only";

/**
 * What the VENDOR is allowed to see about a cloned voice.
 *
 * `POST /v1/voices/add` requires a `name`, and that name is stored at the vendor
 * alongside a model of a real person's voice, for as long as the voice exists.
 * The obvious implementation — pass the label the parent typed, which is
 * typically a real first name ("Mum", "Dad", "Sarah") — would ship a person's
 * name to a third party next to their biometric-adjacent voiceprint, for no
 * functional benefit: nothing in this application ever reads the vendor's name
 * field back. We resolve labels from our own `Persona` row.
 *
 * So the vendor gets an opaque, account-scoped token and nothing else.
 *
 * This is the same discipline as M5 AC 12 (the narration request carries text,
 * model and voice id, and no identifiers), applied where the stakes are higher.
 * The M6 spec's data table rates the sample "very high — biometric-adjacent;
 * uniquely identifies a person"; adding a name to it is the difference between
 * a voiceprint and an identified voiceprint.
 */

/**
 * The vendor-visible voice name.
 *
 * `m6-<customVoiceId>` — our own cuid, which identifies the row and nothing
 * about the human. It is stable (so an operator can match a vendor voice to our
 * record when reconciling), meaningless to anyone without our database, and
 * contains no name, no email and no child.
 *
 * **Never pass user input to this.** It takes an id we generated, deliberately:
 * a signature that accepted a label would be one careless call away from
 * shipping "Mum" to the vendor.
 */
export function vendorVoiceName(customVoiceId: string): string {
  return `m6-${customVoiceId}`;
}

/**
 * The filename in the multipart part. A generic constant plus the format's
 * extension — never the parent's own filename, which on a phone recording is
 * routinely "Sarah's voice memo.m4a".
 *
 * The extension is kept because the vendor uses it to sniff the format, and a
 * mismatch there is a confusing failure rather than a private one.
 */
export function vendorSampleFilename(contentType: string): string {
  return `sample.${extensionForContentType(contentType)}`;
}

/**
 * The formats this app accepts from an in-app recorder, and what to call each.
 *
 * Browsers disagree about what `MediaRecorder` produces — Chrome and Firefox
 * give `audio/webm`, Safari gives `audio/mp4` — so all of them are here rather
 * than forcing a conversion step into the browser.
 */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

/** The allowlist itself, for the API boundary's own validation. */
export const ACCEPTED_VOICE_CONTENT_TYPES = Object.keys(EXTENSION_BY_CONTENT_TYPE);

export function isAcceptedVoiceContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(";")[0].trim() in EXTENSION_BY_CONTENT_TYPE;
}

/**
 * Falls back to `bin` rather than throwing. A content type that reached here
 * unrecognised has already passed the API boundary's allowlist, so the useful
 * behaviour is a vendor call that fails clearly rather than a crash inside a
 * parent's recording flow — and `bin` cannot be mistaken for a real format.
 */
function extensionForContentType(contentType: string): string {
  const normalised = contentType.toLowerCase().split(";")[0].trim();
  return EXTENSION_BY_CONTENT_TYPE[normalised] ?? "bin";
}
