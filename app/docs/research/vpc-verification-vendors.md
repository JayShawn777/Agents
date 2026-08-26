# Research: Verifiable parental consent — paid identity-verification vendors

> ## ⚠️ THIS IS RESEARCH BY AN AI AGENT. IT IS NOT LEGAL ADVICE.
>
> Nothing below is a legal opinion and no attorney–client relationship exists.
> It was assembled by a research agent from public sources; it can be wrong,
> incomplete, or out of date. **A qualified privacy attorney must review the
> consent architecture, the vendor contract, the BIPA/CUBI notice-and-release
> language, and the retention schedule before any real parent goes through this
> flow.** Treat every dollar figure, date, subsection letter, and vendor claim
> here as a pointer to a source a lawyer or a hands-on spike should confirm, not
> as a conclusion you may rely on.

> **Tooling caveat — read this before trusting the citations below.**
> This task was assigned specifically to fix a prior research pass that had web
> *search* only, no web *fetch*, and every regulatory claim in it turned out to
> be a search-engine summary attributed to a primary URL rather than text
> actually read end to end. The task instructions asserted this agent would
> have a `WebFetch` tool. **It did not.** The tool registry made available to
> this agent for this run contained `Read`, `WebSearch`, `Write`, `Grep`, and
> `Glob` — no fetch/browse tool. This was tested directly: a `Read` call
> against `https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5`
> returned `File does not exist`, confirming the tool cannot reach the network.
> **§312.5(b) was therefore never read as continuous primary text in this
> research pass either.** What follows instead is a *verbatim reconstruction*
> built from many independent, targeted `WebSearch` queries, each returning
> short quoted fragments of the regulation from eCFR/govinfo/Cornell-LII mirror
> pages plus law-firm commentary. Every fragment below that is presented as a
> quotation is labeled `[SEARCH-SNIPPET]` — a string that a search result
> attributed to eCFR/govinfo, cross-checked against at least one independent
> source, but not confirmed by opening the page. One direct contradiction
> between two secondary sources was caught in the process (see the numbering
> note in Task 1) and is reported rather than silently resolved. **Before
> anything below reaches parent-facing copy, a privacy policy, or a filing,
> a human must open
> <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5>
> in an actual browser and read it start to finish.** That five minutes of
> manual verification is cheaper than trusting this document's letter-numbering.

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** How should we implement verifiable parental consent (VPC) using
  a paid, non-billing identity-verification vendor — which vendor, which method,
  what does it cost, what does it store, and does it avoid pulling a billing
  system into M0?
- **Verdict:** The `ConsentMethod` enum already in the codebase
  (`SIGNED_FORM`, `PAYMENT_CARD`, `TOLL_FREE_CALL`, `VIDEO_CALL`,
  `GOV_ID_CHECK`, `KBA`, `FMVPI`, `EMAIL_PLUS`, `TEXT_PLUS`) matches, in both
  label and order, the reconstruction of §312.5(b)(2)(i)–(ix) built here — good
  news, but still unconfirmed against primary text per the caveat above. For a
  paid non-billing vendor, **GOV_ID_CHECK is the pragmatic first choice over
  FMVPI**: it is one of the two enumerated methods available regardless of how
  the Anthropic-disclosure question resolves, it is materially cheaper than
  FMVPI, and — critically — it does **not** put a parent's face through
  biometric processing, which sidesteps a real Illinois BIPA exposure that
  FMVPI would create with no reduction in liability from "using a vendor."
  **Yes, a paid identity vendor avoids a parent-facing billing system in M0** —
  we pay the vendor on our own commercial (business-to-business) invoice, not
  by charging the parent — which is a structurally different integration from
  `PAYMENT_CARD`, which requires charging *the parent* a real, notified,
  discrete transaction. The 2025 amendments removed the word "monetary" from
  the payment-card method, which may narrow but does not eliminate that gap;
  see Task 4.

## Summary

- **§312.5(b)(2) enumerates nine methods**, reconstructed here in order:
  (i) signed form, (ii) payment/online-payment transaction with per-transaction
  notification (no longer required to be "monetary" as of the 2025 amendment),
  (iii) toll-free call, (iv) video-conference, (v) government-ID check against
  a database with prompt deletion, (vi) knowledge-based authentication (KBA),
  (vii) face-match-to-verified-photo-ID (FMVPI) with prompt deletion, (viii)
  "email plus," (ix) "text plus." **Our enum's labels and order both match this
  reconstruction** — the ADR's fear that the enum lettering might be wrong
  looks unfounded, but is still `[SEARCH-SNIPPET]`, not primary-verified.
- **Email plus / text plus are confirmed, by two independently phrased
  snippets, to be restricted to operators that do not "disclose" children's
  personal information** — this corroborates, without resolving, the open
  question already recorded in ADR-0008 and the M0 spec.
- **"Sliding scale" is a term of art used by commentators and a 2025 law-review
  article, not literal text found in the current rule.** The actual mechanism
  is the disclosure proviso attached specifically to (viii)/(ix), not a
  separately labeled "sliding scale" clause.
- **No mainstream paid-KYC vendor (Persona, Veriff, Jumio, Incode, Stripe
  Identity) has an FTC §312.12 approval.** They don't need one: GOV_ID_CHECK
  and FMVPI are *already* enumerated methods, so a vendor performing those
  steps is using an existing method, not a novel one requiring Commission
  approval. The FTC's §312.12 process has instead been used for genuinely new
  mechanisms — Imperium's KBA (approved 2013, and KBA was later folded into the
  enumerated list), Jest8/Riyo's FMVPI (approved 2015, likewise later
  enumerated), and, more recently, an ESRB/SuperAwesome/Yoti application for
  *facial age estimation* (not identity verification) that the FTC **denied
  without prejudice in March 2024**, pending NIST review of the age-estimation
  model.
- **Veriff has an actual COPPA-shaped, VPC-specific product** ("Parent
  Verification," used by Epic Games/SuperAwesome's ParentGraph). The others are
  generic KYC/AML platforms being repurposed for a use case that happens to fit
  the enumerated GOV_ID_CHECK/FMVPI shapes.
- **Face-match (FMVPI) creates Illinois BIPA exposure that a vendor contract
  does not remove.** Face geometry is an enumerated BIPA biometric identifier;
  Illinois courts have found *vicarious* liability for a company that uses a
  third-party vendor to capture biometric data on its behalf (the White
  Castle/Cothron fact pattern). Texas CUBI also reaches face geometry
  (AG-only, no private right of action). Washington's biometric statute likely
  does not, on the same photograph/video exclusion logic already documented for
  voice in `docs/research/coppa-childrens-privacy.md`.
- **GOV_ID_CHECK does not process the parent's face** — only a document — so it
  avoids the BIPA/CUBI face-geometry question entirely while remaining an
  enumerated, disclosure-question-agnostic method.
- **Completion-rate data is real but not COPPA-specific.** Published figures
  are general KYC-onboarding abandonment (60–80% abandonment industry-wide per
  one vendor's benchmark; ~10% at financial institutions specifically), not a
  study of parental-consent flows. Treat any specific "X% complete an ID check
  vs. Y% confirm an email" number as unverified marketing until we run our own
  flow.
- **A paid identity vendor does not require a parent-facing billing system.**
  We become the vendor's customer, invoiced on our own commercial terms — the
  parent never enters a card. That is structurally different from
  `PAYMENT_CARD`, which requires the *parent's* card and a processor in the
  consent path. The 2025 removal of "monetary" from the payment-card method is
  a real, underappreciated change — it may mean a $0 authorization satisfies
  the Rule now, which would shrink but not eliminate the billing-system
  argument against `PAYMENT_CARD`; see Task 4.
- **Fallback for a parent with no ID:** the Rule doesn't force a single method.
  Non-document methods remain available regardless: `EMAIL_PLUS`/`TEXT_PLUS`
  (if the disclosure question resolves favorably), `PAYMENT_CARD`, signed form,
  toll-free call, video call. A vendor-based flow should degrade to one of
  those rather than dead-ending a parent who lacks a document.

---

## Findings

### Task 1 — the enumerated methods, reconstructed (not primary-fetched)

**Chapeau, §312.5(b)(1)** `[SEARCH-SNIPPET]`, converged on by multiple
independent queries and consistent with the phrasing already quoted in
`docs/research/coppa-childrens-privacy.md`:

> "Any method to obtain verifiable parental consent must be reasonably
> calculated, in light of available technology, to ensure that the person
> providing consent is the child's parent."

**§312.5(b)(2) intro** `[SEARCH-SNIPPET]`:

> "Existing methods to obtain verifiable parental consent that satisfy the
> requirements of this paragraph include:"

The enumerated list, reconstructed subsection by subsection. Each row states
its confidence and how many independent search passes converged on it.

| Letter | Method (our enum label) | Reconstructed text `[SEARCH-SNIPPET]` | Confidence |
|---|---|---|---|
| (i) | `SIGNED_FORM` | "Providing a consent form to be signed by the parent and returned to the operator by postal mail, facsimile, or electronic scan." | High — two independent queries agreed verbatim. |
| (ii) | `PAYMENT_CARD` | Pre-2025: "Requiring a parent, in connection with a **monetary** transaction, to use a credit card, debit card, or other online payment system that provides notification of each discrete transaction to the primary account holder." **The 2025 amendment removed the word "monetary."** Multiple secondary sources (Fenwick, Venable-class commentary) state this plainly; I could not reconstruct the *exact* restated clause text, only the fact of the change. | Medium — the pre-2025 text is high confidence; the post-amendment exact wording is not reconstructed, only the substance of the edit. |
| (iii) | `TOLL_FREE_CALL` | "Having a parent call a toll-free telephone number staffed by trained personnel." | High. |
| (iv) | `VIDEO_CALL` | "Having a parent connect to trained personnel via video-conference." | High. |
| (v) | `GOV_ID_CHECK` | "Verifying a parent's identity by checking a form of government-issued identification against databases of such information, where the parent's identification is deleted by the operator from its records promptly after such verification is complete." | High — one query returned this as a single coherent block. |
| (vi) | `KBA` | "Verifying a parent's identity using knowledge-based authentication provided: (A) the verification process uses dynamic, multiple-choice questions, where there are a reasonable number of questions with an adequate number of possible answers such that the probability of correctly guessing the answers is low; and (B) the questions are of sufficient difficulty that a child age 12 or younger in the parent's household could not reasonably ascertain the answers." | High — returned as one continuous quoted block by a targeted query. |
| (vii) | `FMVPI` | "Having a parent submit a government-issued photographic identification that is verified to be authentic and is compared against an image of the parent's face taken with a phone camera or webcam, using facial recognition technology, and confirmed by trained personnel to determine that the photos match; provided that the parent's identification and images are promptly deleted by the operator from its records after the match is confirmed." | High — matches the FTC's own 2015 Riyo/Jest8 approval letter description almost word for word. |
| (viii) | `EMAIL_PLUS` | "Provided that, an operator that does not 'disclose' children's personal information [collected from a child] may use an email coupled with additional steps to provide assurances that the person providing the consent is the parent. Such additional steps include: sending a confirmatory email to the parent following receipt of consent, or obtaining a postal address or telephone number from the parent and confirming the parent's consent by letter or telephone call." | High — two independent queries converged, one quoting the "Provided that... does not 'disclose'" clause verbatim. |
| (ix) | `TEXT_PLUS` | "An operator that does not 'disclose' children's personal information may use a text message coupled with additional steps... Such additional steps include sending a confirmatory text message to the parent following receipt of consent, or obtaining a postal address or telephone number from the parent and confirming the parent's consent by letter or telephone call. An operator that uses this method must provide notice that the parent can revoke any consent given in response to the earlier text message." Added by the 2025 amendment, explicitly cited by a secondary source as "adding as §312.5(b)(2)(ix)." | High for the substance; the FTC's own final-rule secondary summary is the source that pins the letter as (ix), which by necessary implication pins email-plus at (viii). |

**A contradiction I caught and did not silently resolve:** one search result
paraphrased text-plus as "similar to the email plus method outlined in
§312.5(b)(2)(**vi**)" — i.e., a different secondary source mis-cited email-plus
as (vi) instead of (viii). (vi) is KBA in every other source, including the
verbatim KBA block above. I am treating that single outlier as a citation
error in that particular commentary, not as evidence of a different numbering,
because two other independent sources and the FTC's own "adding... as (ix)"
phrasing are mutually consistent at (viii)/(ix). **This is exactly the failure
mode the tooling caveat exists to flag: two summaries of the same primary text
disagreed, and only reading the primary text resolves it with certainty. That
reading did not happen in this pass.**

**Comparison against our `ConsentMethod` enum** (`prisma/schema.prisma` per
ADR-0008): `SIGNED_FORM, PAYMENT_CARD, TOLL_FREE_CALL, VIDEO_CALL,
GOV_ID_CHECK, KBA, FMVPI, EMAIL_PLUS, TEXT_PLUS` — **this is exactly the
reconstructed (i)–(ix) order and shape above.** None of the nine labels appear
wrong on this evidence. That is a relief but not a verification: ADR-0008
already deliberately declined to encode subsection letters anywhere in code
for exactly this reason, and this research does not license removing that
caution.

**"Email plus" disclosure restriction — confirmed.** Two independently phrased
`[SEARCH-SNIPPET]` fragments both begin with "Provided that, an operator that
does not 'disclose' children's personal information..." attached specifically
to (viii) and (ix). This directly corroborates — without resolving — the open
legal question already on record in ADR-0008 and the M0 spec: whether sending
a child's worksheet to Anthropic is a "disclosure."

**"Sliding scale" — a term of art, not current rule text.** A 2025 Penn Law
Review piece is literally titled *"Against the Sliding Scale"* `[SECONDARY,
search-only]`, describing the FTC's long-standing practice of tolerating
weaker verification (email plus) when data stays internal and demanding
stronger verification (signed form, payment card, ID check, etc.) when data is
disclosed to third parties or made public. That is the same mechanism as the
(viii)/(ix) disclosure proviso above, described in commentary rather than
appearing as a labeled clause in the rule itself. Do not put "sliding scale" in
parent-facing copy as if it were a defined regulatory term.

**§312.12 confirmed** `[SEARCH-SNIPPET]`: "An interested party may file a
written request for Commission approval of parental consent methods not
currently enumerated in §312.5(b)... The Commission shall issue a written
determination within 120 days." Two methods that started as §312.12
applications were later folded into the enumerated list itself: Imperium's KBA
(approved December 2013) and Jest8/Riyo's FMVPI (approved November 2015) — a
useful data point that the current (vi) and (vii) exist today *because* an
earlier vendor proved them out through this exact process.

### Task 2 — the vendor landscape

| Vendor | Markets COPPA VPC specifically? | §312.12 approval? | Pricing (per verification, `[SECONDARY]`, third-party aggregator estimates — not fetched from the vendor) | Integration shape | Evidence artifact / what NOT to store |
|---|---|---|---|---|---|
| **Veriff** | **Yes** — "Parent Verification" product, explicitly named, used by Epic Games and SuperAwesome's "ParentGraph" (a shared parent-verification graph so a parent doesn't reverify per app). Closest thing to a purpose-built COPPA VPC product in this set. | No | Self-serve plans reported at $0.80–$1.89/verification with a $49–$209/month platform minimum; enterprise annual contracts commonly $25k–$250k+. Reportedly bills for attempts, not just successes — effective cost-per-success is higher than the quoted per-session rate. | REST API + hosted/embedded web SDK; webhook-driven (a `decision` webhook delivers the final status/reason/extracted-person-data). No biometric templates retained after session completion per their own service description. | Store: Veriff session ID, decision status, reason code, timestamp, and whatever `vendorData`/`endUserId` you passed in. Do not store: the ID image or the selfie; Veriff's own docs state no biometric templates persist post-session — verify this contractually, not just by marketing copy. |
| **Persona** | No — generic, developer-configurable KYC/fraud platform; COPPA/VPC would be a configuration of their government-ID and/or selfie-match "inquiry" flow, not a named product. | No | ~$1.50/KYC quoted by one 2026 pricing aggregator; itemized: ~$0.54 government-ID verification, ~$0.19 document verification, ~$0.25–$0.43 for watchlist/adverse-media add-ons you would not need. | REST API; **embedded** web SDK (`docs.withpersona.com/embedded-flow`) driven by an "inquiry template ID," so the flow can live inside our own signup UI rather than a redirect. Webhooks are HMAC-signed: "computed from your webhook secret and a dot-separated string composed of the unix timestamp joined with the request body," with retries up to 7 times over exponential backoff — signature verification is available and expected, not optional. | Store: inquiry ID, verification/report ID, decision, timestamp. Persona has an explicit **Redact** API (`redact-an-inquiry`) that permanently deletes PII "for an Inquiry and all associated Verifications, Reports" while the inquiry record itself survives without PII — a good fit for "keep the evidence of the fact of verification, not the identity data." Do not store: ID images, selfie images, any biometric match score beyond a pass/fail flag. |
| **Jumio** | No — enterprise KYC/AML platform for regulated industries; COPPA use would again be a repurposing of its ID-check/selfie-match flow. | No | Reported enterprise volume (500k+/yr) at ~$0.75–$2; low-volume accounts reportedly $3–$8/verification; no published price list, sales-quoted. | REST API + hosted/redirect or embedded SDK options. Webhook-based callback for decisions (standard in this vendor class; not independently confirmed for signature-verification specifics in this pass). | Same shape as Persona/Veriff: store the vendor's verification reference and decision, not the document image. Jumio, like the others, markets "prompt deletion" of source images as a selling point, but get it in the contract, not the brochure. |
| **Incode** | No — high-volume onboarding-focused KYC platform. | No | Custom/sales-quoted; one 2026 comparison site places it "higher in the per-check range," with deepfake/AML/monitoring priced separately. No usable number found. | REST API, no COPPA-specific SDK or flow found. | Not independently characterized in this pass — treat as unknown until a vendor call happens. |
| **Stripe Identity** | No. | No | ~$1.50/verification is the figure repeated across 2026 pricing aggregators, but Stripe's own pricing page is quote-based. | Native `stripe-node` SDK, `VerificationSession` object, redirect or modal (`stripe.js` Identity modal) integration, webhook event `identity.verification_session.verified`, verified via `stripe.webhooks.constructEvent()` with a `whsec_...` signing secret against the **raw** request body — this is well-documented and low-risk to implement correctly. | **Caution, not fully resolved:** a search result states "Stripe Identity prohibits verifying anyone considered a minor as a restricted use case" and that Stripe's own services "are not directed to children under 13." In our flow the *verified person* is the adult parent, not the child, so this restriction may not bar the use case — but that reading needs to be confirmed directly against Stripe's own "Supported use cases" page (`docs.stripe.com/identity/use-cases`), which this pass could not fetch. **Do not select Stripe Identity for this purpose without resolving that first.** |
| **Yoti** | Partially — Yoti has repeatedly petitioned the FTC (with ESRB/SuperAwesome) to get *facial age estimation* recognized as a VPC method. That application (age **estimation**, not identity **verification**) was **denied without prejudice in March 2024**, pending NIST evaluation of the age-estimation model. Yoti's plain identity-verification (ID-check, FMVPI) product is not COPPA-specific but is technically capable of performing the already-enumerated (v)/(vii) methods. | **No approval granted** (denied without prejudice, 2024-03-29, per FTC and multiple law-firm blogs). | Not found. | Not independently characterized in this pass. | Not independently characterized in this pass. |
| **PRIVO** | Yes, indirectly — PRIVO is itself an **FTC-approved COPPA safe harbor** (since 2004) and separately offers a "just-in-time," risk-tiered consent/verification product, including online methods (credit card, partial SSN, driver's license number, employer ID) and offline methods. As a safe harbor, PRIVO can approve non-enumerated methods for its own member operators under §312.11, independent of the general §312.12 process. | N/A — it operates its own safe-harbor approval track, not a §312.12 Commission approval for the general public. | Not found; PRIVO's marketing pages do not publish per-verification pricing. | Not independently characterized in this pass — worth a sales call given the safe-harbor angle, which was already flagged as worth pricing in ADR-0008. | Not independently characterized in this pass. |

**§312.12 approval history, for calibration** `[SEARCH-SNIPPET]`:
- **Imperium, LLC** — KBA method — **approved 2013-12-23**.
- **AssertID, Inc.** — proposed using "friends'" feedback on a social network to
  corroborate a parent — **rejected**, November 2013.
- **Jest8 Limited (trading as Riyo)** — the FMVPI method described above,
  nearly word-for-word what is now enumerated (vii) — **approved 2015-11-19**.
- **ESRB / SuperAwesome / Yoti** — "Privacy-Protective Facial Age Estimation" —
  application filed 2023-06-02, **denied without prejudice 2024-03-29**,
  pending NIST evaluation; the FTC "took no position on the merits."

None of Persona, Veriff, Jumio, Incode, or Stripe Identity appear anywhere in
this approval history, because **they don't need to be there** — a vendor
performing GOV_ID_CHECK or FMVPI is executing an *already-enumerated* method,
not proposing a new one.

### Task 3 — the constraints that bite

**BIPA and face-match.** Illinois BIPA's biometric-identifier list `[already
verified as PRIMARY-SUMMARY in docs/research/coppa-childrens-privacy.md §5]`
expressly includes "scan of hand or face geometry" alongside voiceprint,
retina/iris scan, and fingerprint. FMVPI is, definitionally, a scan of a
parent's face geometry compared against an ID photo. **Two consequences:**

1. **The parent — not the child — becomes the BIPA data subject.** We would
   need to give the parent BIPA §15(b)'s written notice (that a biometric
   identifier is being collected, the specific purpose, and the retention
   term) and obtain a written release, *before* the vendor captures the scan —
   on top of, not instead of, whatever the vendor's own consent screen says.
2. **Using a vendor does not shift the liability away from us.** `[SECONDARY,
   search-only]` In the Illinois Supreme Court's *Cothron v. White Castle*
   line of cases, a company was found potentially **vicariously liable** for a
   third-party vendor's handling of biometric scans the company had the vendor
   collect on its behalf. The doctrinal shape — deploy a vendor to capture
   biometric data as part of *our* process — is exactly the FMVPI integration
   pattern. The 2024 BIPA amendment (SB 2979) caps the *damages* (one recovery
   per person per method of collection, rather than per-scan), but it does not
   remove the underlying notice-and-release obligation or the private right of
   action ($1,000/$5,000 per violation, plus fees).

**Texas CUBI.** `[already verified as PRIMARY-SUMMARY in the coppa research]`
CUBI's "biometric identifier" definition includes "record of hand or face
geometry," so FMVPI triggers it too. AG-only enforcement, no private right of
action, penalty up to $25,000/violation, destruction required within a
reasonable time (AG guidance: not later than one year after the purpose
expires).

**Washington.** By the same textual-exclusion logic already worked out for
voice in `docs/research/coppa-childrens-privacy.md` §5 — RCW 19.375 defines a
biometric identifier as data from "automatic measurements of biological
characteristics" but then **excludes** "a physical or digital photograph,
video or audio recording or data generated therefrom." A facial-geometry
template generated from a selfie is arguably "data generated" from a
photograph, which would place FMVPI outside Washington's biometric statute on
the same reasoning that placed a voiceprint outside it. This is an analogy,
not independently re-researched for face data specifically in this pass —
flag it for the same lawyer review as the voice question.

**Net effect: GOV_ID_CHECK avoids all three state-biometric questions above,
because it never captures the parent's face — only a document.** That is the
single strongest reason to prefer it over FMVPI as the paid, non-billing
first choice, independent of cost.

**Data minimization — what to keep, what a vendor can return without the
underlying identity data.** Every vendor examined (Persona, Veriff, and, by
industry-standard pattern, Jumio/Incode/Stripe) returns a **reference token**
— an inquiry/session/verification ID — plus a **decision** (pass/fail, reason
code) via webhook or API poll, decoupled from the underlying document/selfie
images, which the vendor holds transiently and is contractually obligated (get
this in writing, not just marketing copy) to delete promptly. Persona goes
further with an explicit, callable **Redact** endpoint that deletes PII while
preserving the inquiry's existence and decision — the shape ADR-0008 already
specifies for `methodEvidence` (`"a processor transaction id, a vendor
verification id"` — never a live credential or raw document).

**What to deliberately never store, regardless of vendor:** the raw ID image,
the raw selfie/face image, any facial-geometry or biometric template/vector,
full SSN, and (per the FMVPI clause itself) anything beyond what's needed to
prove the match was confirmed and then promptly deleted by us and the vendor
alike.

**Friction / completion-rate data.** `[SECONDARY, search-only, general KYC
industry, not COPPA-specific]`:
- One vendor benchmark reports **60–80% abandonment** in digital onboarding
  broadly; a separate, narrower figure cites **~10% abandonment specifically
  at financial institutions**. The spread itself tells you these numbers are
  industry- and flow-dependent, not a fixed constant.
- Average time-to-abandon: reported around **19 minutes**, down from ~26
  minutes in 2020, suggesting flows have gotten faster but are still a
  multi-minute commitment.
- Reported reasons for abandonment: process too long, too much personal
  information requested, or changed mind (~21% each), and **38% citing not
  having the required identity document on hand** — directly relevant to a
  parent asked for a government ID at signup.
- **No study found comparing ID-check consent flows specifically to
  email-confirmation consent flows for COPPA VPC.** Every number above is
  general KYC/fintech onboarding. Treat any specific claim like "X% of parents
  complete an ID check vs. Y% confirm an email" as unverified until we
  instrument our own flow.

**Fallback if a parent has no government ID.** GOV_ID_CHECK and FMVPI are not
the only enumerated methods, and the Rule does not require picking one method
for everyone. A lawful, document-free fallback already sits in the enumerated
list: `EMAIL_PLUS`/`TEXT_PLUS` (if the disclosure question resolves in our
favor), `PAYMENT_CARD` (works with any card, not an ID), `SIGNED_FORM` (no
document, just a signature), or `TOLL_FREE_CALL`/`VIDEO_CALL` (human
verification, no document). A production flow should offer at least one
document-free path rather than dead-ending a parent who lacks ID — this is a
design requirement worth adding as an acceptance criterion whenever the vendor
method ships, not an afterthought.

### Task 4 — recommendation

**Ship `GOV_ID_CHECK` first, via Persona, as the paid non-billing method —
provisionally, alongside the existing `EMAIL_PLUS` implementation from
ADR-0008, selected by the same `CONSENT_METHOD` configuration switch.**

Reasoning:
- It is one of the two enumerated methods (with `PAYMENT_CARD`) available
  **regardless of how the Anthropic-disclosure question resolves** — it does
  not depend on counsel's answer, unlike `EMAIL_PLUS`/`TEXT_PLUS`.
- It does not process the parent's face, so it avoids the BIPA/CUBI exposure
  that `FMVPI` would create in Illinois and Texas for no clear verification
  benefit over a plain document check for our threat model (we are not trying
  to stop a determined fraud; we are trying to reasonably corroborate an
  adult).
- Persona over Veriff/Jumio/Incode for the *first* implementation specifically
  because of the **embedded SDK + documented, signature-verified webhook +
  explicit Redact API** — it is the vendor whose integration shape and
  data-minimization story were the most concretely confirmed in this pass, not
  because it is COPPA-specific (it isn't; Veriff's named "Parent Verification"
  product is the closer marketing fit and is worth a second look/quote before
  committing, precisely because it's purpose-built and has a track record with
  Epic Games' scale of child-directed product).
- Realistic cost per verified parent: **roughly $0.50–$2 in raw per-check
  vendor pricing** (Persona's ~$1.50/KYC and government-ID line item of
  ~$0.54 bracket this), **before** any platform/monthly minimum or contract
  floor, which several vendors in this space (Veriff explicitly) charge on top
  — plan for a monthly minimum in the tens of dollars even at near-zero volume,
  and a real sales contract once volume grows. **None of these numbers were
  fetched from a vendor's own pricing page; they are third-party aggregator
  estimates from 2026, and this agent explicitly could not verify them.** Get
  an actual quote before this number appears in a budget.

**Does choosing a paid identity vendor avoid needing a billing system in
M0? — Confirmed, with one nuance.**

Yes, in the sense the spec's non-goal is worried about: a paid vendor method
means **we** pay the vendor on our own commercial terms (an invoiced B2B
relationship, metered or contracted, settled outside the parent-facing product
entirely). The parent never enters a payment card, there is no charge to
notify them of, no refund path, and no PCI-adjacent card-data handling in the
consent flow. That is structurally different from `PAYMENT_CARD`, where the
*parent's own card* and a *discrete, notified transaction* are the mechanism
of consent itself — which is what forces a payment processor, a charge, a
webhook, and (historically) a refund into the consent path.

**The nuance:** the 2025 amendment removed the word "monetary" from the
payment-card method's requirement `[SECONDARY, search-only — the fact of the
change is corroborated by multiple law-firm summaries; the exact restated
clause text was not reconstructed]`. Several commentators read this as meaning
a **non-monetary transaction** — e.g., a card network authorization/void with
no actual charge — can now satisfy "notification of each discrete transaction
to the primary account holder," which would reduce (not eliminate) the
`PAYMENT_CARD` friction and cost ADR-0008 assumed. It would **still** require
integrating a real payment processor (Stripe or similar) to originate that
authorization and receive its webhook — so `PAYMENT_CARD` still pulls a
processor into M0 either way; what changes is only whether that processor
transaction needs to be a chargeable, refundable amount. **This is worth a
follow-up spike before ADR-0008's `PAYMENT_CARD` alternative is finally
rejected** — the economics may be better than the ADR currently assumes, and
this finding was not available to the original researcher.

**What I could not verify, stated plainly:**
- The exact restated text of §312.5(b)(2)(ii) after the "monetary" word was
  removed.
- Whether Stripe Identity's "no minors" restricted-use clause bars verifying
  an *adult parent* in a child-directed product, or only bars verifying a
  minor as the subject.
- Actual, vendor-quoted pricing for Persona, Veriff, Jumio, Incode, or Stripe
  Identity for this specific use case — every number above is a third-party
  aggregator's estimate, not a vendor quote.
- Any COPPA-VPC-specific (as opposed to general KYC) completion-rate study.
- Incode's integration shape, SDK, and evidence-storage behavior in any
  detail — searches did not surface enough to characterize it.
- The full current text of §312.5(b) as continuous primary prose. **This is
  the central unresolved item.** Everything above is a reconstruction, however
  convergent, and the task's primary objective — reading the regulation
  directly — was not accomplished because the promised fetch tool was not
  actually available in this run.

---

## Risks and unknowns

- **The tooling gap itself is the biggest risk.** This document was supposed
  to fix the previous research's search-only weakness and could not, because
  the WebFetch tool referenced in the task instructions was not present in
  this agent's tool registry. Anyone reading this document should not treat it
  as having satisfied "read the primary source" — it has only satisfied
  "cross-checked several independent summaries of the primary source," which
  is better than one summary but is not the same thing.
- **The exact post-2025 text of the payment-card method (ii) is unconfirmed**
  and materially affects ADR-0008's cost argument against `PAYMENT_CARD`.
- **Vendor pricing throughout this document is third-party-aggregator
  estimate, not vendor-quoted.** Do not put any number from this document into
  a budget without a sales call.
- **BIPA/CUBI/Washington analysis for face data leans on the voice-data
  reasoning already built in `docs/research/coppa-childrens-privacy.md`**,
  which itself flags an unverified 2024 BIPA amendment detail. Get counsel to
  re-run this specifically for face geometry, not just voice.
- **Veriff's "Parent Verification"/ParentGraph product was not evaluated in
  the same depth as Persona** — it is plausibly the better first choice given
  it's purpose-built rather than repurposed KYC, and deserves an actual quote
  before Persona is locked in.
- **No completion-rate data specific to COPPA VPC exists in what this pass
  found.** Any UX/conversion decision should be validated with our own funnel
  data, not an inferred number from general KYC benchmarks.

## Sources

All sources below were reached via `WebSearch` only. None were fetched as a
full page (`WebFetch` was unavailable — see tooling caveat above). "PRIMARY"
means the domain is an official regulatory/vendor source; "SECONDARY" means
commentary, law-firm blog, or pricing-aggregator content. All are
`[SEARCH-SNIPPET]`/`[SECONDARY, search-only]` in the sense that this agent read
only the snippet/summary the search tool returned, not the full page.

- [eCFR — 16 CFR 312.5, Parental consent](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5) — PRIMARY, not fetched; the exact page this research needed to read and could not.
- [eCFR — 16 CFR 312.12, Voluntary Commission approval processes](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.12) — PRIMARY, not fetched.
- [GovInfo — CFR 2025 title 16 vol 1 §312.5 PDF](https://www.govinfo.gov/content/pkg/CFR-2025-title16-vol1/pdf/CFR-2025-title16-vol1-sec312-5.pdf) — PRIMARY, not fetched; identified as the current-edition PDF but never opened.
- [Federal Register — Children's Online Privacy Protection Rule, 2025-05904 (90 FR, 2025-04-22)](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule) — PRIMARY, not fetched; source of the "text plus... adding as §312.5(b)(2)(ix)" and "removing... 'monetary'" facts, both taken from secondary summaries of this document.
- [FTC — Grants Approval for New COPPA VPC Method (Imperium, 2013)](https://www.ftc.gov/news-events/news/press-releases/2013/12/ftc-grants-approval-new-coppa-verifiable-parental-consent-method) — PRIMARY, not fetched, search-summary only.
- [FTC — Grants Approval for New "Selfie" VPC Mechanism (Jest8/Riyo, 2015)](https://www.ftc.gov/news-events/news/press-releases/2015/11/ftc-grants-approval-new-coppa-verifiable-parental-consent-method) — PRIMARY, not fetched, search-summary only.
- [FTC — Denies Application for New Parental Consent Mechanism (ESRB/Yoti/SuperAwesome, 2024)](https://ftc.gov/news-events/news/press-releases/2024/03/ftc-denies-application-new-parental-consent-mechanism-under-coppa) — PRIMARY, not fetched, search-summary only.
- [Against The Sliding Scale — Penn Law Review, 2025](https://pennlawreview.com/2025/02/01/against-the-sliding-scale/) — SECONDARY, search-summary only; source for "sliding scale" being commentary, not rule text.
- [Veriff — Case study: Veriff partners with SuperAwesome](https://www.veriff.com/case-studies/veriff-partners-with-superawesome) — SECONDARY/vendor, search-summary only.
- [Veriff — Service Description](https://www.veriff.com/service-description/ver-vsd-2301) and [Biometric Liveness docs](https://devdocs.veriff.com/docs/biometric-liveness) — SECONDARY/vendor, search-summary only.
- [Persona — Redact an Inquiry API docs](https://docs.withpersona.com/api-reference/inquiries/redact-an-inquiry) and [Quickstart: Webhooks](https://docs.withpersona.com/quickstart-webhooks) and [Embedded Flow Overview](https://docs.withpersona.com/embedded-flow) — SECONDARY/vendor, search-summary only.
- [Stripe — Resolve webhook signature verification errors](https://docs.stripe.com/webhooks/signature) and [Identity: handle verification outcomes](https://stripe.com/docs/identity/handle-verification-outcomes) — SECONDARY/vendor, search-summary only.
- Pricing aggregators (SECONDARY, search-summary only, treat all as unverified estimates): [Vendr — Persona pricing](https://www.vendr.com/marketplace/persona), [PricingSaaS — Persona](https://pricingsaas.com/companies/withpersona), [CostBench — Veriff pricing](https://costbench.com/software/kyc-aml/veriff/), [Vendr — Jumio pricing](https://www.vendr.com/marketplace/jumio), [hyperverge.co — Jumio pricing overview](https://hyperverge.co/blog/jumio-pricing/), [G2 — Incode pricing](https://www.g2.com/products/incode-technologies-incode/pricing).
- [oneid.uk — Why 68% of users abandon identity checks](https://oneid.uk/news-and-events/identity-verification-abandonment-cost) and [didit.me — Beyond Pass Rate: benchmarking identity verification](https://didit.me/blog/beyond-pass-rate-benchmarking-identity-verification-performance/) — SECONDARY, search-summary only; general KYC abandonment figures, not COPPA-specific.
- [Bridge Legal — Age Requirements for Using Stripe in the United States](https://bridgelegal.org/age-requirements-using-stripe-united-states/) — SECONDARY, search-summary only; source of the unresolved "Stripe Identity restricts minors" note.
- `docs/research/coppa-childrens-privacy.md` — INTERNAL, previously produced research this document builds on for BIPA/CUBI/Washington background and for the "sliding scale"/disclosure framing; itself labeled `[PRIMARY-SUMMARY]` throughout for the same search-only limitation.

---

**Note on staleness:** research goes out of date silently. Vendor pricing,
webhook mechanics, and even FTC approval status can change within months —
re-verify before relying on any dollar figure or subsection letter here for a
new decision. The single highest-priority re-verification is Task 1: **have a
human actually open the eCFR page** before any subsection letter from this
document reaches parent-facing copy, a privacy policy, or a regulatory filing.
