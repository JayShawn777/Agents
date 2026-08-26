# Research: COPPA and children's privacy obligations

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
> **Tooling caveat, stated up front:** this agent had web *search* but not web
> *fetch*. Everything marked `[PRIMARY-SUMMARY]` is a search-engine summary
> attributed to a primary URL (eCFR, Federal Register, ftc.gov, state
> legislature). The agent did **not** read the raw regulatory text end to end.
> Anything load-bearing must be confirmed against the linked source.

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** What US law governs our collection of data about children in an
  AI tutoring app, and specifically what does verifiable parental consent
  actually require of the M0 signup flow?
- **Verdict:** COPPA applies to us — an adult account holder does not change
  that, because the child is the person actually supplying the schoolwork.
  Our M0 assumption that an in-app checkbox/attestation by the signed-in adult
  is verifiable parental consent is **wrong**; §312.5(b)(2) enumerates specific
  methods and a self-attestation by an unverified party is not among them. The
  cheapest lawful route is almost certainly **"email plus"** (§312.5(b)(2)(viii))
  or **"text plus"** (§312.5(b)(2)(ix)), but both are available *only* if we
  never "disclose" a child's personal information — which turns on whether our
  AI vendor is a "service provider providing support for internal operations,"
  a question this research could not settle and a lawyer must.

## Summary

- **COPPA applies.** A homework-help tutor for K–12 students, with avatars and
  grade levels, collecting photos of a nine-year-old's math worksheet, is at
  minimum "mixed audience" and very plausibly "directed to children." The adult
  account holder is irrelevant to the trigger: the child is the one uploading.
- **A checkbox is not verifiable parental consent.** `[PRIMARY-SUMMARY]`
  §312.5(b)(2) lists the accepted methods. All of them independently corroborate
  the consenter's identity or adulthood — signed form, payment-card transaction,
  toll-free call, video call, government-ID check, knowledge-based
  authentication, face-match-to-ID, email-plus, text-plus. "I affirm I am the
  parent" in a form field is none of these.
- **Email-plus / text-plus is the low-friction option — with a condition.** Both
  are restricted to operators that do **not** disclose children's personal
  information to third parties. Whether shipping a child's schoolwork image to
  Anthropic counts as a "disclosure" or falls in the service-provider carve-out
  is the single highest-value legal question for this product. Get it answered.
- **The 2025 amendments are in force now.** Published 2025-04-22, effective
  2025-06-23, full compliance required since **2026-04-22** — i.e. the deadline
  has already passed as of today's date. We are building into an already-current
  regime, not a future one. New: written retention policy that must be published,
  written information-security program, separate consent for third-party
  disclosure, biometric identifiers added to "personal information."
- **The ed-tech / school-consent amendments were NOT finalized.** The FTC pulled
  them to avoid conflicting with a possible FERPA rulemaking. School consent
  therefore still rests on FTC *guidance* (FAQ Section N + the 2022 Ed Tech
  Policy Statement), not codified rule — and it does not apply to a
  direct-to-consumer product at all.
- **FERPA does not attach to us today** and will not until a school or district
  contracts with us and exercises "direct control" over the records.
- **Voice:** an *adult's* voice recording is not a child's personal information
  under COPPA, so COPPA is not the binding constraint on M6 — **Illinois BIPA is**.
  A voiceprint is an enumerated biometric identifier there, with a private right
  of action at $1,000/$5,000 per violation. Texas CUBI applies too (AG-only,
  $25k/violation). Washington's biometric statute probably does *not*, because it
  excludes audio recordings and data derived from them.
- **Our 30-day and 12-month numbers are arbitrary.** They are not illegal, but
  they are undefended. The Rule requires a *stated purpose and business need* for
  every retention window. Retaining the raw source image for 12 months after the
  text has been extracted is the hardest one to justify and the easiest to attack.
- **Enforcement is real and ed-tech-specific.** Epic $275M, Amazon Alexa $25M
  (indefinite retention of children's voice recordings used to train models —
  almost exactly our M6 risk shape), Microsoft $20M, Disney $10M (2025),
  Edmodo $6M suspended (ed-tech, for pushing COPPA compliance onto schools).
  Statutory max is **$53,088 per violation**, and "per violation" has historically
  meant per child.

---

## Findings

### 1. Does COPPA apply to us?

**The statutory trigger.** COPPA and the Rule reach two categories of operator
`[PRIMARY-SUMMARY]`, per 15 U.S.C. §6501 et seq. and 16 CFR §312.3:

1. operators of a website or online service **directed to children** under 13; and
2. operators of a **general-audience** service **with actual knowledge** that they
   are collecting personal information from a child under 13.

**"Directed to children" is a multi-factor test**, not a self-declaration.
`[PRIMARY-SUMMARY]` §312.2 directs the Commission to weigh: subject matter,
visual content, use of animated characters or child-oriented activities and
incentives, music/audio, age of models, child celebrities, language, advertising
directed to children — *plus* "competent and reliable empirical evidence
regarding audience composition" and "evidence regarding the intended audience,
including marketing or promotional materials or plans, representations to
consumers or to third parties, reviews by users or third parties, and the age of
users on similar websites or services."

**Where we land.** Apply the factors to our M0 spec honestly:

| Factor | Our product |
|---|---|
| Subject matter | K–12 homework, grade levels K–12 (`m0-accounts-and-profiles.md`, "Grade levels are an enumerated set covering US K–12") |
| Child-oriented activities/incentives | Practice problems, a tutor persona, an interactive whiteboard |
| Animated characters | **Yes** — "a set of characters" the student picks as an avatar |
| Intended audience per our own marketing | "help with their child's homework" |
| Actual users | Students; explicitly "frequently a minor" in our own data table |

That is not a close call. At minimum we are **mixed audience**; a regulator
could reasonably call us **child-directed**. Either way, personal information
collected from a user we know or should know is under 13 requires notice and
verifiable parental consent (VPC) first.

**"Mixed audience" is a real but narrow safe lane.** `[PRIMARY-SUMMARY]` The
2025-amended §312.2 defines it as a service that *is* directed to children under
the factors above, but "does not target children as its primary audience, and
does not collect personal information from any visitor, other than for the
limited purposes set forth in §312.5(c), prior to collecting age information or
using another means that is reasonably calculated... to determine whether the
visitor is a child. Any collection of age information... must be done in a
neutral manner that does not default to a set age or encourage visitors to
falsify age information."

Two practical consequences for M0:
- Our age gate must be **neutral**. AC 17 keys off a selected grade level / age
  band. A grade dropdown that defaults to nothing and is not accompanied by
  "students 13+ get the full experience" copy is probably neutral. A default of
  "Grade 9" or any nudge toward an older band is not.
- We must not collect *anything* about the student before the age signal. Our
  add-profile form currently gathers display name, grade, subjects and avatar in
  one submit. Grade/age band must be **first** and must gate the rest.

**The adult-account-holder question — this is the one the spec got backwards.**
There is a genuine distinction in COPPA between (a) information a *parent* gives
an operator *about* a child, and (b) information collected *from* the child.
`[PRIMARY-SUMMARY]` FTC guidance frames COPPA as covering information collected
online **from** children, and treats information a parent supplies during the
consent process as parent-supplied data the operator must keep confidential.

Do **not** build on that distinction. It fails for us for three independent reasons:

1. **The child is the uploader.** Our whole product is a student photographing
   their own worksheet. AC 27–33 mint an upload token; the human on the other end
   is the student. That is collection *from* a child.
2. **The uploaded artifact is child-authored content.** Handwriting, name written
   at the top of the worksheet, a school name, a teacher's name. §312.2's
   personal-information definition `[PRIMARY-SUMMARY]` includes "a photograph,
   video, or audio file where such file contains a child's image or voice" and a
   catch-all for information "concerning the child or the parents of that child
   that the operator collects online from the child and combines with an
   identifier." A photo of a page a child wrote, tied to a persistent profile
   with a name and grade, is squarely personal information.
3. **Later milestones make it unarguable.** M3 chat transcripts are text typed by
   a child. M7's "record of what that student is good and bad at" is a persistent
   behavioural profile keyed to an identifier.

**Conclusion:** design as a COPPA-covered operator collecting from children.
Do not attempt a "the parent gave it to us" theory.

---

### 2. What actually counts as verifiable parental consent?

**The standard.** `[PRIMARY-SUMMARY]` §312.5(b)(1): the operator must use a
method "reasonably calculated, in light of available technology, to ensure that
the person providing consent is the child's parent." FTC business guidance
`[PRIMARY]` restates: *"The COPPA Rule does not mandate the method a company must
use to get parental consent. Instead, it says that an operator must choose a
method reasonably designed in light of available technology to ensure that the
person giving the consent is the child's parent."*

**Is our current design sufficient? No.** AC 19 records "the owner supplies their
full name and relationship to the student and affirms consent," plus timestamp,
IP and user agent. Every one of those fields is self-asserted by whoever holds
the session. Nothing in that flow independently corroborates that the person is
an adult, or that they are *that child's* parent. It is an audit trail of an
assertion, not verification. The name/IP/UA record is worth keeping — it is
good evidence *once* you have a real method — but on its own it is not VPC.

The M0 spec's own open question already suspected this. The suspicion is correct.

**The enumerated methods.** `[PRIMARY-SUMMARY]` §312.5(b)(2), as amended 2025:

| # | Method | What it actually costs us |
|---|---|---|
| (i) | **Signed consent form** returned by postal mail, fax, or electronic scan ("print-and-sign") | Cheapest to build (generate PDF, accept an upload). Brutal friction — completion rates crater. No vendor fee. Sometimes called the "print and send" method. |
| (ii) | **Payment-card / online payment transaction** that notifies the primary account holder of each discrete transaction | Very common in practice. Note the requirement is *notification of a discrete transaction* — a stored card on file with no charge does not qualify. A $0.50 charge (often refunded) plus Stripe fees; ~2.9%+30¢ economics make micro-charges lossy. Best fit if we are charging for the product anyway — then consent rides on the real subscription payment. |
| (iii) | **Toll-free number staffed by trained personnel** | Requires humans. Realistically a vendor. |
| (iv) | **Video-conference with trained personnel** | Requires humans. Highest friction of all. |
| (v) | **Government-ID check against a database**, ID deleted promptly after verification | Vendor territory. Typically ~$0.50–$3 per verification (NOT verified — get current quotes). Creates a new sensitive-data handling problem for the window you hold the ID. |
| (vi) | **Knowledge-based authentication (KBA)** — `[PRIMARY-SUMMARY]` must use dynamic, multiple-choice questions, enough questions and answer options that guessing has low probability, and difficulty such that "a child age 12 or younger could not reasonably ascertain the answers" | Vendor (the credit-bureau-style out-of-wallet question providers). Fails for adults with thin credit files, recent immigrants, and young parents — a real equity and support-cost problem. |
| (vii) | **Face match to verified photo ID (FMVPI)** — government photo ID verified as authentic, compared by facial recognition against a live selfie, confirmed by trained personnel; ID and images promptly deleted after the match | Vendor (Yoti/Jumio class). Approved by the Commission in 2015 `[PRIMARY]`. Good UX for parents, but we would be processing a face image — which is itself a biometric identifier under the amended Rule and under BIPA. Ironic and non-trivial. |
| (viii) | **"Email plus"** — email consent *coupled with additional steps*: a confirmatory email sent after receipt of consent, **or** obtaining a postal address/phone number and confirming by letter or phone call. **Only available to operators that do not "disclose" children's PI.** | Nearly free. Cheapest by a wide margin. Entirely dependent on the disclosure question below. |
| (ix) | **"Text plus"** — the same structure over SMS. `[PRIMARY-SUMMARY]` added in the 2025 amendments; permits texting the parent to initiate consent, deliver the direct notice, and obtain consent. **Same non-disclosure restriction.** | Cheap (Twilio-class per-message cost). Better completion than email. Newest and least tested. |

Plus: `[PRIMARY-SUMMARY]` §312.5(b)(3)/(c) — an FTC-approved **safe harbor program**
may approve a non-enumerated method for its members, and §312.12 provides a
voluntary Commission approval process for new methods. Joining a safe harbor
(kidSAFE, ESRB, PRIVO, TRUSTe/TrustArc are the FTC-approved programs) is a
separate, real option worth pricing.

**The "email plus" catch, in detail — this is the crux.**

`[PRIMARY-SUMMARY]` §312.2 defines **"disclosure"** as the release of a child's
personal information in identifiable form for any purpose, **except** where the
operator provides it to "a person who provides support for the internal
operations of the website or online service and who does not use or disclose it
for any other purpose"; plus making PI publicly available.

**"Support for the internal operations"** is a *closed, enumerated* definition,
not a general vendor exception. `[PRIMARY-SUMMARY]` It covers activities
necessary to: maintain or analyze the functioning of the service; perform network
communications; authenticate users and personalize content; serve contextual
advertising or cap ad frequency; protect security or integrity; ensure legal or
regulatory compliance; and fulfil a request of a child under §312.5(c)(3)–(4).
And critically: *"the information collected for the activities listed... cannot
be used or disclosed to contact a specific individual, including through
behavioral advertising, to amass a profile on a specific individual, or for any
other purpose."*

So: **when we POST a child's worksheet image to Anthropic's API, is that a
disclosure?**

- Argument it is *not*: Anthropic is a processor under a commercial API
  agreement, does not train on API inputs by default, and its function is
  "maintain or analyze the functioning of the service" / "personalize content."
- Argument it *is*: the enumerated list is about infrastructure and
  personalization, not about outsourcing the product's core substantive
  processing to a third party's models. And our very purpose is to "amass a
  profile on a specific individual" (M7 mastery tracking), which the definition
  expressly forbids for internal-operations data.

**This research cannot resolve that.** It is the single most consequential open
question in the compliance design, because it decides whether we can use a
free consent method or must pay per-parent for an identity check. Put it in
front of counsel with the actual Anthropic DPA/commercial terms attached.
See "Risks and unknowns."

**Related: §312.5(a)(2) separate consent for third-party disclosure.**
`[PRIMARY-SUMMARY]` As amended: operators must give parents the option to consent
to collection and use **without** consenting to disclosure to third parties,
*unless the disclosure is integral to the website or online service*, and must
obtain **separate** VPC for that disclosure. `[PRIMARY]` FTC press release
(2025-01-16): operators "will be required to obtain separate verifiable parental
consent to disclose children's personal information to third-party companies
related to targeted advertising or other purposes."

For us: if Anthropic *is* a third-party disclosure, the "integral" carve-out is
a strong argument — an AI tutor that cannot send work to an AI is not the
product. But "integral" excuses only the *separate consent*; §312.4 still
requires the direct notice to name the third parties and their purposes.
`[PRIMARY-SUMMARY]` The direct notice must state the items of PI collected, how
it will be used, the potential opportunities for disclosure, and, where PI is
disclosed to third parties, **the identities of those third parties**.

**Practical read:** our direct notice must name Anthropic (and later ElevenLabs
and Vercel Blob) by name and say what each receives.

---

### 3. The school / educational exception

**What the exception is.** `[PRIMARY-SUMMARY]` It has never been in the text of
the Rule. It lives in FTC guidance — the COPPA FAQs (Section N, "COPPA and
Schools") and the **Policy Statement on Education Technology** `[PRIMARY]`
(2022-05-19). The substance: a **school** may provide consent on behalf of
parents to an ed-tech operator's collection of student personal information,
**but only** where the information is used for a **school-authorized educational
purpose and for no other commercial purpose**. `[PRIMARY-SUMMARY]` This holds
whether the learning happens in a classroom or at home at the school's direction.

The 2022 Policy Statement adds, `[PRIMARY-SUMMARY]`, that ed-tech operators
relying on school authorization: may use the data *only* to provide the requested
service; are barred from marketing, advertising, or other unrelated commercial
use; may not retain longer than reasonably necessary; must maintain
confidentiality/security/integrity procedures; and may not condition access on
agreeing to broader surveillance.

**The 2025 amendments deliberately did NOT codify it.** `[PRIMARY-SUMMARY]`
The FTC proposed definitions of "school" and "school-authorized education
purpose" plus a codified school-authorization exception in the 2024 NPRM, then
declined to finalize them — expressly "to avoid making amendments to the COPPA
Rule that may conflict with potential amendments to [the Department of
Education's] FERPA regulations." So as of today the school route is **guidance,
not regulation**, and it is subject to change on short notice. Anyone citing
"the new COPPA school exception" is describing a proposal that was withdrawn.

**Does it apply to us? No — not for M0.** The exception is triggered by a school
authorizing collection for a school-directed purpose. We are direct-to-consumer:
a parent finds us, pays us, and uses us at home for their own reasons. There is
no school in the loop to authorize anything. We must obtain parental consent
directly.

**What changes if we later sell to schools.** Two hard lessons from the FTC's
`[PRIMARY]` **Edmodo** action (2023):

1. **You cannot outsource your COPPA compliance to the school.** The FTC alleged
   Edmodo "unlawfully outsourc[ed] its COPPA compliance responsibilities to
   schools and teachers while providing confusing and inaccurate information
   about obtaining consent." Even under school authorization, the operator
   remains responsible. If we ship a school tier, we must give schools accurate,
   specific notice material and verify the authorization is real — a checkbox in
   a teacher-signup flow reproduces Edmodo's exact failure mode.
2. **The commercial-purpose line is absolute.** Edmodo used school-collected
   student data for advertising. Any secondary use — including, plausibly,
   training or improving our own models on school-sourced student work —
   destroys the exception.

Also from Edmodo: the FTC obtained an order prohibiting requiring students to
hand over more personal data than necessary to participate — a data-minimization
obligation with teeth, echoing §312.7's prohibition on conditioning a child's
participation on disclosing more PI than is reasonably necessary.

**If we go to schools, we also inherit FERPA** (see §7) and a thicket of state
student-privacy statutes (California SOPIPA, New York Ed Law 2-d, Illinois SOPPA
and others) which impose contract terms, breach notification and deletion duties
that COPPA does not. That is a separate research task; do not assume the D2C
compliance posture ports over.

---

### 4. The 2025 COPPA Rule amendments — what changed and when

**Dates (all `[PRIMARY-SUMMARY]`, from the Federal Register notice and FTC's
rule page):**

| Event | Date |
|---|---|
| Commission announced final amendments | 2025-01-16 |
| Published in the Federal Register (90 FR, RIN 3084-AB20, doc. 2025-05904) | **2025-04-22** |
| Amended Rule **effective** | **2025-06-23** |
| **Full compliance required** (all provisions except §312.11(d)(1), (d)(4), (g)) | **2026-04-22** |
| §312.11(d)(1), (d)(4), (g) — safe harbor program provisions | earlier dates, tied to the effective date |

**As of 2026-08-26 the compliance deadline has already passed.** There is no
grace period left to build into. `[PRIMARY-SUMMARY]` No extension or delay of the
COPPA compliance date was found in any FTC or Federal Register source searched.

**What changed, provision by provision:**

**a) Data retention and deletion — §312.10.** `[PRIMARY-SUMMARY]` Substantially
rewritten. The current text:
- PI collected online from a child **"may not be retained indefinitely."**
- Retain "only as long as is reasonably necessary to fulfill the specific
  purpose(s) for which the information was collected."
- When no longer reasonably necessary, **delete** it "using reasonable measures
  to protect against unauthorized access to, or use of, the information in
  connection with its deletion."
- **New:** establish, implement and maintain a **written data retention policy**
  setting out (i) the purposes for which children's PI is collected, (ii) the
  business need for retaining it, and (iii) **a timeframe for deletion**.
- **New:** that written retention policy must appear in the **notice to parents
  and consumers** — i.e. it is published, not internal.

**b) Written information security program — §312.8.** `[PRIMARY-SUMMARY]` The
old "reasonable procedures" sentence remains, but the amendments add a
Safeguards-Rule-flavoured program with named elements:
- **designate one or more employees** to coordinate the information security
  program;
- perform **risk assessments at least annually** identifying internal and
  external risks to confidentiality, security and integrity;
- design and implement **safeguards** to control those risks, appropriate to the
  sensitivity of the information and the operator's size, complexity, and scope;
- **regularly test and monitor** the effectiveness of those safeguards;
- **at least annually evaluate and modify** the program in light of identified
  risks, testing results, new technology, or changed circumstances;
- before allowing another operator/service provider/third party to collect or
  maintain children's PI on our behalf, or before releasing children's PI to
  them, **take reasonable steps to determine they are capable** of maintaining
  confidentiality, security and integrity.

For a small team this is a real, dated artifact: a document, a named owner, an
annual calendar entry, and a vendor-assessment file for Anthropic, Vercel, Neon
and the email provider. It is not satisfied by "we use HTTPS."

**c) Separate consent for third-party disclosure — §312.5(a)(2).** Covered in §2
above. `[PRIMARY-SUMMARY]` Parents must be able to consent to collection/use
without consenting to third-party disclosure, unless disclosure is integral;
separate VPC required where the option must be offered.

**d) Biometric identifiers added to "personal information" — §312.2.**
`[PRIMARY-SUMMARY]` The definition now includes *"a biometric identifier that can
be used for the automated or semi-automated recognition of an individual, such as
fingerprints, handprints, retina patterns, iris patterns, genetic data (including
a DNA sequence), voiceprints, gait patterns, facial templates, or faceprints."*
The Commission's stated intent was to reach imagery converted into templates or
numeric representations usable to identify a specific individual, while excluding
derived data that cannot identify anyone. **Government-issued identifiers** were
also added.

**e) Notice — §312.4.** `[PRIMARY-SUMMARY]` Expanded content requirements: the
direct notice must set out the items of PI to be collected, how it will be used,
the potential opportunities for disclosure, and where PI is disclosed to third
parties, **the identities of those third parties**. The online notice must
include the retention policy from (a).

**f) Mixed audience** — newly defined term, see §1.

**g) Not finalized:** the ed-tech/school amendments, and proposed restrictions on
push notifications to children. `[PRIMARY-SUMMARY]` Roughly 300 comments were
received; these were among the changes the Commission declined to adopt.

**h) Newer than the amendments — the age-verification enforcement policy
statement.** `[PRIMARY]` On **2026-02-25** the FTC issued a policy statement that
it **will not bring a COPPA Rule enforcement action** against general-audience or
mixed-audience operators that collect, use or disclose personal information
*solely* to determine a user's age, without first obtaining VPC, provided they:
(i) do not use or disclose that information for any purpose other than
determining age; (ii) do not retain it longer than necessary for that purpose and
delete it promptly thereafter; and (iii) disclose it only to third parties they
have taken reasonable steps to determine are capable of maintaining
confidentiality, security and integrity. The Commission also held an
age-verification/estimation workshop on 2026-01-28.

**Why this matters to us:** it removes a genuine chicken-and-egg problem. If we
want to run an age-estimation or ID step *before* consent, this statement says
the FTC will not treat that pre-consent collection as a violation, so long as
the data is single-purpose and promptly deleted. Note carefully: it is an
*enforcement policy statement*, not a rule. It binds the Commission's
prosecutorial discretion, not private plaintiffs, not state AGs (who can enforce
COPPA under 15 U.S.C. §6504), and not a future Commission.

---

### 5. Voice as a biometric / personal identifier

**Part A — COPPA.**

`[PRIMARY-SUMMARY]` "Personal information" under §312.2 includes "a photograph,
video, or audio file where such file contains **a child's** image or voice," and,
post-2025, voiceprints as biometric identifiers. COPPA's obligations attach to
personal information **collected online from a child**.

An adult parent recording their own voice, in an adult-authenticated flow, with
their own recorded permission, is **not** a child's personal information. COPPA
is therefore **not** the binding constraint on the M6 cloned-parent-voice feature.

Three caveats that are binding anyway:

1. **The recording flow must be structurally adult-only.** If a child can reach
   the record button — or holds the phone while a parent speaks, or records a
   parent-figure who is not the account holder — you have collected a voice file
   through a child-facing surface. Make it impossible in code, not in policy.
   The M0 spec's instinct here is right; keep it.
2. **Any child voice input in M3/M5 is squarely COPPA PI.** The FTC's 2017
   `[PRIMARY]` **Enforcement Policy Statement on the Collection and Use of Voice
   Recordings** carves out a narrow non-enforcement lane: an audio file
   containing a child's voice collected **solely as a replacement for written
   words** (to perform a search or fulfil a verbal instruction), **held only
   briefly**, used for **no other purpose**, and disclosed in the privacy policy.
   It expressly does **not** apply where the operator requests information via
   voice that would itself be personal information (e.g. a name). Voice cloning,
   voiceprinting, or model improvement destroys the exception outright.
3. **Amazon Alexa is the cautionary precedent and it is our exact shape.**
   `[PRIMARY]` 2023: $25M civil penalty. The FTC/DOJ alleged Amazon kept
   children's voice recordings indefinitely, undermined parents' deletion
   requests, and used the recordings to train speech recognition — the FTC's own
   blog notes children's speech patterns differ from adults', making the
   unlawfully retained recordings "a valuable database for training the Alexa
   algorithm... at the expense of children's privacy." If we ever hold child
   audio and use it to improve anything, this is the case that gets cited at us.

**Part B — state biometric law. This is the real constraint on M6.**

**Illinois — BIPA, 740 ILCS 14.** `[PRIMARY-SUMMARY]`
- "Biometric identifier" expressly includes **"voiceprint"** (along with retina/iris
  scan, fingerprint, scan of hand or face geometry). It expressly excludes
  writing samples, written signatures, **photographs**, demographic data, and
  physical descriptions. Note what is *not* excluded: audio.
- §15(b): no capture/collection without first (i) informing the subject in
  writing that a biometric identifier is being collected/stored, (ii) informing
  them in writing of the specific purpose and length of term, and (iii) receiving
  a **written release** from the subject.
- §15(a): a publicly available written retention schedule and destruction
  guidelines — destroy when the purpose is satisfied or within 3 years of the
  last interaction, whichever is first.
- §15(c): no selling, leasing, trading, or otherwise **profiting from** a
  person's biometric identifier. Worth a lawyer's eye: if a cloned parent voice
  is a paid feature, is that "profiting from" the voiceprint?
- §15(d): no disclosure/redisclosure without consent — relevant because the clone
  is created at **ElevenLabs**, a third party. The parent's written release must
  cover that transfer.
- §15(e): reasonable standard of care, at least as protective as for other
  confidential and sensitive information.
- **Private right of action**, liquidated damages **$1,000 per negligent
  violation / $5,000 per intentional or reckless violation**, plus attorneys'
  fees. This is why BIPA, not COPPA, is the M6 risk.
- **2024 amendment (SB 2979 / Public Act 103-0769):** limits recovery to a
  **single** recovery per person per method of collection (overruling the
  per-scan accumulation theory) and clarifies that an **electronic signature**
  satisfies "written release." `[PRIMARY-SUMMARY]` from ilga.gov; the
  per-collection-method limitation was widely reported but I could not read the
  enacted text directly — **verify before relying on it as a damages ceiling.**
- **Voice AI is an active litigation front.** `[SECONDARY]` An ABA article and
  several plaintiff-firm and vendor blogs describe a wave of BIPA voiceprint
  suits against AI transcription and voice-model companies, including a claimed
  set of coordinated N.D. Ill. actions filed in May 2026 against major AI/voice
  vendors. **I could not verify any of these dockets from a primary source.**
  Treat the trend as real and the specifics as unconfirmed.

**Texas — CUBI, Tex. Bus. & Com. Code ch. 503.** `[PRIMARY-SUMMARY]`
- "Biometric identifier" includes **voiceprint**.
- May not capture a biometric identifier for a **commercial purpose** unless the
  person is **informed** and **consents** before capture.
- Restricts sale/lease/disclosure; requires destruction "within a reasonable
  time," and (per the AG's guidance page) not later than one year after the
  purpose for collection expires.
- **No private right of action.** AG-exclusive enforcement, civil penalty up to
  **$25,000 per violation**. The Texas AG has been notably active here (the
  state's suit against Google over biometrics).

**Washington — RCW 19.375.** `[PRIMARY-SUMMARY]` This one probably does **not**
reach us, and the reason is worth knowing precisely. RCW 19.375.010 defines a
biometric identifier as data generated by automatic measurements of biological
characteristics such as "a fingerprint, **voiceprint**, eye retinas, irises, or
other unique biological patterns," but then says it **"does not include a
physical or digital photograph, video or audio recording or data generated
therefrom."** A voiceprint derived from an audio recording is arguably squarely
inside that exclusion. Enforcement is via the Consumer Protection Act, AG-driven;
no private right of action under the biometric statute itself. **Flag anyway:**
Washington's *My Health My Data Act* (RCW 19.373) has a much broader biometric
definition **and a private right of action** via the CPA — it is scoped to
"consumer health data," which an academic-tutoring voice clone should not be, but
"struggles with reading" edging toward a learning-disability inference is not a
theory I would want to test. Not researched further; out of scope here.

**Also relevant to voice cloning, briefly, not researched in depth:**
right-of-publicity / digital-replica statutes (Tennessee's ELVIS Act, and
similar 2024–2026 state laws), plus ElevenLabs' contractual consent obligation
already documented in `docs/research/elevenlabs-tts.md` (their Prohibited Use
Policy bans replicating a voice without consent, and bans voice data from anyone
under 18 outright). Our recorded-consent artifact serves three masters at once:
BIPA §15(b) written release, CUBI notice+consent, and the ElevenLabs contract.
Design it to satisfy the strictest — BIPA — and the others follow.

---

### 6. Retention and deletion

**What the Rule requires.** From §312.10 (see §4a) and §312.6:

`[PRIMARY-SUMMARY]` §312.6 — the operator must give a parent, at any time:
- the opportunity to **refuse** further use or future online collection of PI
  from that child;
- the ability to **direct the operator to delete** the child's PI;
- a **means of reviewing** the PI collected from the child;
- and the means employed must **ensure the requestor is a parent of that child**,
  taking available technology into account.

Note that last clause. Our M0 delete/withdraw paths (AC 14, 23, 35, 36) run off
the authenticated account session. That is a defensible identity signal for the
person who created the account — but it also means the *review* right (AC has no
equivalent) is missing. **We have no "show me everything you hold about my
child" surface.** The spec defers "data export/portability" to later and names it
as "a likely regulatory requirement." It is more than likely; §312.6(a)(1)'s
review right is not optional, though it can be satisfied by a screen rather than
a file export.

`[PRIMARY-SUMMARY]` §312.7 — cannot condition a child's participation on
disclosing more PI than is reasonably necessary. Combined with §312.10's
purpose-limitation, this is a data-minimization obligation, not a nicety.

**Are our numbers defensible? Partly. Here is the honest assessment.**

**"30-day account grace period" (AC 36).** The spec is candid: *"ASSUMPTION: 30
days is the grace period; no regulator has specified one."* Correct — no source
found specifies any grace period. The risk is not the number; it is **what the
window applies to**:

- As a **soft-delete for account recovery after the account holder deletes their
  own account**, 30 days is a normal industry practice and, if disclosed in the
  retention policy with a stated business need ("protect families against
  accidental or malicious deletion"), it is defensible under §312.10.
- As a **delay on honouring an explicit §312.6 deletion request**, it is
  **not defensible**. When a parent says "delete my child's data," the Rule
  contemplates deletion, and the Amazon Alexa complaint is precisely about
  undermining parents' deletion requests. **Split the two paths.** "Close my
  account" may carry a 30-day recovery window. "Delete my child's data" must
  execute promptly, and the UI must not silently route the second into the first.

**"12-month retention of source files."** This is the weakest assumption in the
spec, and I would expect a reviewer to reject it as written. §312.10 asks for the
**business need**. Once M1 has extracted the problem text, what is the business
need for the original photograph of a nine-year-old's worksheet?

- Plausible needs: re-extraction after a model upgrade; showing the parent what
  was uploaded (the §312.6 review right); dispute/abuse investigation.
- Each of those justifies a *different, shorter* window than 12 months, and none
  of them justifies 12 months by default for every file.

Recommended shape (a proposal, not a legal conclusion): tier the retention and
write the tiers into the published policy —

| Data | Proposed window | Stated business need |
|---|---|---|
| Uploaded image/PDF (raw source) | **short** — days to a few weeks after successful extraction, then delete | re-extraction on failure; parent review of a recent upload |
| Extracted problem text | duration of active account | the tutoring product itself |
| Mastery / strengths-and-weaknesses record | duration of active account | adaptive tutoring (M7), the core value proposition |
| Profile (display name, grade, subjects, avatar) | duration of active account | account function |
| Consent record | see below | evidence of lawful basis |
| Data collected solely to obtain consent, where consent is never given | **14 days**, then delete | see Microsoft order below |

**The consent-record retention question the spec flags as open** ("Keeping it
conflicts with the deletion promise; destroying it conflicts with auditability")
is a genuinely hard one and I found **no** authoritative answer. What I can say:
the consent record's *subject* is the adult, and the only child-identifying field
in it is the student profile ID. A reasonable design — again, for counsel to
approve — is to purge the child-identifying fields on deletion and retain a
**pseudonymised** consent artifact (consent version, method used, timestamp,
adult identity hash) as the audit trail. Keep the window configurable as the spec
already requires.

**A concrete gap in the current spec: the CONSENT_REQUIRED limbo.** AC 17
creates a profile holding the child's **display name and grade level** and puts
it in `CONSENT_REQUIRED`. AC 21 says an abandoned consent flow leaves it there.
That is child personal information, collected before VPC, retained forever.

`[PRIMARY-SUMMARY]` The FTC's **Microsoft/Xbox** order (2023, $20M) required
Microsoft "to delete, within two weeks from the collection date, all personal
information collected from kids for the purpose of getting parental consent
unless the parent grants consent within that time." That is not a rule of general
application, but it is the clearest available signal of what the FTC considers
adequate. **Add an acceptance criterion: a profile that has not reached ACTIVE
within 14 days of creation is purged, along with any data collected for it.**

---

### 7. FERPA

**When it attaches.** `[PRIMARY-SUMMARY]` FERPA (20 U.S.C. §1232g; 34 CFR part
99) regulates **educational agencies and institutions that receive US Department
of Education funds**. It protects "education records," defined as records that
are (1) directly related to a student and (2) **maintained by an educational
agency or institution, or by a party acting for the agency or institution**.

A vendor becomes subject to FERPA-derived obligations only through the **school
official exception**, 34 CFR §99.31(a)(1)(i)(B): a school may disclose PII from
education records without consent to a contractor to whom it has outsourced an
institutional service, provided the outside party (i) performs a function the
school would otherwise use employees for, (ii) is **under the direct control of
the school** with respect to the use and maintenance of education records, and
(iii) uses the information only for the purposes of the disclosure and does not
redisclose without consent.

**Does it matter for us today? No.**

We have no school. Nothing we hold was "maintained by an educational agency." A
photograph of a worksheet that a *parent's* child uploaded to a *parent's*
account is not an education record, however educational its content. FERPA is
irrelevant to M0–M7 as currently specified.

**Two things to hold onto anyway:**

1. **It is a switch, not a slope.** The moment a district signs a contract and
   sends us rostering data or authorizes collection, we become a school official
   under direct control, and we inherit: use limited to the disclosure purpose,
   no redisclosure without consent, annual-notification support, and the school's
   right to direct correction and deletion. `[PRIMARY-SUMMARY]` A written
   agreement is a documented best practice rather than a FERPA requirement — but
   several state student-privacy laws *do* require one, and no district will sign
   without it. Do not let a school pilot happen by accident through a sales
   conversation.
2. **`app/CLAUDE.md` currently asserts FERPA obligations attach to us.** It says
   "anything touching student data carries COPPA/FERPA consent and retention
   obligations." For COPPA that is right. For FERPA it is, on this research,
   **not correct for the current direct-to-consumer design**. Overstating the
   legal position is its own kind of risk: it makes the real COPPA obligations
   harder to see and invites cargo-cult compliance. Worth correcting to
   "COPPA now; FERPA only if and when we contract with a school."

Related, not researched: **PPRA** (20 U.S.C. §1232h) applies to programs funded
by the Department of Education and governs surveys and the collection of student
information for marketing — same trigger, same answer, same future switch.

---

### 8. Penalties and enforcement reality

**The number.** COPPA is enforced as an FTC Rule violation, carrying civil
penalties under §5(m) of the FTC Act. `[PRIMARY-SUMMARY]` The FTC's 2025
inflation adjustment set the maximum at **$53,088 per violation**, up from
$51,744. `[PRIMARY-SUMMARY]` Per OMB guidance dated 2026-04-17 there is **no 2026
inflation adjustment** — the lapse in appropriations in October 2025 prevented BLS
from calculating the October 2025 CPI-U — so the **2025 amounts remain in effect
through calendar year 2026, until 2027-01-14**.

"Per violation" has in practice been read as per child, per day, or per incident
depending on the theory. With a few thousand child profiles, arithmetic gets
existential quickly. Actual penalties are negotiated well below the theoretical
maximum, but the maximum is what sets the negotiating position.

**Who can sue.** The FTC (via DOJ for civil penalties) and, under 15 U.S.C.
§6504, **state attorneys general**. There is no COPPA private right of action —
but state UDAP and biometric statutes supply one, and plaintiffs' firms use them.

**Recent actions worth knowing** (all `[PRIMARY]`, ftc.gov):

| Case | Date | Penalty | Violation shape |
|---|---|---|---|
| **Epic Games** (Fortnite) | Dec 2022 | **$275M** COPPA penalty (+$245M dark-patterns settlement) | Child-directed service collecting PI from under-13s without notice or VPC. Largest penalty ever for violating an FTC rule. |
| **Amazon (Alexa)** | May 2023 | **$25M** | Retained children's voice recordings **indefinitely**, undermined parents' deletion requests, used retained voice data to improve speech recognition. Order required overhauled deletion practices. |
| **Microsoft (Xbox)** | Jun 2023 | **$20M** | Collected PI at signup before notifying parents / obtaining consent; illegally retained children's data. Order: delete consent-purpose data within 14 days if consent not granted. |
| **Edmodo** (ed-tech) | May 2023 | **$6M**, suspended for inability to pay | Used student data for advertising; **outsourced COPPA compliance to schools and teachers** with confusing and inaccurate consent information. First FTC unfairness count over an operator's interaction with schools. |
| **Cognosphere / HoYoverse** (Genshin Impact) | Jan 2025 | **$20M** | Marketed to children and collected PI in violation of COPPA; loot-box deception. Order required **deleting previously collected under-13 data** absent consent. |
| **Disney** | Sep 2025 (order approved Dec 2025) | **$10M** | Failed to label child-directed YouTube uploads "Made for Kids," enabling data collection from child viewers without notice or VPC. |
| **Apitor Technology** (robot toys) | 2025 (order Dec 2025) | **$500K**, suspended for inability to pay | A third-party SDK sent children's **geolocation** to a party in China; no notice, no consent — despite a privacy policy claiming COPPA compliance. |
| **Iconic Hearts / Sendit** | Filed Sep 2025 | pending | Unlawful collection of children's data plus deceptive messaging and subscription practices; **the CEO was named individually.** |

**What this pattern tells us about our specific risk posture:**

1. **Retention is now a first-class violation, not a footnote.** Amazon,
   Microsoft and Cognosphere were all charged partly on retention/deletion. Our
   12-month source-file assumption sits directly in this line of fire.
2. **Using children's data to improve models is the aggravating factor** that
   turned Amazon from a paperwork case into a headline. Whatever we decide about
   training or evals, decide it explicitly and write it down.
3. **Third-party SDKs and vendors are your violation.** Apitor was penalised for
   what a vendor's SDK did. The FTC published a blog in Sep 2025 specifically on
   third-party software in child-directed apps. Our Anthropic/ElevenLabs/Vercel/
   Neon chain is our problem, which is exactly why amended §312.8 requires us to
   assess them.
4. **A privacy policy that claims COPPA compliance while the product does not
   is a separate §5 deception count.** Apitor. Do not publish aspirational
   compliance language.
5. **Officers can be named personally.** Iconic Hearts.
6. **Inability to pay reduces the cheque, not the order.** Edmodo and Apitor both
   got suspended penalties and still carry multi-year injunctive obligations,
   compliance reporting, and recordkeeping. "We're small" is not a defence; it is
   at best a payment plan.

---

### 9. Practical recommendation — minimum defensible consent architecture for M0

**The design principle:** collect **nothing** about a child before VPC is
complete, and make the consent method a **versioned, swappable strategy** so that
the answer to the Anthropic-disclosure question can change the method without a
data migration.

**The signup flow, concretely:**

**Step 1 — Adult account creation.** Email magic link as specced. Keep AC 6's
18+ affirmation. Understand what it is: an age gate for the *account holder*,
not consent. It carries no COPPA weight on its own.

**Step 2 — "Who is this for?" — a neutral age gate, before anything else.**
Ask *only* the age band / grade level. No name, no subjects, no avatar. Neutral
presentation: no default selection, no copy that hints which answer unlocks more.
This is what makes the mixed-audience definition available to us. If the answer
is 13+, proceed as today. If under 13, branch to Step 3.

**Step 3 — Direct notice to the parent, before collection.** A §312.4-compliant
screen (and the same content emailed, so there is a record) stating:
- the specific items of PI we will collect from the child — uploaded schoolwork
  images/PDFs, extracted problem text, display name, grade level, subjects,
  avatar selection, and later the strengths/weaknesses record;
- how each is used;
- the **named third parties** that receive it and why — Anthropic (reads the
  schoolwork), Vercel (stores the files), Neon (stores the records), the email
  provider (adult's address only);
- that the parent may review, refuse further collection, and require deletion,
  and how;
- the **published data retention policy** (§312.10) — the table from §6 above;
- a link to the full online privacy policy.

**Step 4 — Verifiable parental consent, by an enumerated §312.5(b)(2) method.**
Build it as an interface with pluggable implementations. Ship one of:

- **If counsel concludes we make no "disclosure"** (Anthropic is a service
  provider for internal operations): **email plus** — send the notice and a
  consent link to the adult's email; on submission, send a **confirmatory email**
  to the same address with an easy "I did not consent / undo" action and a delay
  before activation. Near-zero cost. This is the target.
- **If counsel concludes we do disclose, or is unwilling to opine:** the
  **payment-card method** if we are charging anyway (consent rides the real
  subscription charge, which notifies the primary account holder of a discrete
  transaction — this is the natural fit and costs nothing extra), or a
  **face-match-to-verified-ID vendor** if we are free-tier at launch. Price both.
  Do not ship KBA as the only path — its failure modes are discriminatory.

Whichever ships, the flow must be **fail-closed**: no student profile fields are
persisted, and no upload token can be minted, until consent status is verified.

**Step 5 — Only now collect the student profile.** Display name, subjects,
avatar. Keep AC 12's ban on avatar photo uploads — it is the single best
decision in the spec.

**Changes to the M0 acceptance criteria, specifically:**

- **Rewrite AC 19.** "Supplies their full name and relationship and affirms
  consent" is not VPC. Keep the record fields — name, relationship, scope,
  consent-text version, UTC timestamp, IP, user agent — and **add**: `method`
  (enum: `EMAIL_PLUS`, `TEXT_PLUS`, `PAYMENT_CARD`, `FMVPI`, ...),
  `methodEvidence` (opaque, method-specific — confirmation token, processor
  reference, vendor verification ID), and `verifiedAt` distinct from
  `submittedAt`. The versioning instinct in the spec is exactly right; this makes
  it operational.
- **Reorder AC 17 and AC 8.** Age band must be captured and must gate profile
  creation, not accompany it.
- **New AC:** a profile that has not reached `ACTIVE` within **14 days** of
  creation is purged along with all data collected for it (Microsoft-order shape).
- **New AC:** a parent can **review** all personal information held about a
  student profile from within the app (§312.6(a)(1)). A read-only screen listing
  profile fields, uploaded files and extracted text satisfies this; a file export
  is not required.
- **Split AC 36.** "Close account" may carry the 30-day recovery window.
  "Delete my child's data" must execute promptly and must be reachable
  independently of account closure.
- **Amend AC 18** to also present the **published retention policy** and the
  **named third parties** — both are now §312.4/§312.10 requirements, not
  nice-to-haves.
- **Replace the flat 12-month source-file retention** with the tiered table in §6,
  and store every window as configuration, as the spec already requires.

**Non-flow deliverables that are now legally required and have no owner:**

1. A **written data retention policy**, published in the notice (§312.10).
2. A **written information security program** with a named coordinating employee,
   an annual risk assessment, testing, and an annual review (§312.8).
3. A **vendor capability assessment** file for Anthropic, Vercel, Neon and the
   email provider (§312.8), completed *before* any child data flows to them.
4. A decision, written down, on whether children's data is ever used to train,
   fine-tune, or evaluate any model. Given Amazon Alexa, the defensible answer is
   an unambiguous no, contractually enforced against Anthropic and ElevenLabs.

**Deferred to M6, but decide the architecture now:** the parent voice-clone
consent artifact must satisfy **BIPA §15(b)** — written (electronic signature is
sufficient per the 2024 amendment) notice of collection, the specific purpose,
the retention term, an explicit release covering transfer to ElevenLabs, and a
publicly posted retention/destruction schedule under §15(a). Build it to BIPA
and Texas CUBI is satisfied incidentally. This is a *different artifact* from the
M0 consent record, exactly as the spec anticipates.

---

## Risks and unknowns

Things I could **not** verify, in rough order of how much they matter:

1. **Is sending a child's schoolwork to Anthropic a "disclosure" under §312.2, or
   is Anthropic a service provider "providing support for the internal
   operations"?** Unresolved, and it decides whether the free consent methods
   (email-plus/text-plus) are available to us or whether we pay per parent. The
   enumerated internal-operations list is closed and its own text forbids using
   such data "to amass a profile on a specific individual" — which is literally
   the M7 feature. **This needs counsel, with the Anthropic commercial terms in
   hand. It is the highest-value question in this document.**
2. **I did not read the raw regulatory text.** No web-fetch tool was available.
   Every `[PRIMARY-SUMMARY]` claim is a search-engine summary attributed to a
   primary URL. Section numbers, subsection letters, and quoted phrases should be
   confirmed against eCFR and the Federal Register notice before anything is
   built on them. In particular I never saw §312.5(b)(2) as a continuous list and
   am inferring the (viii)/(ix) numbering from summaries.
3. **The 2024 BIPA amendment's damages limitation.** SB 2979 / PA 103-0769 is
   real and I located it on ilga.gov, but I could not read the enacted text. Do
   not rely on "single recovery per method of collection" as a damages ceiling
   without confirming it.
4. **The May 2026 BIPA voiceprint class actions** against major AI/voice vendors
   are reported only in secondary, low-quality sources (plaintiff-firm and vendor
   blogs) plus one ABA article. **No docket verified.** The trend is plausible;
   the specifics are unconfirmed and should not be cited to anyone.
5. **Whether the FTC's COPPA FAQs have been fully updated post-amendment.**
   Search results said updated FAQs exist to supplement compliance materials, but
   I could not confirm which FAQs were revised or when. Where the FAQs and the
   2025 Rule text conflict, **the Rule text is primary and controls.** Section N
   (schools) in particular predates the withdrawn ed-tech amendments and should
   be read with that in mind.
6. **Vendor pricing for identity/consent verification** (Yoti, Jumio, PRIVO,
   kidSAFE, ESRB safe harbor membership). I stated no figures because I verified
   none. If the payment-card path is not viable, someone must actually get quotes.
7. **Whether the FTC's 2026-02-25 age-verification policy statement covers a
   *child-directed* (as opposed to general-audience or mixed-audience) service.**
   The press summary names general and mixed audience only. If we are found to be
   child-directed rather than mixed audience, the statement may not shelter our
   pre-consent age collection at all. Unresolved.
8. **State comprehensive privacy laws.** Only skimmed. Connecticut treats data
   from a known child as sensitive requiring opt-in, requires opt-in for
   sale/targeted advertising under 16, and from **2026-07-01** bans processing
   minors' data for targeted advertising or sale and bans addictive design
   features aimed at extending minors' use. Colorado requires consent for
   sensitive data and imposes duties of care and minimization. Roughly twenty
   states now have comprehensive laws with minor-specific provisions. **This is a
   separate research task and is not covered here.**
9. **App-store age-verification laws.** Texas SB 2420 (App Store Accountability
   Act) took effect 2026-01-01 but `[PRIMARY-SUMMARY]` was **blocked by a federal
   district judge in December 2025**, with the Texas AG appealing. Utah has SB 142
   (2025). These bind app stores and impose downstream developer duties. **Not
   relevant while we are web-only; becomes relevant the day we ship a native
   app.** Current litigation status not verified beyond the above.
10. **How long to retain a consent record after account deletion.** No
    authoritative answer found anywhere. The pseudonymisation proposal in §6 is
    my reasoning, not law.
11. **International.** Zero UK/EU research done. UK Age Appropriate Design Code
    and GDPR Art. 8 (digital age of consent, 13–16 depending on member state) are
    materially stricter than COPPA in places. Deployment is US-first per the
    brief; the moment that changes, this document is insufficient.

---

## Sources

**Statute and Rule text**
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312 — **PRIMARY.** The COPPA Rule, 16 CFR part 312, current text including the 2025 amendments.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.2 — **PRIMARY.** Definitions: "directed to children," "mixed audience," "personal information" (incl. biometric identifiers), "disclosure," "support for the internal operations."
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.4 — **PRIMARY.** Notice: direct-notice contents, third-party identities, retention policy in the online notice.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.5 — **PRIMARY.** Parental consent: the §312.5(b)(1) standard and the §312.5(b)(2) enumerated methods.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.6 — **PRIMARY.** Parent's right to review, refuse further use, and direct deletion.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.7 — **PRIMARY.** No conditioning participation on excess data collection.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.8 — **PRIMARY.** Confidentiality, security, integrity — the written security program elements.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.10 — **PRIMARY.** Data retention and deletion; written retention policy; no indefinite retention.
- https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.12 — **PRIMARY.** Voluntary Commission approval process for new consent methods.

**The 2025 amendments**
- https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule — **PRIMARY.** The final rule as published. Effective 2025-06-23; compliance 2026-04-22; Statement of Basis and Purpose explaining what was and was not finalized (incl. the withdrawn ed-tech amendments).
- https://www.govinfo.gov/content/pkg/FR-2025-04-22/pdf/2025-05904.pdf — **PRIMARY.** Same document, official PDF (90 FR No. 76).
- https://www.ftc.gov/legal-library/browse/federal-register-notices/16-cfr-part-312-coppa-final-rule-amendments — **PRIMARY.** FTC's landing page for the final rule amendments.
- https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data — **PRIMARY.** FTC announcement, 2025-01-16: separate consent for third-party disclosure, retention limits, biometric and government identifiers.
- https://www.ftc.gov/system/files/ftc_gov/pdf/coppa_sbp_1.16_0.pdf — **PRIMARY.** Statement of Basis and Purpose PDF.

**FTC guidance**
- https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions — **PRIMARY.** The COPPA FAQs. Section N covers schools. Update status post-amendment unconfirmed.
- https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule — **PRIMARY.** FTC page on VPC; source of the "reasonably designed in light of available technology" framing and the note that the Rule does not mandate a method.
- https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business — **PRIMARY.** Six-step compliance plan.
- https://www.ftc.gov/legal-library/browse/policy-statement-federal-trade-commission-education-technology-childrens-online-privacy-protection — **PRIMARY.** 2022 Ed Tech Policy Statement: school-authorized purpose only, no commercial use, retention and security duties.
- https://www.ftc.gov/system/files/documents/public_statements/1266473/coppa_policy_statement_audiorecordings.pdf — **PRIMARY.** 2017 enforcement policy statement on children's voice recordings; the narrow voice-as-text-replacement non-enforcement lane.
- https://www.ftc.gov/news-events/news/press-releases/2026/02/ftc-issues-coppa-policy-statement-incentivize-use-age-verification-technologies-protect-children — **PRIMARY.** 2026-02-25 age-verification enforcement policy statement.
- https://www.ftc.gov/system/files/ftc_gov/pdf/coppa-age-verification-policy-statement.pdf — **PRIMARY.** The statement itself.
- https://www.ftc.gov/business-guidance/blog/2025/09/using-third-partys-software-your-app-make-sure-youre-all-complying-coppa — **PRIMARY.** FTC business blog on third-party SDKs and COPPA responsibility.
- https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions — **PRIMARY.** 6(b) inquiry into AI companion chatbots, explicitly including COPPA compliance for children and teens.

**Enforcement actions**
- https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations — **PRIMARY.** Epic Games, $275M COPPA penalty.
- https://www.ftc.gov/news-events/news/press-releases/2023/05/ftc-doj-charge-amazon-violating-childrens-privacy-law-keeping-kids-alexa-voice-recordings-forever — **PRIMARY.** Amazon Alexa, $25M; indefinite retention of children's voice data and undermined deletion requests.
- https://www.ftc.gov/news-events/news/press-releases/2023/06/ftc-will-require-microsoft-pay-20-million-over-charges-it-illegally-collected-personal-information — **PRIMARY.** Microsoft/Xbox, $20M; the 14-day delete-consent-purpose-data requirement.
- https://www.ftc.gov/news-events/news/press-releases/2023/05/ftc-says-ed-tech-provider-edmodo-unlawfully-used-childrens-personal-information-advertising — **PRIMARY.** Edmodo, $6M suspended; outsourcing COPPA compliance to schools.
- https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental — **PRIMARY.** Cognosphere/HoYoverse, $20M, Jan 2025; deletion of previously collected under-13 data.
- https://www.ftc.gov/news-events/news/press-releases/2025/09/disney-pay-10-million-settle-ftc-allegations-company-enabled-unlawful-collection-childrens-personal — **PRIMARY.** Disney, $10M, Sep 2025 (order approved Dec 2025).
- https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-takes-action-against-robot-toy-maker-allowing-collection-childrens-data-without-parental-consent — **PRIMARY.** Apitor, $500K suspended; third-party SDK geolocation collection.
- https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-alleges-sendit-app-its-ceo-unlawfully-collected-personal-data-children-deceived-users-about — **PRIMARY.** Iconic Hearts/Sendit, Sep 2025; CEO named individually.
- https://www.ftc.gov/news-events/topics/protecting-consumer-privacy-security/kids-privacy-coppa — **PRIMARY.** FTC's running index of COPPA enforcement.

**Penalty amounts**
- https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-publishes-inflation-adjusted-civil-penalty-amounts-2025 — **PRIMARY.** 2025 maximum of $53,088 per violation.
- https://www.federalregister.gov/documents/2026/07/07/2026-13629/no-adjustment-to-civil-monetary-penalty-amounts — **PRIMARY.** No 2026 inflation adjustment; 2025 amounts remain in effect through 2026.

**FERPA**
- https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-D/section-99.31 — **PRIMARY.** 34 CFR §99.31, incl. the school official exception at (a)(1)(i)(B).
- https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa — **PRIMARY.** ED guidance on who qualifies and the "direct control" requirement.
- https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf — **PRIMARY.** ED's Responsibilities of Third-Party Service Providers under FERPA.
- https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Student%20Privacy%20and%20Online%20Educational%20Services%20(February%202014)_0.pdf — **PRIMARY.** ED guidance on online educational services, incl. click-wrap consumer apps.

**State biometric law**
- https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3004 — **PRIMARY.** Illinois BIPA, 740 ILCS 14; "voiceprint" enumerated; §15(a)–(e); §20 damages.
- https://www.ilga.gov/legislation/103/SB/10300SB2979.htm and https://www.ilga.gov/Legislation/publicacts/view/103-0769 — **PRIMARY.** The 2024 BIPA amendment (single recovery; electronic signature). Enacted text not read — verify.
- https://statutes.capitol.texas.gov/Docs/BC/htm/BC.503.HTM — **PRIMARY.** Texas CUBI; notice + consent before capture; up to $25,000 per violation; AG-only.
- https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/biometric-identifier-act — **PRIMARY.** Texas AG's CUBI guidance page.
- https://app.leg.wa.gov/RCW/default.aspx?cite=19.375.010 — **PRIMARY.** Washington RCW 19.375.010; the exclusion of "a physical or digital photograph, video or audio recording or data generated therefrom."
- https://www.americanbar.org/groups/litigation/resources/newsletters/class-actions-derivative-suits/voiceprints-ai-bipa-new-trends-biometric-privacy-litigation/ — **SECONDARY.** ABA overview of voiceprint/AI BIPA litigation trends. Reputable but secondary; no docket verified.

**State comprehensive / app-store law (skimmed only)**
- https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act — **PRIMARY.** CTDPA; child data as sensitive; under-16 opt-in; 2026-07-01 minor provisions.
- https://coag.gov/resources/colorado-privacy-act/ — **PRIMARY.** Colorado Privacy Act duties incl. consent for sensitive data.
- https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.HTM — **PRIMARY.** Texas SB 2420, App Store Accountability Act (enjoined Dec 2025, on appeal).
- https://le.utah.gov/~2025/bills/static/SB0142.html — **PRIMARY.** Utah SB 142, App Store Accountability Act.

**Internal cross-references**
- `/workspaces/Agents/app/docs/specs/m0-accounts-and-profiles.md` — the spec whose consent assumption this research overturns (AC 17–24, and the "Is an in-app attestation sufficient" open question).
- `/workspaces/Agents/app/docs/research/elevenlabs-tts.md` — already establishes that voice-clone consent is a contractual obligation on us with no API field, and that ElevenLabs bans under-18 voice data outright.

---

**Note on staleness:** research goes out of date silently. Anything in here is
only true as of the Date above. Re-verify version numbers, pricing, and API
shapes before relying on them for a new decision.
