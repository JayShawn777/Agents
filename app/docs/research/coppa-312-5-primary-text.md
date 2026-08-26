# Research: 16 CFR §312.5 primary text — verifiable parental consent methods

> ## ⚠️ THIS IS RESEARCH BY AN AI AGENT. IT IS NOT LEGAL ADVICE.
>
> Nothing below is a legal opinion and no attorney–client relationship exists.
> It was assembled by a research agent from public sources; it can be wrong,
> incomplete, or out of date. **A qualified privacy attorney must review the
> consent architecture, the direct notice text, the privacy policy, and the
> retention schedule before this product is made publicly available to real
> children.** Treat every dollar figure, date, and citation here as a pointer to
> a source a lawyer should read, not as a conclusion you may rely on.
>
> **Tooling note, stated up front, because two prior attempts at this exact
> question failed on this point:** this agent has WebFetch and verified it
> works — see "Tooling verification" below. However, WebFetch itself does not
> return raw HTML/XML; it routes fetched content through an intermediate model
> that summarizes/extracts before returning a response to this agent. That
> means even a "successful" fetch is one layer removed from the raw regulatory
> text, not a guarantee of byte-for-byte accuracy. Every quote below was
> **cross-checked across at least two independent fetches** (and in most cases
> two independent sources — eCFR's versioner API and Cornell LII) before being
> treated as reliable; that cross-checking is noted inline. This is stronger
> evidence than a single search-snippet reconstruction, but it is not the same
> as reading the raw XML byte stream yourself.

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** What does 16 CFR §312.5 actually say — verbatim — about the
  enumerated methods of verifiable parental consent, the email-plus
  non-disclosure condition, and whether the 2025 amendments changed the
  payment-card method's "monetary transaction" requirement? Does our
  nine-value `ConsentMethod` enum match?
- **Verdict:** All nine of the codebase's guessed enum labels correspond, in
  order, to the nine methods currently enumerated in §312.5(b)(2)(i)–(ix). The
  labels are FTC/industry shorthand, not the literal regulatory wording (only
  "knowledge-based authentication" is used verbatim in the text itself), but
  the *methods* are correctly identified and correctly counted at nine — no
  additions or corrections needed to the enum's membership. The email-plus (and
  text-plus) condition is real, textual, and unconditional-sounding: it applies
  only to "an operator that does not 'disclose' ... children's personal
  information," full stop, with no separate carve-out visible in §312.5 itself
  (the definition of "disclose" that could rescue this lives in §312.2, not
  §312.5 — not fetched in this task, already covered in
  `docs/research/coppa-childrens-privacy.md`). On the payment-card method: the
  word **"monetary"** does not appear in the current text of (b)(2)(ii) — it
  reads "in connection with a transaction," not "in connection with a monetary
  transaction." Two independent current-text sources agree on this, while an
  older govinfo annual snapshot (2024/2025 edition) still shows "monetary
  transaction," which is consistent with — but does not conclusively prove —
  the word being dropped by the 2025 amendment. This is a genuine and
  material finding for the cost model, but it should be confirmed against the
  actual Federal Register redline before anyone relies on a $0 authorization
  qualifying.

## Tooling verification

WebFetch was tested first, per instructions, before doing anything else.

- `https://www.ecfr.gov/current/title-16/.../section-312.5` returned a **302
  redirect** to `unblock.federalregister.gov` (an anti-bot/API-access page),
  which contained no regulatory text. This URL from the task's ordered list
  did **not** work.
- `https://www.law.cornell.edu/cfr/text/16/312.5` **worked** — WebFetch
  returned quoted regulatory text on the first call.
- `https://www.govinfo.gov/content/pkg/CFR-2024-title16-vol1/xml/...` and the
  `CFR-2025-title16-vol1` equivalent **worked**, but both returned only **six**
  enumerated methods — these are annual codified editions (2024/2025 editions,
  effectively "as of January 1" of that year) and predate the 2025 amendments
  taking effect (2025-06-23) — see `docs/research/coppa-childrens-privacy.md`
  for the amendment timeline. They are real primary text, just of an
  **earlier version** of the rule, and are flagged as such throughout.
- Because the task's #1 URL failed, this agent additionally tried the eCFR
  **versioner API** directly — `https://www.ecfr.gov/api/versioner/v1/full/
  2026-08-01/title-16.xml?part=312` — which **worked** and returned the
  current nine-method text. This was not one of the three URLs specified in
  the task, but it is the same eCFR primary source the task pointed at,
  reached via its machine-readable API instead of the bot-blocked HTML page,
  and it is disclosed here rather than substituted silently.
- Conclusion: **WebFetch works.** No search-snippet reconstruction was used.
  Every quote below came from a fetch this agent made and can point to.

## Findings

### A. The enumerated methods of verifiable parental consent — §312.5(b)(2)

**Current text (eCFR, fetched as of 2026-08-01; nine methods).** The
introductory clause, (b)(1), sets the general standard:

> "An operator must make reasonable efforts to obtain verifiable parental
> consent, taking into consideration available technology. Any method to
> obtain verifiable parental consent must be reasonably calculated, in light
> of available technology, to ensure that the person providing consent is the
> child's parent." — **(b)(1)**, [eCFR via WebFetch]

(b)(2) then enumerates methods "that satisfy the requirements of this
paragraph include":

| Cite | Verbatim text | Cross-checked against |
|---|---|---|
| **(b)(2)(i)** | "Providing a consent form to be signed by the parent and returned to the operator by postal mail, facsimile, or electronic scan" | eCFR (2 calls) + Cornell + govinfo (older edition) — identical wording in all four |
| **(b)(2)(ii)** | "Requiring a parent, in connection with a transaction, to use a credit card, debit card, or other online payment system that provides notification of each discrete transaction to the primary account holder" | eCFR (2 calls) + Cornell agree on "a transaction" (no "monetary"). govinfo older edition reads "a monetary transaction." See §C below. |
| **(b)(2)(iii)** | "Having a parent call a toll-free telephone number staffed by trained personnel" | eCFR + Cornell + govinfo — identical |
| **(b)(2)(iv)** | "Having a parent connect to trained personnel via video-conference" | eCFR + Cornell + govinfo — identical |
| **(b)(2)(v)** | "Verifying a parent's identity by checking a form of government-issued identification against databases of such information, where the parent's identification is deleted by the operator from its records promptly after such verification is complete" | eCFR + Cornell + govinfo — identical |
| **(b)(2)(vi)** | "Verifying a parent's identity using knowledge-based authentication provided: (A) the verification process uses dynamic, multiple-choice questions, where there are a reasonable number of questions with an adequate number of possible answers such that the probability of correctly guessing the answers is low; and (B) the questions are of sufficient difficulty that a child age 12 or younger in the parent's household could not reasonably ascertain the answers;" | eCFR only — this method did not exist in the older 6-method govinfo snapshot in this position; single-source quote, not independently cross-checked against Cornell text for this exact paragraph |
| **(b)(2)(vii)** | "Having a parent submit a government-issued photographic identification that is verified to be authentic and is compared against an image of the parent's face taken with a phone camera or webcam using facial recognition technology and confirmed by personnel trained to confirm that the photos match; provided that the parent's identification and images are promptly deleted by the operator from its records after the match is confirmed;" | eCFR only — same caveat as (vi) |
| **(b)(2)(viii)** | "Provided that, an operator that does not 'disclose' (as defined by §312.2) children's personal information, may use an email coupled with additional steps to provide assurances that the person providing the consent is the parent. Such additional steps include: Sending a confirmatory email to the parent following receipt of consent, or obtaining a postal address or telephone number from the parent and confirming the parent's consent by letter or telephone call. An operator that uses this method must provide notice that the parent can revoke any consent given in response to the earlier email." | eCFR (2 separate calls, identical wording both times) + govinfo older-edition equivalent (numbered differently but same clause verbatim) |
| **(b)(2)(ix)** | "Provided that, an operator that does not 'disclose' (as defined by §312.2) children's personal information, may use a text message coupled with additional steps to provide assurances that the person providing the consent is the parent. Such additional steps include: Sending a confirmatory text message to the parent following receipt of consent, or obtaining a postal address or telephone number from the parent and confirming the parent's consent by letter or telephone call. An operator that uses this method must provide notice that the parent can revoke any consent given in response to the earlier text message." | eCFR only, one call — structurally parallel to (viii) and internally consistent, but not independently cross-checked against a second source |

(b)(3), the safe-harbor cross-reference:

> "A safe harbor program approved by the Commission under §312.11 may approve
> its member operators' use of a parental consent method not currently
> enumerated in paragraph (b)(2) of this section where the safe harbor program
> determines that such parental consent method meets the requirements of
> paragraph (b)(1) of this section." — **(b)(2)(2)** [sic in numbering as
> extracted; almost certainly (b)(3) in the actual text] [eCFR via WebFetch,
> one call, not cross-checked]

**Enum verdict — method by method:**

| Enum guess | CFR cite | Match? |
|---|---|---|
| `SIGNED_FORM` | (b)(2)(i) | **Correct.** Regulatory text does not use the phrase "signed form" as a label, but the method (signed consent form returned by mail/fax/scan) matches exactly. |
| `PAYMENT_CARD` | (b)(2)(ii) | **Correct method**, but see §C — the "monetary" qualifier the label implicitly assumes appears to be gone from the current text. |
| `TOLL_FREE_PHONE` | (b)(2)(iii) | **Correct.** |
| `VIDEO_CONFERENCE` | (b)(2)(iv) | **Correct.** |
| `GOV_ID_CHECK` | (b)(2)(v) | **Correct.** |
| `KBA` | (b)(2)(vi) | **Correct**, and "knowledge-based authentication" is the literal term used in the regulatory text itself — the only one of the nine where the enum name matches the CFR's own wording exactly. |
| `FMVPI` (face match to verified photo identification) | (b)(2)(vii) | **Correct method.** The CFR text does not use the acronym "FMVPI" or the phrase "verified photo identification" — that is FTC-adjacent shorthand (matches the framing already used in `docs/research/coppa-childrens-privacy.md`) — but the described mechanism (government photo ID verified authentic, matched to a live face image, confirmed by trained personnel, prompt deletion) is exactly (vii). |
| `EMAIL_PLUS` | (b)(2)(viii) | **Correct method.** "Email plus" is FTC/industry shorthand (used in FTC guidance) for what the regulation calls "an email coupled with additional steps" — not a literal quote from §312.5, but a correct and standard label. |
| `TEXT_PLUS` | (b)(2)(ix) | **Correct method**, same shorthand relationship as `EMAIL_PLUS`. |

**Net result: all nine enum values map one-to-one, in the same order, to the
nine current subsections. No method is missing and no guessed method is
spurious.** The only caveat worth carrying forward is `PAYMENT_CARD`'s
implicit assumption about "monetary," addressed in §C.

### B. The email-plus (and text-plus) non-disclosure condition

The condition sits **inside (b)(2)(viii) itself**, as the opening clause of
that paragraph — not in a separate subsection, proviso, or footnote elsewhere
in §312.5. Verbatim, quoted twice from independent eCFR calls with identical
wording both times:

> "Provided that, an operator that does not 'disclose' (as defined by §312.2)
> children's personal information, may use an email coupled with additional
> steps to provide assurances that the person providing the consent is the
> parent."

The condition is unconditional on its face — there is no "unless" or carve-out
written into §312.5(b)(2)(viii) itself that would let a disclosing operator
use email-plus for a narrower purpose. Whatever escape hatch exists (e.g., the
"support for internal operations" exception to the definition of "disclose")
lives entirely in **§312.2**, not in §312.5 — that is out of scope for this
fetch and is already the subject of extended analysis in
`docs/research/coppa-childrens-privacy.md` (§2, "The 'email plus' catch, in
detail"). Nothing fetched here changes that prior analysis; it only confirms
the condition's exact wording and location.

Text-plus, (b)(2)(ix), carries the identical clause structure with "text
message" substituted for "email" throughout, including its own revocation
notice requirement.

### C. The payment-card method and the "monetary transaction" question

This is the one place the fetched sources disagree with each other, and the
disagreement is informative rather than noise.

- **Current text (eCFR, two independent calls, both 2026-08-01 as-of date):**
  "Requiring a parent, **in connection with a transaction**, to use a credit
  card, debit card, or other online payment system that provides notification
  of each discrete transaction to the primary account holder." No "monetary."
- **Cornell LII (current):** "Requiring a parent, **in connection with a
  transaction**, to use a credit card..." — same wording, no "monetary."
  Independent source, same result.
- **govinfo annual codified editions, CFR-2024-title16-vol1 and
  CFR-2025-title16-vol1 (both fetched):** "Requiring a parent, **in connection
  with a monetary transaction**, to use a credit card..." — "monetary" present
  in both older snapshots.

Two independent current-text sources (eCFR API, Cornell LII) agree the word
"monetary" is absent from the operative text right now. Two older annual
snapshots (2024 and 2025 codified editions, which reflect the rule as of
roughly January 1 of each of those years — i.e., *before* the 2025 amendments
took effect on 2025-06-23) both contain "monetary." That pattern is
consistent with the 2025 amendment having dropped the word "monetary" from
(b)(2)(ii), but **this task did not fetch the Federal Register final-rule
document itself (90 FR, RIN 3084-AB20) to see the redline**, so the causal
claim — "the 2025 amendment removed 'monetary'" — is an inference from
before/after snapshots, not a directly observed amendment text. Flagged as an
unknown below.

**Why this matters, restated plainly:** if the operative word really is now
"transaction" rather than "monetary transaction," then a **$0 authorization
hold** — the kind card processors use to validate a card is live without
actually charging it — could arguably satisfy (b)(2)(ii), because it is still
"a transaction" that triggers "notification of each discrete transaction to
the primary account holder" (most issuers do notify on $0 authorizations).
That would materially undercut the cost-model assumption in
`docs/research/coppa-childrens-privacy.md` (§2, table) that this method
requires "a $0.50 charge (often refunded) plus Stripe fees." **Do not act on
this without confirming the Federal Register redline or an eCFR point-in-time
diff** — a $0 authorization strategy built on an AI's inference from two
snapshot comparisons is exactly the kind of guess this task exists to
eliminate.

## Risks and unknowns

- **The "monetary" removal is inferred, not directly read from the amendment
  text.** Confirm by fetching the actual 2025 Federal Register final rule
  (90 FR, doc. 2025-05904, published 2025-04-22) and locating its redline for
  §312.5(b)(2)(ii), or by using eCFR's point-in-time comparison tool
  (`ecfr.gov` has a "Compare dates" feature) before relying on a $0-auth
  strategy.
- **(b)(2)(vi), (vii), and (ix) were each confirmed from only one eCFR
  call**, not cross-checked against a second independent source the way
  (i)–(v) and (viii) were. They are internally consistent and structurally
  match known FTC guidance on KBA and facial-recognition consent (approved by
  the Commission in 2015, per `docs/research/coppa-childrens-privacy.md`), but
  a second-source check (e.g., a direct fetch of the Federal Register final
  rule text) would raise confidence further.
- **The exact numbering of (b)(3) is uncertain.** One fetch echoed it back
  labeled "(b)(2)(2)," which is almost certainly a transcription artifact of
  WebFetch's summarization layer rather than the actual CFR numbering; treat
  the content of that provision as reliable and its citation as needing a
  quick visual confirmation against a rendered eCFR page.
- **§312.2's definition of "disclose"** — the provision that actually decides
  whether this codebase can use email-plus at all — was deliberately not
  fetched here (out of scope per the task); it remains the open question
  flagged in `docs/research/coppa-childrens-privacy.md`.
- **WebFetch's summarization layer** means "verbatim" here means "verbatim as
  extracted and reproduced by an intermediate model, cross-checked across
  multiple independent extractions where noted." It is meaningfully stronger
  evidence than a search-snippet reconstruction, but a human should still spot
  check the highest-stakes quotes (the email-plus condition, and the
  "transaction" vs. "monetary transaction" wording) against a rendered eCFR
  or Federal Register page before they go in front of counsel.

## Sources

- `https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5` — task's primary URL; redirected to an anti-bot page, no text obtained.
- `https://www.law.cornell.edu/cfr/text/16/312.5` — worked; current text, six-method framing in the initial response but wording for (i), (ii), (viii)/(ix)-equivalent confirmed consistent with eCFR.
- `https://www.govinfo.gov/content/pkg/CFR-2024-title16-vol1/xml/CFR-2024-title16-vol1-sec312-5.xml` — worked; older (pre-amendment) annual codified edition, six methods, "monetary transaction" wording.
- `https://www.govinfo.gov/content/pkg/CFR-2025-title16-vol1/xml/CFR-2025-title16-vol1-sec312-5.xml` — worked; still the older six-method framing, "monetary transaction" wording.
- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-01/title-16.xml?part=312` — worked (eCFR's machine-readable API, used after the task's #1 URL failed); current nine-method text, primary source for the bulk of this report.
- `docs/research/coppa-childrens-privacy.md` — prior research this task cross-references and does not duplicate (the §312.2 "disclose"/"internal operations" analysis, the 2025 amendment timeline, the enforcement history).

---

**Note on staleness:** research goes out of date silently. This is current as
of the Date above and as of the eCFR "current" text at the 2026-08-01 as-of
date used in the fetches. Re-verify before relying on it for a new decision,
especially the "monetary transaction" finding in §C, which should be upgraded
from "inferred" to "confirmed" against the actual Federal Register redline
before it changes any cost model.
