# Handover — 2026-09-02

Written because the session kept crashing. **Delete this file once the next
session has read it and folded anything durable into `app/CLAUDE.md`.**

Read `app/CLAUDE.md` "Where the build is" first — it is the real handoff and is
current. This file only covers what happened after it was last updated.

---

## 0. HOW TO RUN TESTS — owner-agreed 2026-09-02, follow this

The previous session crashed three times. It ran the FULL suite (~2 min) after
almost every change, dozens of times. That is the habit to drop.

**Agreed cadence:**

- **During a slice** — run only the tests for the files you touched:
  `pnpm exec vitest run --project unit tests/unit/lib/<area>/`
- **Once, at the end of a slice, before committing** — the full chain:
  `pnpm typecheck && pnpm lint && pnpm test --run`
- **Do not** re-run a passing full suite to "confirm" it. It passed.
- Prefer `--project unit` for fast feedback; the integration project needs the
  Prisma server and is slower.

Mutation-testing a fix (break it, watch the test fail, restore) is still
expected — but scope that to the affected test file, not the suite.

---

## 1. Do this first, before anything else

```bash
cd /workspaces/Agents/app
pnpm exec prisma dev start app        # it stops on its own; has bitten 5+ times
git status --short                    # see §3 — there may be uncommitted slice 4 work
pnpm typecheck && pnpm lint && pnpm test --run
```

**If `pnpm test` dies in global setup complaining about `localhost:51214`, that
is NOT a code failure** — the local Prisma server stopped. Start it and re-run.
This is the single most common time-waster in this repo.

---

## 2. Where the build actually is

**M0–M5 are done, reviewed, retro'd, committed and PUSHED.** Everything through
commit `f8dd0b0` is on `github.com/JayShawn777/Agents`.

**M6 (custom voice) is IN PROGRESS.** The architecture is approved. Slices 1–4
are committed and pushed; the tree is clean. Next up is slice 5.

| Slice | What it is | State |
|---|---|---|
| 1 | Persona visibility scoping — closes a cross-account IDOR | ✅ pushed `9ae2550` |
| 2 | Schema: 3 models, `PersonaStatus`, `VOICE_CLONING`, retention rows | ✅ pushed `8fbae9d` |
| 3 | Vendor client — `fetch` create/delete, two-key support | ✅ pushed `f8dd0b0` |
| 4 | Consent recording — endpoints 48/49, versioned wording | ✅ pushed `e785522` |
| 5 | Sample capture — endpoint 50 + the browser-direct upload | not started |
| 6 | Creation — endpoint 51, caps, audit row, sample deletion | not started |
| 7 | **Deletion/revocation — 4 paths must reach the vendor** | not started |
| 8 | The recorder/consent/review UI | not started |
| 9 | **THE ENTRY POINT** — account-page card + disclosure | not started |
| 10 | §312.4 notice + privacy copy for voice data | not started |

The plan is `app/docs/plans/m6-custom-voice-implementation.md`. It is approved;
follow it rather than re-deriving.

---

## 3. Nothing is uncommitted — slice 4 landed

Slice 4 was committed and pushed as `e785522` before this session ended. Gates
were green at that point: typecheck ✅, lint ✅, **1284 passed / 13 skipped / 0
failed**.

`git status` should show only this `HANDOVER.md` file as untracked. If it shows
anything else, something happened after the handover was written — check the
diff before assuming it is safe.

**Start M6 at slice 5** (sample capture, endpoint 50, plus the browser-direct
upload that slice 4 deliberately left for it — both need the same transport, and
half-building it twice was the worse option).

---

## 4. What the next session needs to know that is not obvious

### The consent wording is OWNER-APPROVED and versioned

`VOICE_CONSENT_WORDING_VERSION = "2026-09-02.1"` in `lib/voice/consent-copy.ts`.
The owner approved it verbatim on 2026-09-02, including two decisions:

- **The vendor is deliberately NOT named** in the spoken statement ("Homework
  Helper's speech provider"), so a vendor change does not invalidate stored
  consent. The written §312.4 notice names them.
- **The date is spoken**, deliberately, to bind the recording to a moment.

**Changing a word means bumping the version in the same diff.** A lawyer has NOT
reviewed it — flagged to the owner as a pre-launch task, not a pre-build one.

### A design decision that departs from one reading of AC 8

M6 does **not** write a `ParentalConsent` row. That table requires a
`studentProfileId` and a `directNoticeId` — it is COPPA machinery about a
*child*. Voice cloning is an adult consenting about *themselves*, at account
level. `VoiceConsentRecording` is the consent record instead; `parentalConsentId`
remains on the row as a seam.

**This was flagged to the owner and they did not object, but they also did not
explicitly bless it.** If a reviewer reads AC 8 strictly, this is the thing to
re-litigate — and it is a schema change, so better early.

### One consent recording authorises exactly ONE clone

`findUsableConsentRecording` filters on the current wording version AND
`customVoice: { is: null }`. A second voice needs its own spoken consent.

### AC 4's honest limit, already written into the plan and code

A server-chosen pathname plus a single-use grant refuses the attack AC 4
literally describes (pointing us at some other stored object). It **cannot prove
the bytes came from a microphone**. Do not claim otherwise. The real control
against a child cloning a classmate is AC 2/AC 3: no student-facing entry point,
every endpoint owner-scoped.

---

## 5. Owner actions still outstanding

1. **The second ElevenLabs key.** Measured 2026-09-02: the one key in `.env` has
   `voices_write`, so the high-traffic narration credential can delete every
   voice on the account. With `VOICE_SAMPLE_RETENTION_DAYS = 0` a deleted voice
   cannot be regenerated. `lib/voice/provider.ts` already prefers
   `ELEVENLABS_VOICE_ADMIN_KEY` and falls back, so **nothing is blocked** — this
   is a config change whenever they want it. Owner's call: they said use the
   fallback for now. **Raise it again before slice 6 creates real voices.**
2. **The voice cap is still unknown** — needs `user_read` scope, which the key
   deliberately lacks. Blocking before promising the feature to users, not
   before building it.
3. **M5 slice 12's autoplay measurement** in a browser that enforces autoplay
   policy. Long outstanding. Everything downstream of "does one `<audio>` element
   keep user activation across `src` changes" is an assumption; the fallback is a
   material redesign.

---

## 6. Two things this session proved worth keeping

**The guards caught four real defects that nothing else would have.** In slices 2
and 4, `blob-claimants.test.ts` and `retention-policy-coverage.test.ts` failed on:

- `VoiceConsentRecording` unregistered → consent recordings deleted within the hour
- `CustomVoice.samplePathname` invisible to a `^pathname` pattern — the guard's
  own blind spot
- a retention classification claiming a prune that did not exist

None would have failed anything. They would have shipped and surfaced later as
missing audio nobody could explain. **Keep extending these rather than trusting
review.**

**Mutation-testing every fix is now the working habit** (retro lesson 25). It
caught a bug I shipped in endpoint 49 this session: `durationMs` read from a
place that always yielded `0`, so every consent confirmation would have failed.
It typechecked, and every failure-path test passed. **Writing a test for the
HAPPY path is what caught it.**

---

## 7. Suggested opening message for the next session

> Read `HANDOVER.md` at the repo root, then `app/CLAUDE.md`. Start the Prisma dev
> server (`pnpm exec prisma dev start app`) and verify the gates pass. Then
> continue M6 at slice 5 per
> `app/docs/plans/m6-custom-voice-implementation.md`.
