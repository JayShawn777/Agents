---
name: feedback-review-technique
description: How to review this repo's client rendering code — mutate the implementation and re-run, and stub getBoundingClientRect because jsdom measures everything as 0x0
metadata:
  type: feedback
---

Review layout/measurement code in this repo by **mutating the implementation and
re-running the suite**, and by stubbing `getBoundingClientRect` when the logic
under review depends on layout.

**Why:** jsdom returns a 0x0 rect for every element, so anything in
`components/lessons/stage.tsx` (and any future measure-then-draw surface) is
structurally invisible to the unit suite — the guards that skip work when the
container has no size mean the whole code path never executes. On 2026-08-28 the
M4 layout-pass fix was proven untested by deleting its offset from the element
transform: 55/55 tests still passed. A faithful harness (stub the stage rect to
343x257 and make each element's rect a function of the offset already written
into its inline `transform`) exercised the real convergence loop in seconds.

**How to apply:** for any diff touching measurement, animation, or geometry
application, (1) delete or invert the new behaviour and re-run the named tests —
if they stay green, that is the finding; (2) build the rect-stub harness in the
scratchpad rather than trusting the "it is proven by the e2e" claim, because the
e2e here needs a human-set `AUTH_SECRET` and does not run.
