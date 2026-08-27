---
name: feedback-spec-calibration
description: How the tutor-app owner wants specs calibrated — 15–25 AC, aggressive non-goals, no legal questions, labelled product vs technical open questions
metadata:
  type: feedback
---

Calibration for specs in this repo, given by the owner on 2026-08-27 when
commissioning M2–M7 as a single batch:

- **Aim for roughly 15–25 acceptance criteria**, not M0's 52. A criterion that
  can be tested is worth more than three that cannot. Do not chase exhaustive
  edge-case coverage.
- **Be aggressive in Non-goals** — name the thing a reader would assume is
  included and is not, in the reader's own words.
- **Fill in Data touched every time**, even when the milestone feels
  non-sensitive. The app handles data about children and that shapes the schema.
- **Do not raise legal questions in Open questions.** Legal work is deliberately
  deferred until there are real users. Privacy *design* still belongs in the
  spec; "ask a lawyer" items do not.
- **Label each open question PRODUCT decision or TECHNICAL unknown.**
- **Where a milestone rests on something unproven — extraction accuracy, model
  latency versus function duration — say so in Open questions rather than
  assuming it works.**
- **Retention windows live in M0's table only.** Later specs point at it and
  state no durations; a number written in two specs will drift (docs/README.md
  rule 7).

**Why:** the owner wants to stop spending time on preliminaries. M0's 52 criteria
were carrying a legal regime; later milestones are not, and repeating that weight
buys nothing. Batching was chosen deliberately because writing well-understood
milestones one at a time bought little.

**How to apply:** applies to any new spec in `app/docs/specs/`. Batch requests
are acceptable and preferred once a milestone is well understood; do not push
back asking to do them one at a time. See [[project-tutor-milestones]] for the
milestone map.
