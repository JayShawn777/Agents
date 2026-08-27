---
name: project-tutor-app-evidence-gap
description: M1 extraction accuracy has never been measured and M2 mastery, M7's parent report and every product claim compound on top of it — treat this as the project's load-bearing unknown
metadata:
  type: project
---

**Fact:** as of 2026-08-27, extraction accuracy on real worksheets has never been
measured. M2's grading rests on it, M2's mastery rests on grading, and M7's parent
report rests on mastery. Three of the six M2–M7 specs flag this themselves; M7
calls it "blocking for the claim."

The architecture plan (`docs/plans/m2-m7-implementation.md` §9.0, §10) recommends
moving the measurement **into M2** rather than deferring it to M7 — ~50 hand-
labelled real worksheets, problem-level precision and recall — and adds three
structural mitigations: provenance columns (`SkillMastery.modelGradedCount`,
`LearnerProfile.modelGradedShare`), an evidence floor before a skill reaches a
parent surface, and a parent report that leads with countable facts and labels the
model's narrative summary as inference rather than as the headline.

**Why:** the failure is asymmetric. A child can see that a practice problem is
nonsense; a parent cannot see that "struggles with unlike denominators" came from
a 6 misread as a 5. The error accumulates and the audience simultaneously loses
the ability to detect it.

**How to apply:** any future design touching mastery, the learner profile or the
parent report should check whether the measurement has actually happened before
treating a mastery level as meaningful. If a new surface presents a model's
conclusion about a child to an adult, it needs the same evidence floor and the
same "this is what we believe, tell us if it's wrong" framing.

Separately and durably: **M0's `RETENTION_POLICY` in `lib/config.ts` had no row
for practice, attempts, mastery, transcripts, lesson scripts, playback,
narration, voice samples, learner profiles or activity sessions.** Every M2–M7
spec correctly declined to state its own window because M0 owns them, so the gap
was invisible from any single spec. Check that array against any new model that
stores something.

Related: [[feedback-say-the-uncomfortable-thing]].
