# Research: Functional and information-architecture patterns of online tutoring / homework-help products

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** What functional and IA conventions do existing tutoring/homework-help products use (navigation, capture flow, explanation format, parent/child split, mastery modeling, taxonomy, session scoping, monetization), and which should our no-human-tutor, under-13-capable AI tutor adopt or reject?
- **Verdict:** The category splits cleanly into three models — human marketplace (Tutor.com), automated solver (Photomath, Symbolab, ex-Socratic), and hybrid AI+community+human (Chegg, Brainly) — plus a newer "true AI tutor" cohort (Khanmigo, Synthesis Tutor, Ello, Gemini Guided Learning) that is the closest analogue to our product. The clearest, best-evidenced convention worth adopting is IXL/Khan Academy's parent-account-owns-billing / child-has-supervised-profile structure with COPPA-compliant consent, because it is the one pattern actually built for real under-13 use rather than a ToS fiction. The clearest anti-pattern to avoid is Chegg's cancellation flow, which cost it a $7.5M FTC settlement — directly relevant to our "Never force-push, never bury cancellation" instincts, made concrete.

## Summary
- **Three business models exist and the distinction matters legally and functionally:** human marketplace (Tutor.com), AI/automated solver (Photomath, Symbolab, ex-Socratic), and hybrid AI+community+human (Chegg, Brainly). A fourth, newer cohort — Khanmigo, Google Gemini Guided Learning, Synthesis Tutor, Ello — is pure-AI conversational/adaptive tutoring, the closest functional analogue to our product. [ONLINE]
- **Most "homework help" apps duck COPPA by setting the age floor at 13 in their Terms of Service** (Photomath, Brainly) and making the *parent* contractually responsible for the child's use, rather than building real verifiable-parental-consent flows. Only the products built for young children from the start (IXL, Khan Academy Kids, Synthesis, Ello) have actual parent-account/child-profile architectures with COPPA consent and a KidSAFE-style certification. Our product cannot take the ToS shortcut since we explicitly target under-13. [ONLINE]
- **The capture flow for photo-based math solvers is consistently 3 steps** (frame/crop → scan → step solution), and every one of them explicitly documents the single-problem-per-frame constraint and an in-app "Edit" affordance for misreads — this is the standard failure-recovery pattern, not an edge case. [ONLINE]
- **Mastery modeling is per-skill, not per-topic**, in both dominant systems (IXL's SmartScore 0-100 per skill; Khan Academy's mastery levels per skill within a course/unit tree), and both publish a taxonomy but not real internal difficulty-adaptation code — treat any "algorithm" description as vendor-published methodology, not an audited spec.
- **A real, adoptable public taxonomy exists**: Common Core State Standards (math and ELA) plus NGSS for science, exposed in machine-readable form via the 1EdTech CASE standard. Both IXL and Khan Academy align their skill trees to Common Core/state standards; we do not need to invent a taxonomy from scratch.
- **Monetization has converged on subscription with soft per-item gates**, not the old per-question micropayment model: Chegg moved from pay-per-question to a monthly cap (20 questions) or unlimited tier; Quizlet gates AI features (Q-Chat successor, Magic Notes, full Learn/Test mode) behind Plus; Photomath and Symbolab gate deeper step explanations and animated walkthroughs behind a subscription, keeping basic scan-and-answer free.
- **The single most damaging, well-documented failure mode is dark-pattern cancellation** — Chegg paid the FTC $7.5M in September 2025 for burying cancellation and continuing to charge ~200,000 users after they cancelled. This is now enforced by the FTC's "click-to-cancel" rule; it is a legal risk, not just a UX nice-to-have.
- **The second most common complaint across every camera-based product is misread/wrong-answer erosion of trust** (Photomath, Chegg, Brainly all show this in reviews), and the mitigating pattern everywhere is an explicit, low-friction "this isn't my problem / edit it" correction step shown immediately next to the recognized input — not buried in settings.
- **IXL's own SmartScore is simultaneously its best-loved and most-hated feature**: parents and students report real anxiety from a scoring system that can go down for wrong answers even after high effort, and "the Challenge Zone" (steep penalties near mastery) is the most-cited stressor in review aggregation. This is a direct cautionary data point for any of our UI that shows a shrinking/punitive mastery number to a child.
- **On explanation format, the research does not support "video wins"**: worked examples and modeled-video explanations perform comparably in controlled studies, and multiple studies find that student *preference* for video does not track with better learning outcomes — a caution against assuming our whiteboard/voice format is pedagogically superior just because it's more engaging.

## Findings

### 1. Information architecture

| Product | Model | Top-level nav | Primary dashboard action | "Help with this problem" vs "browse and learn" |
|---|---|---|---|---|
| Tutor.com | Human marketplace | Subjects, Schedule, Favorites, My Account | "Connect with a Tutor Now" (on-demand queue) | Problem-help IS the product; there is no separate browse/learn mode — everything routes to a live session. |
| Khan Academy (web) | AI-augmented free courseware | Courses/subjects, redesigned Learner Dashboard (classes, mastery progress, "what to focus on next"), Khanmigo chat entry point | Continue current course/mastery challenge | Browse-and-learn is primary; Khanmigo chat sits alongside content as an assistant, not the entry point. |
| Khan Academy Kids (app, separate product) | Free content, ages 2-8 | Simple activity map, not course navigation | Pick an activity | No "problem help" concept — pure browse/play. |
| IXL | Adaptive practice (K-12) | "My IXL" (dashboard), subjects (Math/ELA/Science/Social Studies), Diagnostic, Analytics/Awards | Jump into a Recommendations-wall skill, or continue the Diagnostic | No photo-capture; browsing skills IS the primary action, mastery practice is the whole product. |
| Photomath | AI solver | Effectively single-screen: camera viewfinder is the home screen; History and (paid) Notebook/Explanations are secondary | Point camera, scan | "Get help with this problem" IS the landing screen — there is no browse/learn destination at all in the free product. |
| Symbolab | AI solver + practice | Calculator/solver (primary), Practice app (separate), Graphing | Type or scan an expression | Same as Photomath — solver-first; a *separate* companion app ("Symbolab Practice") exists for browse-and-drill. |
| Chegg | Hybrid (expert Q&A + AI + study tools) | Study (Q&A/expert answers), Writing, Math Solver, Textbook Solutions, Practice | Ask a question / snap a photo of a problem | Problem-help and browse (textbook solutions, practice sets) are co-equal top-level tabs. |
| Brainly | Hybrid (AI + community + live tutor) | Camera solver, Ask a question (community), Live tutor connect, Subjects/library | Scan a problem or ask a question | Problem-help is the dominant entry point; "browse" exists as a searchable answer library (SEO-driven), not a curriculum. |
| Quizlet | Study tools | Sets/Library, Learn, Test, Match/Gravity (games), Magic Notes (AI) | Continue studying a set / create a set from notes | No problem-capture concept; it's pure browse-and-drill over user- or AI-generated content. |
| Socratic (Google) | AI solver — **discontinued as a standalone app in 2025**, folded into Google Lens | N/A | Point Lens camera | Was solver-only, same as Photomath; now subsumed into a general-purpose visual search tool rather than a dedicated study surface. |
| Khanmigo / Gemini Guided Learning | Pure AI tutor (chat) | Chat is the interface; "Guided Learning" mode toggle in Gemini | Ask a question in chat, tutor mode replies with Socratic guidance + multimodal aids (diagrams, quizzes, curated video) instead of a direct answer | Problem-help and "learn a topic" collapse into the same chat surface — there's no separate browse destination. |
| Synthesis Tutor | Pure AI tutor, K-5 math | Single conversational session flow (no course browsing) | Continue today's session with the AI tutor persona | No browse mode; the AI sequences everything. |
| Ello | Pure AI tutor, reading, ages 4-9 | Book library + adaptive "next" recommendation, separate Parent Dashboard | Read the next recommended book with AI listening | Structured "I do / we do / you do" flow is the whole app; no ad hoc problem-capture. |

**Returning-user landing pattern:** the products with genuine skill-tracking (Khan Academy, IXL) land the returning user on "what to work on next" (recommendations/mastery-gap driven), not a generic home screen. The pure solvers (Photomath, Symbolab) land the returning user directly back on the capture tool, with History as a secondary tab — there is no "progress" concept to return to. The hybrids (Chegg, Brainly) land on a mixed feed of recent questions + subject browse. This is a meaningful design fork: **solvers treat every visit as a fresh, stateless task; skill-platforms treat every visit as a continuation of a persistent arc.** Our product's stated design (adapts to the student over time) puts us structurally in the Khan Academy/IXL camp for returning-user landing, even though the *entry point* (photograph schoolwork) looks like the solver camp.

### 2. The capture flow (photo-based products)

Consistent 3-step pattern across Photomath, Chegg, and Brainly: **frame/crop → recognize → present step solution.**
- Photomath: viewfinder has draggable crop corners; documentation explicitly instructs "make sure only one problem is in the frame ... Photomath might get confused if there's more than one problem in your photo." Multi-problem pages are handled by the user manually isolating one problem per capture, not by the app segmenting a worksheet.
- Misread correction: Photomath shows the OCR'd expression as an editable field next to the solution; if it doesn't match, the user taps an Edit (pen) icon and retypes via a math keyboard — a lightweight, in-flow correction rather than a re-scan requirement.
- Chegg: scan-and-submit routes to a human expert queue (or AI answer) rather than instant on-device recognition; turnaround is framed in minutes ("as little as 30 minutes," average ~46 minutes for expert answers), so its "capture flow" ends in a wait state, not an instant result — a materially different UX contract than Photomath/Symbolab's real-time solve.
- Brainly: camera scan gives an "instant" AI answer plus step explanation, with community Q&A and live-tutor connect as fallback paths when the scan/AI answer is insufficient or the student wants a deeper explanation.
- Socratic (now folded into Google Lens) had the same single-problem-per-frame constraint; Lens is a general visual-search tool, so per-problem correction UX is less specialized than a dedicated study app.

**Pattern for us:** none of these products auto-segment a photographed page with multiple problems into separate solvable units — they all push that burden onto the user via crop-before-scan. Since our product explicitly ingests "schoolwork" (which is very likely to be multi-problem worksheets), this is a real gap in the category, not a solved problem we can copy. We should treat multi-problem segmentation as a genuine open design/engineering question rather than assuming any competitor has a good answer.

### 3. Explanation surfaces

Formats observed: step-by-step text cards (Photomath, Symbolab, Chegg), community-written text answers (Brainly, Chegg), live two-way chat/voice with shared whiteboard (Tutor.com, Khanmigo, Gemini Guided Learning), and short instructional video (Chegg, some Brainly answers). Animated/narrated walkthroughs are a paid-tier feature on Photomath ("Photomath Plus").

On evidence for outcomes vs. engagement — this is the one place vendor marketing is loudest and independent research is most needed:
- [ONLINE, independent research] Controlled studies find worked (static, step-by-step) examples and modeled/video examples produce **comparable** learning, near-transfer, effort, and self-efficacy outcomes — video is not shown to be pedagogically superior to well-designed static worked examples (ScienceDirect, "Comparing the effects of worked examples and modeling examples on learning").
- [ONLINE, independent research] Multiple studies explicitly find that **student preference for video does not track with better comprehension/learning outcomes** — students like video for flexibility (rewatch, speed control) but this convenience does not reliably convert to deeper learning (Springer, "Can videos affect learning outcomes?"; medical-education study on format choice vs. clinical-reasoning outcomes).
- [ONLINE, vendor claim — NOT independently verified] Google states students using short LearnLM tutoring sessions were "5.5 percentage points more likely to solve novel problems on subsequent topics than students who worked with human tutors alone." This is a first-party claim in Google's own promotional material; flag as marketing until an independent study is located. No comparable independent efficacy study was found for Khanmigo, Synthesis Tutor, or Ello's learning outcomes — their public evidence is Trustpilot/App Store sentiment and internal blog claims, which measure engagement/satisfaction, not learning gain.

**Implication for us:** our narrated interactive whiteboard is an engagement bet, not a proven-superior pedagogy bet. That's fine as a product decision, but we should not internally justify it with "research shows video/narration teaches better" — the literature doesn't support that framing, and we should say so plainly if asked.

### 4. The parent/child split

This is the most legally load-bearing section given our under-13 scope.

- **IXL**: real parent-account architecture. A parent purchases a Family Membership with a credit card, creates child profiles under their own account, and IXL's Children's Privacy Policy plus KidSAFE certification (an FTC-approved COPPA Safe Harbor program) governs data handling for those profiles. Parent-facing analytics show SmartScore per skill, Diagnostic level, and time-on-task; the child sees their own dashboard (Recommendations wall, awards, current assignments) without the account/billing controls.
- **Khan Academy**: two separate account systems. On khanacademy.org, a Parent Dashboard lets a parent view "Activity Overview" (learning minutes, skills practiced/mastered, per-course breakdown) and per-child Khanmigo chat history/settings; the child logs into their own Learner Dashboard focused on "what to work on next," without visibility into the parent's account controls. Khan Academy Kids (ages 2-8) is a **structurally separate product** with its own parent-signup-then-child-profile flow — accounts are not linked between Khan Academy Kids and khanacademy.org.
- **Synthesis Tutor / Ello**: both are architected for exactly our scenario (adult-owns-account, child is the user, ages roughly 4-11). Ello's Parent Dashboard is explicitly scoped to "what your child worked on, which skills they've mastered, what Ello is focusing on next" — i.e., mastery-state reporting, not raw transcript access, though Ello's product page also references phonics-level detail. Synthesis's design goal is stated as coaching the child "without direct parental intervention" during the session itself, with parent visibility positioned as after-the-fact, not live oversight.
- **Photomath and Brainly, by contrast, avoid the problem rather than solving it**: both set their Terms of Service minimum age at 13 and either make the parent contractually liable for a younger child's use (Photomath) or reference "verified parental consent" without a visible, product-level parent-account/child-profile structure (Brainly's public terms). Neither appears to have built the IXL/Khan-Academy-Kids-style consent-and-profile architecture; they are solvers that a parent hands to a child, not products designed around the account-holder-is-not-the-learner problem.

**What parent-facing reports actually contain, consolidated across IXL/Khan Academy/Ello:** skills practiced and mastered (not raw answers), time-on-task/learning minutes, current recommended next skill or focus area, and (Khan Academy specifically) AI-chat history/settings for oversight of the Khanmigo conversation. None of the reports reviewed exposed a full raw chat transcript as the primary parent view — mastery/activity summaries are the norm, with chat-history access as a secondary, opt-in-feeling feature (Khan Academy) rather than the headline report.

### 5. Practice and mastery modeling

- **IXL SmartScore**: a 0-100 per-skill score. [ONLINE, vendor-published methodology, not independently audited] IXL's own guide and blog describe it as weighing correctness, question difficulty, recency, and consistency; score above 80 = "proficient," 100 = "mastery"; above 90 enters a "Challenge Zone" where correct answers add only 1-2 points but wrong answers can cost 3-8 points. IXL cites its own research that reaching SmartScore 80 in ≥2 skills/subject/week correlates with test-score gains — this is a vendor-commissioned/vendor-published claim, not a peer-reviewed independent study, and should be treated as such.
- **Khan Academy**: mastery is tracked per skill within a hierarchical course → unit → skill tree, using "mastery challenges" that resurface previously-practiced skills to test retention, not just one-time correctness. No public technical spec of the underlying adaptive-selection algorithm was found; Khan Academy's own materials describe outcomes (skills mastered, minutes) rather than the selection mechanism.
- **Unit of practice** in both is the **skill**, not the worksheet or the standard directly — standards are a tag applied on top of the skill taxonomy (see taxonomy section below), not the base unit students interact with.
- **Next-question selection**: both systems describe adapting difficulty to recent performance (IXL explicitly; Khan Academy implicitly via mastery challenges), but neither publishes the actual item-selection/IRT-style algorithm as a technical spec. **Any claim about "how the algorithm decides the next question" beyond what is quoted above should be treated as unverified** — this task found marketing-level descriptions, not primary technical documentation (no research paper, patent text, or engineering blog with implementation detail was located for either).

### 6. Subject taxonomy

- Common Core State Standards (Math and ELA/Literacy) plus, for science, the Next Generation Science Standards (NGSS) are the de facto public taxonomies that both IXL and Khan Academy align to, alongside individual state standards (since several large states, e.g., Texas, use their own standards instead of Common Core).
- A real interoperability standard exists for representing this machine-readably: **1EdTech's CASE (Competencies and Academic Standards Exchange) specification**, which exposes standards/competencies as JSON via a REST API rather than as static PDFs, specifically so ed-tech systems don't have to re-tag content per vendor. The **CASE Network** is a public registry of these machine-readable frameworks.
- **Recommendation-relevant fact**: we do not need to invent a subject/grade taxonomy. Common Core (+ state variants) is the standard content structure the category converges on, and CASE is the standard machine-readable format for consuming it, if/when we want to tag generated practice to a real standard (useful for parent-facing "what grade-level skill was this" framing, and for credibility). This is a "use an existing taxonomy" opportunity, not a new-dependency decision, since standards data itself isn't a software dependency — though a CASE-consuming library, if we wanted one, would need separate evaluation and user approval.

### 7. Session scoping

- **Photomath/Symbolab/Chegg (solvers)**: a "session" is scoped to a single problem. Nothing bounds a longer unit of work; the app has no concept of "session end" beyond the user closing it or moving to the next photo.
- **IXL**: scoped per skill (a “practice session” on a skill continues until the student stops or reaches a SmartScore milestone); the Diagnostic is a separate, bounded assessment session with its own start/end.
- **Khan Academy**: scoped per course/unit with mastery challenges periodically interleaved; a "session" in the reporting sense appears to be a time-boxed window of activity (minutes) rather than a designed start/stop ritual.
- **Synthesis Tutor**: explicitly time-boxed — reported as 15-20 minute sessions, several times a week, ended when the AI-guided activity sequence for that session concludes (this is the closest model to a deliberately designed session boundary rather than an open-ended tool).
- **Tutor.com**: scoped to the live session itself — a session starts on connect and ends when the student and tutor finish the assignment or disconnect; there is a natural human-interaction endpoint that AI-only products lack.

**Implication for us**: because we have no human tutor to naturally end a session and no worksheet-level unit like a solver's single-problem scope, we are structurally closest to Synthesis Tutor's model (an AI decides the session's shape) and should look at deliberately time-boxing or task-boxing sessions (e.g., "this worksheet" or a fixed duration) rather than leaving it fully open-ended, which is closer to the Photomath model and doesn't fit a product that claims to adapt "over time."

### 8. Monetization and limits

| Product | Free tier | What's gated | Model |
|---|---|---|---|
| Photomath | Full scan + step solution | Deeper explanations, animated walkthroughs, textbook-specific solutions | Subscription (~$9.99/mo or ~$69.99/yr, "Photomath Plus") |
| Symbolab | Solver access, limited steps shown | Full step-by-step reveal, unlimited practice | Subscription, notably offered **weekly at $0.99** in addition to monthly/annual — an unusually low-commitment entry point |
| Chegg | Very limited | Expert Q&A (moved from **pay-per-question to subscription**: ~$15.95/mo for 20 questions, ~$19.95/mo "Study Pack" for unlimited + extra tools) | Subscription with a monthly question cap as the mid-tier lever |
| Brainly | Community answers (rate-limited/ad-supported) | Full answer unlocking, AI camera solver depth, live tutor access | Subscription (Brainly Plus / tutor add-on); free users report answers as heavily gated |
| Quizlet | Set creation, basic study modes, limited daily rounds | AI features (Magic Notes, AI-quiz generation), full Learn/Test mode, ad-free, textbook Q&A solutions | Subscription (~$2.99-7.99/mo depending on tier/billing) |
| IXL | None meaningful — essentially all practice requires a paid Membership | Nearly everything (Diagnostic, unlimited skill practice, Analytics) | Subscription, per-child or family membership |
| Tutor.com | None (institutional/library access model dominates; also sold direct) | All live sessions | Per-session/subscription or institution-paid |

Two patterns worth naming: (1) **the industry has moved away from pay-per-question toward subscriptions with soft caps** (Chegg's own history is the clearest example of this shift), because per-question billing creates unpredictable costs and cancellation friction that per-question users resent; (2) **the "first taste is free, depth costs money" gate (Photomath) is more trust-preserving than "everything is free until it suddenly isn't" (Brainly)** — Brainly's reviews show far more resentment about surprise gating than Photomath's, which is transparent about what Plus adds from the start.

### 9. What users complain about (cheapest lessons available)

- **Chegg — cancellation dark patterns, now a legal precedent, not just a UX gripe.** [ONLINE, primary source: FTC] In September 2025 the FTC announced a $7.5M settlement after finding Chegg's cancellation flow was buried, required multiple clicks, sometimes redirected "Continue cancellation" to a pause page instead of actually cancelling, and continued charging ~200,000 consumers after they'd requested cancellation — with internal emails allegedly showing an executive saying "there should be some pain involved" in cancelling. This is now squarely inside the FTC's click-to-cancel enforcement priorities. **This is the single most important negative lesson in this research for a subscription business the CLAUDE.md "Never" list already gestures at (never bury cancellation, handle billing carefully).**
- **Photomath — misreads and OCR failures on handwritten/messy input** are the top functional complaint; reviewers report answers to "an entirely different [book] problem" and nonsensical results when the recognizer misparses notation. The mitigation (edit-the-recognized-expression) exists but requires the user to notice the mismatch themselves.
- **Brainly — inconsistent answer quality, aggressive gating, and subscription/refund friction**, with reported difficulty cancelling and complaints of being charged without warning even on ostensibly free accounts; some reviews specifically flag ad safety for children using the app unsupervised, which is directly relevant to us given our under-13 audience — ads are not compatible with the trust model a child-facing product needs.
- **IXL — SmartScore-induced stress**, both from parents (reports of children crying, anxiety framed as normal homework becoming "a stress-inducing endurance test") and from the specific design choice that scores can regress even after real effort near the top of the scale (the "Challenge Zone" penalty asymmetry: +1-2 for correct, -3-8 for incorrect). This is a strong, concrete cautionary example for any of our UI that shows a child a number that can go down.
- **General cross-cutting complaint pattern**: cost/value perception (all subscription products), and "I got the right answer but didn't learn anything" sentiment surfaces in reviews of pure-solver apps (Photomath, Symbolab) — i.e., the product working exactly as designed (giving an answer) is itself sometimes the complaint, from parents/teachers rather than the student-user.

### 10. Which patterns to adopt vs. reject

**Adopt:**
1. **IXL/Khan-Academy-Kids-style account architecture**: adult creates the account and owns billing/consent; each child gets a supervised profile; parent-facing reporting is mastery/activity-summary level (skills worked/mastered, time on task, current focus), not a firehose of raw transcripts. This matches our stated design and is the one pattern in the category actually built — not just claimed — for under-13 COPPA compliance. Cross-reference `docs/research/coppa-childrens-privacy.md` for the legal requirements this must satisfy.
2. **Photomath's in-flow misread-correction affordance**: show the AI's read of the problem next to the answer, editable immediately, rather than forcing a re-photograph. Given we're a chat/whiteboard tutor rather than a flash-answer tool, this should extend further — the tutor should visibly confirm what it read *before* generating practice or explanation, not after.
3. **Transparent, non-surprising gating (Photomath's model over Brainly's)**: if a feature is free vs. paid, say so before the user invests effort, not after they hit a wall mid-task.
4. **Common Core / state-standards taxonomy** as the subject/grade organizing structure, optionally exposed via CASE-style machine-readable tagging later, rather than inventing our own subject hierarchy. This gives parents a legible "what grade-level skill is this" framing for free.
5. **Session-scoping closer to Synthesis Tutor's bounded model** than to the open-ended solver model — because we claim to adapt over time, a session needs a recognizable shape (a worksheet, a topic, a time box) that can feed a mastery model, not just "close the app whenever."
6. **A cancellation flow that is trivially easy** — this is not optional politeness, it's now FTC click-to-cancel enforcement territory, and Chegg is the object lesson.

**Reject:**
1. **The ToS-age-13 dodge (Photomath, Brainly)**: setting minimum age at 13 and calling it the parent's problem is explicitly not available to us since we are targeting under-13 by design — we need the real IXL/Khan-Academy-Kids-style consent architecture, not the disclaimer.
2. **Punitive, decreasing mastery scores shown directly to a child (IXL's SmartScore Challenge Zone)**: the well-documented anxiety this causes in young users is a strong argument for showing children encouragement-framed progress (e.g., "skills growing," streaks, mastery badges that don't regress) while keeping any regression-sensitive number, if we need one at all, in the parent-facing view only.
3. **Ads on a child-facing surface (Brainly's model)**: incompatible with a trust-first, under-13, no-human-tutor product; also a recurring specific complaint in Brainly's reviews about child safety.
4. **Per-question micropayment billing**: the category has already moved away from this (Chegg's own history) because it produces exactly the unpredictable-cost, high-cancellation-friction dynamics we should avoid from day one.
5. **Treating engagement format (video/animation) as proven pedagogy**: the literature doesn't support "our narrated whiteboard teaches better," only "it may be more engaging" — we should market and design around that honestly rather than borrowing vendor outcome claims (like Google's LearnLM figure) that aren't independently verified.
6. **Auto-answer-first flows for a photographed problem** (the Photomath/Symbolab default): since we have no human tutor and are explicitly a *tutoring* product rather than an answer engine, defaulting to "here's the answer" first (rather than "let's work through it") risks becoming exactly the "used it to skip learning" failure mode that shows up in reviews of pure solvers.

## Risks and unknowns
- **No primary technical source was found for either IXL's or Khan Academy's actual adaptive item-selection algorithm.** Both companies publish outcome-oriented descriptions (what the score means, what correlates with test gains) but not an implementation spec. Any future internal design that assumes "IXL/Khan Academy do X algorithmically" should be treated as unverified until a primary technical source (patent, engineering blog, published paper) is found.
- **Vendor efficacy claims (Google's LearnLM 5.5-point figure, IXL's SmartScore-80 test-score correlation, Synthesis's Trustpilot sentiment) are first-party and not independently replicated** in anything found during this research. Treat as marketing, not evidence, for any internal pedagogical decision.
- **Brainly's actual COPPA/parental-consent implementation was not verifiable beyond its own Terms of Service language** — no independent audit or detailed parent-facing flow description was found; it may be more or less real than the terms suggest, but this research could not confirm the mechanism.
- **No product in this survey auto-segments a multi-problem worksheet photo into individually solvable items** — every camera-based competitor pushes single-problem framing onto the user. This means our product, which explicitly ingests "schoolwork" (likely multi-problem), has no direct competitor UX pattern to copy for this specific and probably common case; it needs original design work, not benchmarking.
- **Pricing and free-tier details are current as of August 2026 search results but move often** (Chegg in particular has changed its model at least once already, from per-question to subscription) — re-verify before using any of the above figures in a pricing decision document.
- **This research did not evaluate Photomath's, Symbolab's, or Brainly's actual on-device OCR/recognition accuracy directly** — all accuracy claims here are drawn from user reviews and company support pages describing failure recovery, not from a controlled accuracy test.

## Sources
- [Photomath — official site](https://photomath.com/) — product overview, pricing framing
- [Photomath Help: "What to do when Photomath gives a wrong result?"](https://photomath.com/en/help/wrong-result) — misread correction flow
- [Photomath Help: incorrect solutions/solving steps](https://support.google.com/photomath/answer/14332812?hl=en) — edit-the-recognized-expression pattern
- [Photomath Terms of Service](https://photomath.com/terms/) — age-13 ToS language
- [Photomath for Parents](https://share.photomath.com/en/parents) — parent-facing framing
- [Khan Academy Blog: Meet the New Khan Academy Classroom Experience](https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/) — redesigned teacher/learner dashboard nav
- [Khan Academy Help: What can I do from the Parent Dashboard?](https://support.khanacademy.org/hc/en-us/articles/360039664491-What-can-I-do-from-the-Khan-Academy-Parent-Dashboard) — parent report contents
- [Khan Academy Help: What reports can I use as a parent to monitor activity?](https://support.khanacademy.org/hc/en-us/articles/36120531499789-What-reports-can-I-use-as-a-parent-to-monitor-my-child-s-activity-on-Khan-Academy) — activity/progress report contents
- [Khan Academy Help: If my child is younger than 13, what login options are there?](https://support.khanacademy.org/hc/en-us/articles/202487460-If-my-child-is-younger-than-age-13-what-login-options-are-there) — under-13 account handling
- [Khan Academy Help: Setting up and Managing Child Accounts](https://support.khanacademy.org/hc/en-us/sections/4404527006221-Setting-up-and-Managing-Child-Accounts) — Khan Academy Kids parent/child setup
- [Khan Academy: Is content aligned to Common Core or state standards?](https://support.khanacademy.org/hc/en-us/articles/16758363457805-Is-Khan-Academy-math-content-aligned-to-Common-Core-or-other-U-S-state-standards) — taxonomy alignment
- [IXL: SmartScore, the key to mastery-based learning](https://blog.ixl.com/2020/11/11/ixl-smartscore-the-key-to-mastery-based-learning/) — vendor-published mastery methodology
- [IXL SmartScore Guide (PDF)](https://www.ixl.com/materials/SmartScore_Guide.pdf) — score bands, Challenge Zone mechanics
- [Boddle Learning: Does IXL Punish Wrong Answers?](https://www.boddlelearning.com/article/ixl-punishes-wrong-answers) — independent commentary on SmartScore penalty asymmetry
- [IXL Blog: The IXL dashboard](https://blog.ixl.com/2023/08/13/the-ixl-dashboard-empowering-students-to-own-their-learning/) — student dashboard/recommendations
- [IXL — Common Core math standards](https://www.ixl.com/standards/common-core/math) — taxonomy alignment
- [IXL Service Children's Privacy Policy](https://www.ixl.com/privacypolicy/servicechildrenprivacypolicy) — COPPA/parent account architecture
- [SpellingJoy: Is IXL Safe for Kids? Privacy Review (2026)](https://spellingjoy.com/best-apps/is-ixl-safe-for-kids) — KidSAFE certification mention
- [Chegg — Get 24/7 Homework Help](https://www.chegg.com/) — product structure, subjects
- [MyEngineeringBuddy: Chegg Pricing 2026](https://www.myengineeringbuddy.com/blog/chegg-reviews-alternatives-pricing-offerings-in-2025/) — subscription tiers, question caps
- [FTC: Chegg to Pay $7.5 Million to Settle Cancellation Allegations](https://www.ftc.gov/news-events/news/press-releases/2025/09/ed-tech-provider-chegg-pay-75-million-settle-ftc-allegations-concerning-unlawful-cancellation) — primary source on cancellation dark pattern
- [FTC Chegg Complaint (PDF)](https://www.ftc.gov/system/files/ftc_gov/pdf/Chegg-Complaint_0.pdf) — detailed allegations
- [Cybernews: Chegg fined $7.5M for "impossible" to cancel subscriptions](https://cybernews.com/news/chegg-7-million-ftc-settlement-unfair-cancellation-practices-auto-renewal-subscriptions/) — summary reporting
- [Brainly: AI Homework Helper — Google Play](https://play.google.com/store/apps/details?id=co.brainly&hl=en_US) — feature description
- [Brainly Terms of Use](https://brainly.com/pages/terms_of_use) — age/consent language
- [Trustpilot: Brainly reviews](https://www.trustpilot.com/review/brainly.com?page=3) — user complaints
- [Brighterly: Brainly Reviews 2026](https://brighterly.com/blog/brainly-reviews/) — subscription/cancellation complaints summary
- [Symbolab](https://www.symbolab.com/) — solver product structure
- [Symbolab Practice — App Store](https://apps.apple.com/us/app/symbolab-practice/id1469186281) — separate practice app
- [MyEngineeringBuddy: Symbolab Review 2026](https://www.myengineeringbuddy.com/blog/symbolab-math-solver-reviews-alternatives-pricing/) — pricing tiers including weekly plan
- [Wikipedia: Socratic (Google)](https://en.wikipedia.org/wiki/Socratic_(Google)) — discontinuation/merge into Google Lens
- [Nibble Blog: The Socratic App](https://nibble-app.com/blog/socratic-app) — current status detail
- [Quizlet Blog: Welcome to Quizlet's AI Study Era](https://quizlet.com/blog/ai-study-era) — Q-Chat successor, Magic Notes
- [Nibble Blog: Quizlet Cost in 2026](https://nibble-app.com/blog/quizlet-cost) — free vs. paid gating detail
- [Tutor.com: How It Works](https://www.tutor.com/how-it-works) — live session flow, Socratic method framing
- [Tutor.com Classroom: How It Works (PDF)](https://www.tutor.com/cmspublicfiles/WWW/How_It_Works_Guide_New_Classroom.pdf) — whiteboard/classroom tools
- [Google Blog: Gemini Guided Learning](https://blog.google/products/gemini/guided-learning-google-gemini/) — feature description
- [Google Blog: LearnLM in Gemini 2.5 update](https://blog.google/products-and-platforms/products/education/google-gemini-learnlm-update/) — vendor efficacy claim (5.5 percentage points), flagged as unverified
- [Unite.AI: Synthesis Tutor Review](https://www.unite.ai/synthesis-tutor-review/) — session structure, age range
- [Synthesis Tutor — official](https://www.synthesis.com/tutor) — product description
- [AI Tools for Kids: Synthesis Tutor Review (2025)](https://www.aitoolsforkids.com/blog/synthesis-tutor-review-ai-math-tutor-for-kids) — session length, "without direct parental intervention" framing
- [Ello: How It Works](https://www.ello.com/how-it-works) — "I do, we do, you do" structure, speech model claim
- [Common Sense Media: Ello AI Product Review](https://www.commonsensemedia.org/ai-ratings/ello) — independent review of a child-facing AI tutor
- [1EdTech: Introduction to the CASE Standard](https://www.1edtech.org/standards/case/about) — machine-readable standards taxonomy
- [1EdTech CASE Network Resources](https://www.imsglobal.org/casenetwork/resources) — public standards registry
- [ScienceDirect: Comparing worked examples and modeling examples](https://www.sciencedirect.com/science/article/abs/pii/S0747563214004646) — independent research, format-vs-outcome
- [Springer: Can videos affect learning outcomes?](https://link.springer.com/article/10.1007/s11423-022-10147-3) — independent research, preference-vs-outcome gap
- [NCBI/PMC: Impact of Teaching Format Choice on Clinical Reasoning Outcomes](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6681636/) — independent research, preference-vs-outcome gap

---

**Note on staleness:** research goes out of date silently. Anything in here is
only true as of the Date above. Re-verify version numbers, pricing, and API
shapes before relying on them for a new decision. Pricing, free-tier gating, and
product-availability facts (especially Chegg's pricing model and Socratic's
Google Lens integration) are exactly the kind of thing that moves quickly in
this category — confirm current state before using any figure in a pricing or
positioning document.
