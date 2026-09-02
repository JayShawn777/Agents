---
name: narration-latex-guard-scope
description: assertSpeakableNarration lives in lib/lessons/validate.ts, called ONLY from lib/lessons/author.ts — never folded into LessonStepSchema
metadata:
  type: project
---

M5 slice 4's speakable guard (`assertSpeakableNarration`, plan §8.1) is
implemented in `lib/lessons/validate.ts` and called from exactly one place:
`lib/lessons/author.ts`'s `authorLesson()`, right after
`validateScriptReferences`, mapping a violation to `INVALID_SCRIPT`. It is
NOT referenced anywhere in `lib/lessons/script-schema.ts` — grep confirms
`LessonStepSchema` carries no opinion on narration content, only length.

**Why:** `toLessonVersionDTO` (`lib/lessons/dto.ts`) re-parses the stored
`script` JSON column with `LessonScriptSchema.safeParse` on every read and
returns `script: null` on failure. Tightening the SHARED schema to reject
LaTeX in narration would not just refuse new scripts — it would turn every
already-stored M4 lesson whose narration contains a backslash into a lesson
with no script at all, silently, on the next read. That is an outage
disguised as stricter validation, and it is invisible in a diff.

The generation-time defensive twin lives in `lib/narration/speakable.ts`
(`isSpeakableNarration`, detection only — no substitution table, since N1
found ~0 material rate in real fixtures and inventing entries no measurement
supports was explicitly rejected by the plan). `lib/narration/generate.ts`
re-checks each step's narration before ever calling the vendor, for the one
case the authoring guard cannot reach: a lesson authored before the guard
existed.

**How to apply:** if a future milestone is tempted to move this check into
`LessonStepSchema` "for consistency", stop — re-read this note and
`lib/lessons/dto.ts`'s `toLessonVersionDTO` first. See also
[deletion-service-status](deletion-service-status.md) and
[narration-purge-fully-wired](narration-purge-fully-wired.md) for the rest of
M5's file-boundary history.
