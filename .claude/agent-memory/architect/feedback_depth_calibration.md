---
name: feedback-depth-calibration
description: Calibrate architecture depth to whether the assumptions underneath are measured — full contract for the next milestone, shape-only for anything resting on an unmeasured unknown
metadata:
  type: feedback
---

Do not write a detailed API contract on top of an unmeasured assumption. Go
**deep** (full routes, zod shapes, component tree, file-by-file order) only for
the milestone(s) about to be built, whose assumptions are settled. Go **shallow**
(models, major modules, seams, and an explicit list of what must be measured
first) for anything whose spec names a real technical unknown.

The one deliberate exception: **design the whole data model at full depth across
every milestone in scope, in one pass.** Migrations are immutable once applied,
and a schema designed one milestone at a time accumulates corrective migrations
instead of decisions.

**Why:** the owner said it directly when commissioning the M2–M7 plan — "designing
a detailed contract on top of an unmeasured assumption produces a document that
gets thrown away." He also wants to stop spending time on preliminaries, so the
answer is not "plan less", it is "plan at the depth the evidence supports."

**How to apply:** when a spec's open questions say TECHNICAL UNKNOWN or
"measure before the architect commits to a shape", that milestone gets shape-only
treatment plus a numbered measurement table with pass/fail thresholds and a stated
consequence for each failure. Say plainly which milestones got which depth and
why, at the top of the plan. Related: [[feedback-say-the-uncomfortable-thing]].
