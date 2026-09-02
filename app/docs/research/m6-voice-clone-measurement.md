# M6's gating measurement — voice cloning, measured against the real account

- **Date:** 2026-09-02
- **Milestone:** M6 (custom voice)
- **Harness:** `tests/unit/live/voice-clone.live.test.ts` (inert by default)
- **Raw output:** `.scratch/m6-voice-clone-measurement.json` (gitignored)
- **Runs:** 2, one before and one after a fix to the harness's own deletion check

The M6 spec names one open question **BLOCKING for the design**, and
`docs/research/elevenlabs-tts.md` calls it the highest-risk unknown in the whole
integration. The spec says to resolve it with a real API call **before any
implementation**. This is that call.

Same discipline as M4 §9.2 and M5's vendor measurement — the third application.
Four of M4's five measurements changed the design; M5's flipped an assumption
about which model supports timestamps. Retro lesson 18: an ADR's claims about a
vendor are hypotheses, not decisions.

**The sample was the owner's own voice**, recorded for this purpose, 18.4
seconds, Apple M4A/AAC-LC. It never entered the repository (`.scratch/` is
gitignored), and every voice created was deleted in the same run.

---

## The blocking question: ANSWERED

> **Is a voice created through the API immediately usable, or blocked pending a
> manual verification step?**

**IMMEDIATELY USABLE.** Confirmed on two independent runs.

- `POST /v1/voices/add` returned 200 with a `voice_id` and, explicitly,
  **`requires_verification: false`**.
- `POST /v1/text-to-speech/{voice_id}` **succeeded straight away** — 47,996 bytes
  of audio on run 1, 47,125 on run 2 — with no dashboard step, no captcha, and no
  waiting.
- The voice row reports `category: "cloned"`, with an empty `fine_tuning.state`,
  zero `verification_attempts_count`, and `manual_verification_requested: false`.

**What this means for the design.** The parent-facing flow as the spec describes
it works. **AC 13's pending state is a defensive branch, not the normal path** —
it should still exist (a vendor can change this, and per-account policies may
differ), but M6 does not need rethinking, and the flow does not need to be built
around an asynchronous verification handshake.

This is the good outcome. It was genuinely uncertain: had the answer been "no",
the spec's own words were that "the parent-facing flow as designed does not work
and M6 needs rethinking".

## The scale question: STILL UNANSWERED, and blocked on a key scope

> **How many cloned voices does the plan allow, and is the cap per account or
> account-wide?**

`GET /v1/user/subscription` returns **401**, explicitly:
`"The API key you used is missing the permission user_read"`.

That scope is deliberately absent, and its absence is correct — a synthesis key
has no business reading billing. But it means this question cannot be answered
without a widened or second key.

**Blocking for scale, not for a first build.** It bounds how many families can
ever use the feature, which matters before promising it to anyone, and not
before writing the first slice.

## Vendor-side deletion: WORKS

AC 19 and AC 20 are written as **vendor-side** deletions, because a voice model
persists in a third party's system until something removes it. Worth proving
before designing around it.

- `DELETE /v1/voices/{id}` → **200** `{"status":"ok"}`
- A follow-up read → **400** with a typed body:
  `{"detail":{"code":"voice_not_found","status":"voice_not_found", …}}`
- `GET /v1/voices` after both runs → **21 voices, zero of `category: "cloned"`**,
  and nothing named `m6-measurement-*`. Nothing leaked.

**A caveat this measurement cannot settle:** "the API reports it as gone" is not
the same claim as "the vendor has erased the model and any derived data from
their systems". That is a contractual and DPA question, not an API one, and M6's
promise to a parent that "delete means delete" rests on the contract as much as
on this 200.

### It also caught a bug in the measurement itself

Run 1 reported deletion as **UNCERTAIN**. The deletion had worked; the *check*
was wrong — it demanded HTTP 404, and this vendor signals not-found with **400**
plus a typed `voice_not_found` code. The harness now keys on the typed code as
well as the status, and run 2 reported YES.

Worth recording rather than quietly fixing. A measurement that reports a false
negative is a measurement that can also report a false positive, and this one was
caught only because the raw response body was recorded alongside the verdict.
**Record the evidence, not just the conclusion** — that is what made the error
visible.

## The API key is wider than documented

Measured incidentally, and it corrects `app/CLAUDE.md`, which claimed the key was
scoped to `voices_read` + `text_to_speech` **"only"**:

| Scope | Result | How it was established |
|---|---|---|
| `voices_read` | **YES** | 21 voices listed |
| `user_read` | **NO** | 401 `missing_permissions`, named explicitly |
| `voices_write` | **YES** | 422 `Field required` on a malformed create — *not* the 401 the same API returns for an absent scope |

Both failure modes appeared in a single run, side by side, which is what makes
the `voices_write` conclusion an inference from evidence rather than a guess.

**Two consequences.** M6 needs no second key. And the everyday synthesis key can
create *and delete* every voice on the account, which nobody chose — the argument
that a synthesis key has no business reading billing applies at least as strongly
to one that can destroy voices. **Owner decision, flagged in `app/CLAUDE.md`**,
not acted on unilaterally: narrowing it would break M6.

## Incidental finding: 18 seconds was enough

The spec and the vendor's own guidance point at a minute or more of audio. An
**18.4-second** sample produced a usable clone that synthesized on the first
attempt.

**Do not read this as a recommendation.** It establishes that the API accepts a
short sample and returns something that works — it says nothing about whether the
*result sounds like the person*, which is the whole point of the feature and was
not evaluated here. AC 10's listen-back remains the only quality control the spec
specifies, and the spec's own open question about whether a sample needs an
automated quality check is untouched by this.

## What this does NOT answer

Stated plainly, because a measurement's limits are the easiest thing to lose:

- **Clone quality.** Nobody listened critically to the output. One 18-second
  sample from one speaker in one recording environment.
- **The voice cap** — see above; needs `user_read`.
- **Whether deletion is contractual erasure**, as distinct from an API 404.
- **Anything about consent capture, storage, or binding** — the whole of M6's
  actual subject matter. This measured the vendor, not the milestone.
- **Concurrency, rate limits, or what happens at the cap.**
- **Whether the vendor's terms permit this use case at all** for an account of
  this tier, which is a terms question rather than an API one.

## Consequences for M6

1. **The architect is unblocked.** The blocking question is answered, and
   answered favourably.
2. **AC 13's pending state stays, and is demoted** from expected path to
   defensive branch. It should not shape the UI's primary flow.
3. **AC 19/20's vendor-side deletion is viable** — the API supports it and it
   verifiably works. The contractual half remains open.
4. **The voice-cap question must be answered before the feature is promised**,
   and needs an owner decision about key scope.
5. **The key-scope question is now an explicit owner decision**, recorded in
   `app/CLAUDE.md`.
