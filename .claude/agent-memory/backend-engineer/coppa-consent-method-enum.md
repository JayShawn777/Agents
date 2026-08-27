---
name: coppa-consent-method-enum
description: Confirmed 16 CFR 312.5(b)(2) ConsentMethod enum values differ from the architect's original guesses for two of nine methods
metadata:
  type: project
---

The `ConsentMethod` enum (COPPA §312.5(b)(2)(i)-(ix) verifiable-parental-consent
methods) had two label mismatches between the architect's plan
(`docs/plans/m0-m1-implementation.md` §1) and the researcher's confirmed
mapping (`docs/research/coppa-312-5-primary-text.md`):

- Plan had `TOLL_FREE_CALL` / `VIDEO_CALL`; the confirmed research names them
  `TOLL_FREE_PHONE` / `VIDEO_CONFERENCE`. All nine other/remaining values
  matched.

**Why:** the research doc was explicitly flagged by the calling task as "the
file that unblocked you" and instructed to use its values exactly, overriding
the plan's schema snippet for this one enum. The plan's §1 schema block is
normally verbatim spec, but a later research artifact superseded it for this
specific enum.

**How to apply:** when a plan and a subsequently-linked research doc disagree
on a specific value the research doc was created to confirm, prefer the
research doc and note the deviation explicitly in the implementation report.
Don't silently pick one — call it out. See also [[consent-methods-single-source]].
