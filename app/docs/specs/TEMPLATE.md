# Spec: <feature name>

- **Status:** Draft | Approved | Built | Shipped
- **Date:** YYYY-MM-DD
- **Author:** product-spec agent
- **Milestone:** <e.g. M1>
- **ADRs:** <links, or n/a>

## Problem
Who has this problem, and what does it cost them today? Written from the user's
side. No solution language here.

## Goal
One sentence. What is true after this ships that is not true now.

## Non-goals
What this feature deliberately does NOT do. This section prevents scope creep
more reliably than any other — be specific, and name the things a reader would
reasonably assume are included.

## User stories
- As a <role>, I want to <action>, so that <outcome>.

## Acceptance criteria
Numbered, each independently testable. The qa-tester agent writes tests directly
against these, so each must be observable from outside the system — no "the code
should be clean".

1. **Given** <state>, **when** <action>, **then** <observable result>.
2. …

## Out of scope for this milestone
Things we will build later, listed so the architect does not design them in now
and does not design them *out* forever.

## Open questions
- [ ] <question> — **blocking / non-blocking**

## Data touched
What personal or sensitive data this feature reads, writes, or transmits, and
the retention expectation. Required for anything touching student data.
