# Spec: Upload schoolwork and extract its problems

- **Status:** Draft
- **Date:** 2026-08-26
- **Author:** product-spec agent
- **Milestone:** M1
- **ADRs:** n/a — none written yet. Depends on the storage ADR and auth ADR
  called for in [m0-accounts-and-profiles.md](m0-accounts-and-profiles.md).
  Research: [file-upload-storage.md](../research/file-upload-storage.md),
  [anthropic-api.md](../research/anthropic-api.md),
  [coppa-childrens-privacy.md](../research/coppa-childrens-privacy.md).

> **Revision note (2026-08-26).** A narrow revision of the previous Draft,
> following `docs/research/coppa-childrens-privacy.md` and the revised
> [m0-accounts-and-profiles.md](m0-accounts-and-profiles.md). Two things changed
> and nothing else.
>
> **(1) Retention.** The previous draft assumed a flat **12 months** for the
> uploaded source file. That is superseded. M0 now publishes a tiered retention
> table by data category (§312.10 requires the purpose, the business need and a
> deletion timeframe for each), in which an uploaded image or PDF is deleted
> **14 days after successful extraction** — because once the questions have been
> read out of the page, there is no articulable business need to keep a
> photograph of a child's schoolwork. AC 36 and **Data touched → Retention** now
> *point at* M0's table instead of restating a number: M0 owns the windows, and
> a duration written down in two specs will drift.
>
> **(2) Profile status.** M0 replaced `CONSENT_REQUIRED` with `NOTICE_PENDING` →
> `CONSENT_PENDING` → `ACTIVE`, plus `CONSENT_WITHDRAWN`. AC 11 is updated
> accordingly, and the preconditions to the acceptance criteria now say plainly
> that uploading requires an `ACTIVE` profile — which under M0's flow is reached
> only once verifiable parental consent has been *verified*, not merely
> submitted.
>
> **No acceptance criterion was added, removed or renumbered**; the architect's
> plan references these numbers. Pointers into M0's own renumbered criteria were
> corrected mechanically, changing no M1 requirement. The consequence of the
> shorter window for viewing an older upload is raised in Open questions rather
> than designed around.

## Problem

A student sits down with a worksheet they do not understand. The only way to get
help from the app today is to retype the problems by hand — which is slow, which
is exactly the thing a struggling student will not do, and which requires typing
mathematical notation a ten-year-old cannot produce. The homework is already on
paper in front of them and already photographable in three seconds. Until the
app can look at that photo and know that question 4 says "solve for x: 3x + 5 =
20", it cannot help with the actual homework the student actually has; it can
only offer generic material, which is what every other app already does.

## Goal

A student can photograph or upload a page of their schoolwork and, within a
minute, see the individual problems from that page listed back to them
accurately enough to correct, so that later milestones have real problems to
work from.

## Non-goals

Named explicitly because a reader will assume several of these are included:

- **No new practice problems.** Generating problems *similar to* the extracted
  ones is M2 and is the single most likely thing to leak into this milestone.
  M1 reads what is on the page and nothing else. Every problem the app displays
  after an extraction must correspond to a problem physically present on the
  uploaded page.
- **No solving, grading or answer checking.** The app does not compute an answer,
  does not mark the student's written answer right or wrong, and does not tell
  the student whether they got it correct. Whether the student's handwritten
  work is captured at all is addressed in AC 22 only as data, never as judgment.
- **No chat.** The student cannot ask a question about an extracted problem.
  That is M3.
- **No whiteboard, no drawing, no lesson script** (M4). No narration, no voice,
  no audio of any kind (M5/M6).
- **No mastery, skill tagging for progress, streaks, or "you're improving"**
  (M7). AC 17 captures a coarse subject and problem type on each extracted
  problem so the row shape is not a dead end, but nothing consumes it and no
  mastery model exists.
- **No handwriting-quality feedback, no neatness scoring, no plagiarism or
  cheating detection.**
- **No multi-page batch upload, no bulk import, no scanning a whole workbook.**
  One file per upload.
- **No editing of the image** — no crop, rotate, deskew, contrast tools. If a
  photo is unusable, the student retakes it.
- **No sharing an upload with anyone**, including the account owner's other
  student profiles.
- **No offline mode and no background/resumable upload after the tab closes.**
- **No server-action upload path.** Explicitly not built, not even as a
  fallback — see Acceptance criteria AC 2 and the rationale below.

## User stories

- As a student, I want to take a photo of my worksheet with my phone, so that I
  can get help without retyping anything.
- As a student, I want to upload a PDF my teacher emailed, so that digital
  homework works the same as paper homework.
- As a student on an iPhone, I want my photo to just work, so that I do not have
  to know what HEIC is.
- As a student, I want to see the problems the app found, so that I can tell
  immediately whether it read my page correctly.
- As a student, I want to fix a problem the app misread and delete one it
  invented or that was not homework, so that a bad read does not poison
  everything that comes after.
- As a student, I want to be told clearly when the photo was too blurry to read,
  so that I retake it instead of wondering why nothing happened.
- As a parent, I want to delete an upload of my child's work and know the file is
  actually gone, so that my child's schoolwork is not accumulating somewhere
  forever.
- As a parent, I want the photograph itself thrown away once the app has read the
  questions off it, so that a picture of my child's handwriting is not sitting in
  a bucket a year from now.
- As a security reviewer, I want the file bytes to travel from the browser to
  private storage without passing through our functions, so that a minor's
  schoolwork is never sitting in a function log or a request body.

## Acceptance criteria

**Preconditions for every criterion below.** Uploading requires a student
profile whose status is `ACTIVE`. Under M0's revised flow a profile becomes
`ACTIVE` only after the §312.4 direct notice has been given and verifiable
parental consent has been **verified** — `verifiedAt` set, not merely submitted
(M0 AC 19) — or, for a self-declared adult learner, at the neutral age gate (M0
AC 10). No M1 surface is reachable, and no upload token is issued, for a profile
in `NOTICE_PENDING`, `CONSENT_PENDING` or `CONSENT_WITHDRAWN` (M0 AC 36). The
status values are M0's; M1 defines none of its own.

### Upload path

1. **Given** an `ACTIVE` student profile, **when** the student opens the upload
   screen on a mobile browser, **then** a camera-capture option and a file-picker
   option are both present, and the file input's `accept` attribute includes
   `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` and
   `application/pdf`.
2. **Given** a 6 MB JPEG, **when** the student uploads it, **then** the upload
   succeeds, and a network trace of the session shows the file bytes sent in a
   request to the private blob storage host, with no request to the application's
   own origin carrying a body larger than 1 MB. *(Rationale: Next.js defaults
   server actions to a 1 MB body and Vercel caps function request bodies at
   4.5 MB with no configuration available. Phone photos are routinely 3–8 MB.
   Client-direct upload is the only viable path, not an optimization.)*
3. **Given** a 6 MB HEIC file from an iPhone, **when** the student uploads it,
   **then** a JPEG is stored, the stored object's recorded content type is
   `image/jpeg`, no object with content type `image/heic` or `image/heif` exists
   in the store, and the subsequent vision request carries media type
   `image/jpeg`. The original HEIC bytes are never sent to the vision API.
4. **Given** a HEIC file whose filename ends in `.jpg`, **when** the student
   uploads it, **then** it is still detected as HEIC by inspecting the file's
   magic bytes and is still converted before upload. Extension-based detection
   alone fails this test.
5. **Given** a JPEG or PNG file, **when** it is uploaded, **then** no HEIC
   decoder module is fetched by the browser — the converter is loaded only when
   a HEIC file is detected.
6. **Given** a 25 MB file, **when** the student selects it, **then** a
   size-limit message is shown before any bytes are transmitted; and **given** a
   client that bypasses that check, **when** it attempts the write, **then** the
   storage layer rejects it and no object is created (M0 AC 37/38).
7. **Given** a `.txt`, `.docx` or `.exe` file, **when** the student attempts to
   upload it, **then** it is rejected with a message naming the accepted formats
   and no object is created.
8. **Given** an upload in progress, **when** bytes are transferring, **then** a
   progress indicator advances and reaches 100% on completion.
9. **Given** an upload that fails mid-transfer (network dropped), **when** the
   student retries, **then** the retry succeeds and does not fail with an
   "object already exists" error. *(A random suffix on the pathname is the
   mechanism; the observable is that retry works.)*
10. **Given** a PDF with more pages than the configured page limit, **when** it
    is uploaded, **then** it is rejected with a message stating the page limit,
    and no extraction is attempted.
11. **Given** a student profile in any status other than `ACTIVE` — that is,
    `NOTICE_PENDING`, `CONSENT_PENDING` or `CONSENT_WITHDRAWN` — **when** the
    upload screen is opened for it, **then** the upload control is disabled with
    an explanation appropriate to that status, and a direct request for an
    upload token returns HTTP 403 with the typed error shape and issues no token
    (M0 AC 36). *(A profile is `ACTIVE` only once consent is verified, so this
    criterion is the fail-closed boundary for "no child data before consent". It
    must key off the status, never off the presence of a consent row.)*
12. **Given** an account owner signed in, **when** they attempt to upload
    against a student profile belonging to a different account, **then** the
    request is refused with HTTP 403 and no object is created.

### Persistence and the orphan problem

13. **Given** a completed upload, **when** the database is inspected, **then**
    exactly one upload record exists holding the storage pathname (not a full
    URL), content type, size in bytes, original filename, student profile id,
    status and creation timestamp.
14. **Given** the application running on `localhost` where the storage
    provider's upload-completed callback does not fire, **when** an end-to-end
    test performs a full upload, **then** the upload record is still persisted
    via an explicit client confirmation request. *(This is why the persistence
    path must not depend solely on the provider callback — otherwise local dev
    and Playwright tests silently persist nothing.)*
15. **Given** a confirmation request that is delivered twice for the same
    upload, **when** both are processed, **then** exactly one upload record
    exists.
16. **Given** an upload whose bytes stored successfully but whose database write
    failed, **when** the reconciliation job runs after the orphan threshold,
    **then** the stored object is deleted and the student sees the upload in a
    failed state with a retry option. *(An orphaned object is a child's
    schoolwork sitting in storage referenced by nothing, invisible to every
    deletion request — this criterion is a compliance control, not tidiness.)*
17. **Given** a student who has already uploaded the configured hourly maximum,
    **when** they attempt another upload, **then** the token request returns
    HTTP 429 with the project's typed error shape.

### Extraction

18. **Given** a persisted upload, **when** it completes, **then** an extraction
    record is created and its status transitions are observable to the client as
    `PENDING` → `RUNNING` → one of `COMPLETE`, `COMPLETE_EMPTY` or `FAILED`.
19. **Given** the fixture worksheet containing exactly five problems, **when**
    extraction completes, **then** exactly five extracted-problem rows exist —
    not four, not six — each with a stable ordinal matching its position on the
    page, the problem text, a subject, a problem type, and a confidence score
    between 0 and 1.
20. **Given** any completed extraction, **when** the extracted problems are
    compared against the source page, **then** every extracted problem
    corresponds to a problem present on that page. No problem is generated,
    completed, extended or invented. *(Test as: for a fixture page, the extracted
    set equals the known set. Generation is M2.)*
21. **Given** a worksheet photo containing mathematical notation, **when**
    extraction completes, **then** the notation is preserved in a form that
    renders back to the same expression rather than being flattened into
    ambiguous plain text.
22. **Given** a worksheet the student has already written answers on, **when**
    extraction completes, **then** the extracted problem text is the question,
    and the student's handwritten answer — if captured at all — is stored in a
    separate field and is not presented as part of the problem.
23. **Given** the vision response fails schema validation (the structured-output
    parse returns null), **when** extraction is processed, **then** the status
    is `FAILED` with a retryable error, and zero extracted-problem rows are
    written. No partial extraction is persisted.
24. **Given** the model declines the request (`stop_reason` of `refusal`),
    **when** extraction is processed, **then** the status is `FAILED`, a plain
    user-facing message is shown, and no stack trace, model identifier, raw
    provider payload or internal error text reaches the browser.
25. **Given** a photo containing no schoolwork at all — a pet, a selfie, a blank
    page — **when** extraction completes, **then** the status is `COMPLETE_EMPTY`,
    zero problems are listed, and the student is shown a "we could not find any
    problems on this page" message with a retake option. The app does not crash
    and does not invent a problem.
26. **Given** an extracted problem with a confidence score below the low-
    confidence threshold, **when** results are displayed, **then** that problem
    is visually flagged as needing the student's check.
27. **Given** an extraction that exceeds the configured time limit, **when** the
    limit is reached, **then** the status becomes `FAILED` with a retry option
    and no request is left hanging in the browser.
28. **Given** a completed extraction, **when** the student edits a problem's
    text, **then** the edit persists and the row is marked as
    student-corrected.
29. **Given** a completed extraction, **when** the student deletes a problem,
    **then** it is removed from the list and the remaining problems keep stable,
    non-colliding ordinals.
30. **Given** a completed extraction, **when** the student confirms the list is
    correct, **then** the extraction status becomes `CONFIRMED`. *(This is the
    handoff point M2 will consume; M1 does nothing further with it.)*

### Privacy, access and deletion

31. **Given** an uploaded file, **when** the vision request is made, **then**
    the file's bytes are read server-side and no signed storage URL for that
    object appears in any HTML, JSON payload, or client-side JavaScript
    delivered to the browser other than a short-lived URL used solely to render
    the student's own preview.
32. **Given** a signed URL issued to render the student's own preview, **when**
    it is inspected, **then** its expiry is no more than 5 minutes in the future
    (M0 AC 41).
33. **Given** account A signed in, **when** it requests an upload or an extracted
    problem belonging to account B, **then** the response is HTTP 404 and no
    content is disclosed.
34. **Given** an upload, **when** the student or owner deletes it, **then** the
    stored object is removed from blob storage, the upload record, extraction
    record and all extracted-problem rows are removed, and a subsequently
    requested signed URL for that pathname does not return the file.
35. **Given** a student profile with uploads, **when** the profile is deleted
    (M0 AC 46), **then** all of that profile's uploads, extractions and extracted
    problems are removed along with their stored objects.
36. **Given** an upload whose extraction succeeded, **when** the retention job
    runs after the source-file window defined in **M0's retention table**
    (`m0-accounts-and-profiles.md` → Data touched → Retention, row "Uploaded
    schoolwork image or PDF"), **then** the stored image or PDF object is deleted
    from the blob store, the extracted problem text is retained per that same
    table, and the upload record reflects that the source file is gone rather
    than being deleted itself; **and given** an upload whose extraction failed
    and was then retried or abandoned, **when** the job runs, **then** its stored
    object is deleted per the same row. The window is read from configuration and
    no duration is a literal in M1 code (M0 AC 45). *(M1 deliberately states no
    number. M0 owns every retention window and publishes them; a figure written
    down in two specs will drift, and the published policy in M0 AC 44 is the one
    a parent is shown.)*

## Out of scope for this milestone

Deliberately deferred; the architect should leave the seams for these but must
not build them:

- **M2 — practice generation and mastery.** The `CONFIRMED` extraction is the
  input. The skill/mastery model, the difficulty ladder, and generation prompts
  are all M2's problem. Do not add mastery fields to the extracted-problem row.
- **M3 — chat tutor.** Later, a student will ask about extracted problem 4 and
  the model will cite the source page. Note from the API research that citations
  and structured output are mutually exclusive in a single call — M1 uses
  structured output, M3 will use citations, and they will be two different
  calls. Do not try to satisfy both now.
- **M4–M7** — whiteboard, narration, personas, custom voice, adaptive loop.
- The Anthropic Files API (upload once, reference by `file_id` across many
  calls). It is the right long-term shape once the same upload is read three or
  four times, but M1 reads each upload once. Named here so it is not designed
  out; see Open questions.
- Re-running extraction with a different model or effort setting when the first
  attempt is low-confidence. Note the consequence of AC 36: once the source-file
  window has elapsed the file is gone, so any such re-run is possible only inside
  that window. If a later milestone wants re-extraction after a model upgrade, it
  needs its own retention argument put to M0, not a quiet extension of the window
  here.
- **The parent's §312.6 review surface** (deferred by M0). M1 is what makes it
  urgent — this is the milestone where there is finally something to review — but
  M1 does not build it. See Open questions for what it will and will not be able
  to show.
- Multi-page and multi-file uploads, and stitching several photos of one long
  worksheet into a single extraction.
- Image preprocessing (deskew, crop, contrast) to improve extraction accuracy.
- Caching or deduplicating identical uploads across students.
- Prompt caching of the extraction system prompt. The extraction prefix is
  small and per-upload; caching pays off in M3's chat loop, not here.

## Open questions

- [ ] **Does client-side upload to a private store work end to end?** Inherited
  from M0 and unresolved: nothing is installed, so every storage API signature
  is documentation-derived. This is load-bearing for AC 2, 3, 6, 9, 13 and 31.
  **BLOCKING — M1 cannot start until the M0 spike answers it.**
- [ ] **Which HEIC conversion library, and is it approved?** `heic2any` and
  `heic-to` are the candidates; both ship a sizeable WebAssembly decoder. The
  project constitution forbids adding a major dependency without the owner's
  approval, and AC 3–5 cannot be met without one. Relying on iOS's automatic
  transcoding is documented as unreliable — it does not fire when a file is
  chosen through the Files app or certain in-app browsers — so it is not an
  alternative. **BLOCKING.**
- [ ] **Approval for `@anthropic-ai/sdk`, and `ANTHROPIC_API_KEY` added to
  `.env.example` as a server-only variable.** **BLOCKING.**
- [ ] **What is the PDF page limit (AC 10)?** The model accepts far more than a
  student will ever upload; the real constraint is cost and latency per
  extraction. Needs a product decision. **ASSUMPTION pending an answer: 20
  pages.** Non-blocking if the limit is configuration.
- [ ] **How long is the uploaded image or PDF kept (AC 36)?** No longer M1's
  question. M0's retention table sets the source-file window and M0 carries the
  open question against it ("LAWYER + PRODUCT — what is the source-file retention
  window?", still an **ASSUMPTION** there). M1's previous 12-month assumption is
  withdrawn and must not be reintroduced. Non-blocking for building M1 provided
  the window is read from M0's configuration rather than restated here.
- [ ] **What does a student or a parent see when they open an upload whose
  source file has already been deleted?** Checked against every criterion that
  could depend on the file surviving extraction: extraction runs once,
  immediately after persistence (see ASSUMPTIONS), retries under AC 23/24/27
  happen within minutes, and the only later reader is the short-lived preview URL
  of AC 31/32 — so **the shorter window breaks no acceptance criterion in this
  spec as written**. It does bite at two seams that M1 does not specify and must
  not paper over. (a) A student or parent returning to an older upload: the
  preview has to degrade to an explicit "the original file has been deleted; the
  problems we read from it are below" state, not a broken image, a 404, or a
  silent empty box. No criterion here specifies that state; decide it before the
  upload-detail screen is built. (b) M0's deferred §312.6 review surface — one of
  the two stated business needs for keeping the source file at all is "letting a
  parent see a recent upload", and after the window there is no file to show, so
  that screen can only ever show the extracted text and the metadata. Neither
  seam is a reason to lengthen the window; the right answer is to say so plainly
  in the UI and in the published policy. Non-blocking for M1, **blocking for the
  review surface.**
- [ ] **Will a `high`-effort extraction call complete inside the Vercel function
  duration limit?** The API research flags model latency versus function
  duration as the biggest unvalidated assumption in the whole plan. If it does
  not fit, extraction becomes a background job and AC 18's status machine
  becomes load-bearing rather than cosmetic. Measure before implementing AC 27.
  Non-blocking — the status machine is specified either way.
- [ ] Should the low-confidence threshold in AC 26 be a fixed number or tuned
  against real worksheets? Non-blocking; start with a constant in one place.
- [ ] Does capturing a student's handwritten answers (AC 22) require its own
  consent scope, given it is a record of the child's academic performance rather
  than of the assignment? Non-blocking for M1 since nothing consumes the field,
  but it must be answered before M7 uses it. Note that it is *not* covered by the
  source-file window: the answer text is extracted data and outlives the
  photograph it came from.

## Data touched

**This is the milestone where the app starts holding a minor's data in earnest.**
An uploaded file is a photograph of a specific child's schoolwork, frequently
carrying their handwritten name, their teacher's name, a school letterhead, a
date, a grade or a correction in red pen, and — in a photo taken at a kitchen
table — whatever else was in frame. Treat it as sensitive personal data about a
child, never as an ordinary file.

| Data | Subject | Sensitivity | Where |
|---|---|---|---|
| Uploaded image or PDF bytes | Student, usually a minor | High — may contain name, school, handwriting, incidental background | Private blob store |
| Original filename | Student | Low–medium; often contains a name | Postgres |
| Content type, size, timestamps | Student | Low | Postgres |
| Storage pathname | Student | Reference to sensitive data | Postgres |
| Extracted problem text | Student | Medium — reveals what the child is studying and struggling with | Postgres |
| Extracted handwritten answers (AC 22) | Student | Medium–high — a record of academic performance | Postgres |
| Confidence scores, ordinals, subject/type tags | Student | Low | Postgres |
| Student-corrected flag and edit history | Student | Low | Postgres |

**Transmitted to third parties.** The file contents are transmitted to Anthropic
for extraction — this is the first time any student data leaves our
infrastructure, and the direct notice presented and emailed in M0 AC 12–13 must
name Anthropic and say what it receives. Nothing is sent to any analytics,
logging or error-reporting service that includes file bytes, extracted problem
text, or a signed storage URL. Signed URLs are bearer credentials: anyone holding
one reads the file until it expires, so they must never appear in logs, error
reports, cached HTML, or a URL bar the student can share.

**Retention — owned by M0, not restated here.** Every window that applies to M1's
data is a row in M0's tiered retention table (`m0-accounts-and-profiles.md` →
Data touched → Retention), which is published under §312.10, linked from the
direct notice, and tested by M0 AC 44 and AC 45. Two rows govern this milestone:
the **uploaded source image or PDF**, which the retention job deletes a short,
configured period after successful extraction (and promptly on extraction failure
once retried or abandoned), and the **extracted problem text**, which is retained
for the life of the `ACTIVE` profile because M2 and M7 build on it. AC 36
implements the first. **M1 states no duration deliberately** — the previous
draft's flat 12 months is superseded, both windows remain ASSUMPTIONS pending the
legal review flagged in M0's open questions, and a number duplicated across two
specs is a number that will drift. Read the value from the same configuration
M0's retention job reads.

**Deletion.** Five paths, all of which must remove the stored object and not
merely the database row: delete a single upload (AC 34), delete a student profile
(AC 35, inherited from M0 AC 46), the parent's §312.6 deletion request (M0 AC 48
— prompt, no recovery window), account closure (M0 AC 47 — a 30-day recovery
window that applies to closure only and must never be used to delay the previous
path), and the retention job (AC 36). Withdrawal of parental consent (M0 AC 24)
does not by itself delete anything, but must stop new uploads for that profile —
the profile leaves `ACTIVE`, which AC 11 already refuses.

**The orphaned-blob problem, restated because M1 is where it becomes real.**
Every deletion path above starts from a database row and walks to a pathname. An
upload whose bytes stored successfully but whose database write failed has no
row, so no deletion path can ever reach it — including the retention job, which
is why a short retention window is not a substitute for reconciliation. The file
— a child's homework — sits in storage indefinitely, and a parent who asks us to
delete everything would be told truthfully that we had, and would be wrong. AC 16
is the only control against this and it must enumerate the *store*, not the
database. It cannot be cut for scope, and its absence should be treated by the
reviewer as a compliance defect rather than a missing nice-to-have.

**ASSUMPTIONS made in this spec** (each was a guess):

- One file per upload; a worksheet is one page or one PDF.
- The 20 MB size ceiling and the accepted format list carry over from M0 AC 37.
- HEIC conversion happens client-side before upload, so the AI-ready format is
  what gets stored and no server CPU is spent on it. Server-side conversion
  would require pulling the file back out of storage into a function, and the
  common server-side toolchain has awkward HEIC support.
- Extraction runs once per upload, automatically, immediately after the upload
  is persisted — the student does not press a second button. This is what makes
  the short source-file window in AC 36 safe: nothing in M1 needs to read the
  original file days later.
- `claude-opus-5` with schema-validated structured output is the extraction
  mechanism, per the API research's project default.
- Preview rendering uses a short-lived signed URL rather than proxying bytes
  through a function; if the security reviewer disagrees, proxying via a
  server-side read satisfies AC 31 and AC 32 equally.
- 20 pages, the hourly upload cap in AC 17, the low-confidence threshold in
  AC 26 and the extraction time limit in AC 27 are all placeholder values that
  must live in one configuration module, not scattered as literals. The
  source-file retention window is configuration too, but it is **M0's** value —
  read it from wherever M0's retention job reads it, and do not add a second
  copy here.
