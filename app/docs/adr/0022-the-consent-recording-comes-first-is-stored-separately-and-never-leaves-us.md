# ADR-0022: The consent recording is made before the sample, stored separately, and never leaves us

- **Status:** Proposed
- **Date:** 2026-10-12
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m6-custom-voice.md (AC 4, 5, 6, 7, 9, 11, 21)
- **Plan:** docs/plans/m6-custom-voice-implementation.md (§3, §3.1, slice 4 and 5)

## Context

M6 clones the voice of a real adult. The plan required this ADR before its
slices; it is written after the fact, from the code that shipped, so it records
what is true rather than what was intended. Where the shipped design departs from
the plan, the departure is named.

Three things force a decision:

1. **What proves the speaker agreed?** Cloning is irreversible in effect — a
   model of a person's voice exists at a third party until we delete it.
2. **What is the audio, and where does it live?** There are two recordings per
   voice with opposite lifecycles: the *sample* (the clone's raw material) and
   the *consent statement* (evidence the speaker agreed).
3. **How do bytes reach storage without passing through our origin?** M1 mints no
   upload URLs; it uses the storage provider's client-token protocol.

## Decision

**1. Consent first, enforced on the server.** `issueSampleGrant` refuses unless
the caller owns a `VoiceConsentRecording` at the *current* wording version that no
voice has yet consumed. The UI follows the same order, but the ordering is a
property of the API, so a client that skips a step is refused rather than trusted.
`createCustomVoice` re-checks at the last moment before bytes leave us.

**2. One recording authorises exactly one clone.** The usable-recording filter is
`{ consentWordingVersion: CURRENT, customVoice: { is: null } }`. A second voice
needs its own spoken statement. The wording is versioned in
`lib/voice/consent-copy.ts`; changing a word bumps the version in the same diff.

**3. Two prefixes, two lifecycles.**
`users/<userId>/voice-consent/<uuid>.<ext>` is kept as evidence under
`VOICE_CONSENT_RECORDING` retention. `users/<userId>/voice-sample/<uuid>.<ext>` is
deleted as soon as the clone exists (`VOICE_SAMPLE_RETENTION_DAYS = 0`), with the
retention job as the backstop and the blob reconciler covering both prefixes.

**4. The consent recording never leaves us.** It is not sent to the vendor, not
played to a student, not transcribed and not analysed. Only the sample is
transmitted. The spoken statement is evidence for *us*, answering "was this
authorised", not an input to anyone's system. Tests and the privacy copy both say
so.

**5. Upload by grant, with the pathname server-chosen and matched exactly.** The
browser asks endpoint 48 or 50 for `{ grantId, pathname }`, then calls the
provider's `upload()`, which POSTs to `/api/blob/upload` carrying
`{ voiceGrantId }`. `authorizeVoiceUpload` requires the requested pathname to
equal the grant's own, `addRandomSuffix: false`, and a voice-only content-type
allowlist and size cap. Both payload shapes are `.strict()`, so a body naming a
student profile *and* a voice grant matches neither (AC 3 by construction). No
request to our origin carries audio bytes.

**6. Recorded server-side facts.** IP and user agent are read from request
headers, never the body (AC 7). The vendor voice id is stamped on the recording
once creation succeeds. A `VoiceCreationAudit` row with no foreign keys survives
every purge.

## Departures from the plan

- **No `ParentalConsent` row, no `ConsentScope.VOICE_CLONING` write.** The plan's
  §2.2/AC 8 appended one per grant. That table is COPPA machinery about a *child*
  (it needs a `studentProfileId` and a `directNoticeId`), and COPPA's
  verifiable-consent regime governs information collected from a child under 13.
  This is an adult consenting about themselves, at account level. Azure models
  the same thing as its own entity holding talent name, locale and audio, which is
  what `VoiceConsentRecording` is. `parentalConsentId` stays as a nullable seam.
- **Endpoints 48 and 50 return `{ grantId, pathname }`, not `{ uploadUrl, … }`.**
  See the plan's slice 5 correction. `StoragePort` has no write-URL method and
  gains none.

## Alternatives considered

### Signed write URLs on `StoragePort`
- **Pros:** Matches the plan's original table.
- **Cons:** A second upload path to secure, two adapter implementations, for a flow
  that runs a few times per account.
- **Rejected because:** Reusing M1's client-token protocol gives the same
  guarantee (no audio through our origin) with one path.

### Send the consent recording to the vendor as well
- **Rejected because:** It would hand a third party an artifact whose only purpose
  is our own accountability, for no benefit.

### One shared grant for consent and sample
- **Rejected because:** Different bounds, different retention, different deletion.

## Consequences

### Positive
- Skipping consent is impossible at the API, not merely hidden in the UI.
- The most sensitive object we hold (the sample) is short-lived by construction.

### Negative / accepted trade-offs
- **AC 4's honest limit.** A server-chosen pathname plus a single-use grant refuses
  pointing us at some other stored object. It **cannot prove the bytes came from a
  microphone**, and we do not claim it does. The control against a child cloning a
  classmate is that no student-facing surface reaches this flow (AC 2/3).
- A lawyer has not reviewed the consent wording. Pre-launch task.

### Follow-up required
- [ ] Counsel reviews `VOICE_CONSENT_LINES` before launch.
- [ ] If localisation is ever added, store the spoken locale beside the recording.

## Revisit when
We add a second adult per account, a student-facing capture surface (M8), or a
vendor that can verify liveness.
