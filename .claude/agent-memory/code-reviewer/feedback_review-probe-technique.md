---
name: review-probe-technique
description: How to review this repo's AI/background-job paths — write throwaway probe tests that construct the violation, run them, then delete them. Reading tests proves nothing here.
metadata:
  type: feedback
---

When reviewing a path in this repo that a test suite claims to defend, **construct the
violation and run it** rather than reading the suite. Copy the suite's mock setup into a
throwaway `tests/unit/.../probe.test.ts`, make the mock behave like production (not like
the suite's convenient version), assert the documented guarantee, and see whether it goes
red. Delete the probe afterwards and confirm `git status` is clean.

**Why:** Two milestones running, this repo's suites have been green against broken code —
M0/M1's thirteen check-order tests passed against a deliberately reordered handler, and
M4's `PARSE_FAILED` test passed against a branch production cannot reach
([[sdk-parse-failed-branch]]). The common cause is a mock that is more forgiving than
reality: it resolves where production throws, or it runs a callback synchronously where
production defers it.

**How to apply:** Highest-yield probes in this codebase, in order:
1. Replace a hand-written mock return value with the real library call the mock stands in
   for, and re-assert the failure code.
2. Call a `reapIfStale`-style reaper with the guard-race branch forced
   (`updateMany -> { count: 0 }`) and assert the *returned* object, not just which queries
   ran. The lesson reaper was wrong here and its test only checked call counts.
3. Feed a status-machine a state the state machine never moves out of (e.g. a lesson stuck
   `PENDING`) and check something reaps it.

Three probes cost about five turns and have found a blocker every time.
