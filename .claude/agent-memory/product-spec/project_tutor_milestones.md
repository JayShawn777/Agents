---
name: project-tutor-milestones
description: The tutor app's M0–M7 milestone map, which specs exist, and the load-bearing product constraints each later milestone inherits
metadata:
  type: project
---

The tutor app (`/workspaces/Agents/app`) ships in eight milestones. As of
2026-08-27 all eight specs exist in `app/docs/specs/` at Status: Draft — M0 (52
AC) and M1 (36 AC) were written 2026-08-26; M2–M7 were written as one batch on
2026-08-27.

M0 accounts/consent → M1 upload/extract → M2 practice+mastery → M3 chat tutor →
M4 whiteboard lessons → M5 narration/personas → M6 custom voice → M7 adaptive
loop.

Constraints that later milestones inherit and must not quietly re-litigate:

- **No visible score a child can watch fall.** IXL's SmartScore is the documented
  anxiety driver; mastery levels are monotonic (M2 AC 19/20) and M7's spaced
  repetition resolves the collision in the child's favour (M7 AC 12).
- **Skills map to an existing standards taxonomy** (Common Core / NGSS, CASE as
  the machine-readable format). Inventing a skill tree is forbidden.
- **The whiteboard is not video.** Claude emits a zod-validated `LessonScript`;
  the browser animates it. It is an engagement bet — the research finds worked
  examples and video-modelled examples produce comparable outcomes, so never
  justify it as better pedagogy.
- **Narration is pre-generated and cached** by hash of (text, voiceId, modelId);
  never synced against a live stream. Timing data is character-level, so word
  grouping is ours, and math text is where it drifts.
- **A student may never clone a voice** — the TTS provider bars voice data from
  anyone under 18, which is stricter and more absolute than the
  no-celebrity-voice rule.
- **Sessions are bounded**, Synthesis-style, not open-ended solver sessions.

**Why:** these came from `docs/research/tutoring-product-patterns.md` and
`docs/research/elevenlabs-tts.md`, which are evidence-backed and were explicitly
meant to shape the specs rather than sit unread.

**How to apply:** when revising or extending any spec here, check these first —
each one already survived a round of scoping and each is a place a reasonable
engineer would otherwise design the opposite thing. See
[[feedback-spec-calibration]] for how the owner wants these specs written.
