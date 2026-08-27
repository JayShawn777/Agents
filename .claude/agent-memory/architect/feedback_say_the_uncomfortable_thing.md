---
name: feedback-say-the-uncomfortable-thing
description: The owner asks for blunt architectural verdicts and expects push-back on his own suggestions — never soften a risk into a footnote or write a thin ADR to be agreeable
metadata:
  type: feedback
---

Give a plain verdict when asked, including when it contradicts the plan. Two
specific behaviours the owner has asked for by name:

- **If one of his suggested ADRs does not warrant one, say so rather than writing
  a thin ADR.** He wrote that instruction into the M2–M7 task verbatim.
- **State what cannot be tested, plainly, rather than implying coverage.** He
  called saying so "worth more than pretending otherwise" — the M0/M1 plan already
  carries a "Not automatically testable" section and every later plan should too,
  growing as the milestones get more inferential.

He also asks direct questions expecting a direct answer ("say plainly whether you
think that stack is sound, and if not, what should change"). Answer with a verdict
first, then the changes, then what you are *not* recommending.

**Why:** this is a product for children where a confident wrong answer reaches a
parent who will believe it. He would rather carry a named risk than an unnamed
one, and he treats an unstated assumption as the actual defect.

**How to apply:** put the uncomfortable finding in its own top-level section of
the plan, not in a risk-table row. Name the specific consequence and the specific
change. Related: [[feedback-depth-calibration]], [[project-tutor-app-evidence-gap]].
