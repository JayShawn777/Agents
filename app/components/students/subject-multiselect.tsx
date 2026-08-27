"use client";

/**
 * CLIENT: 1-8 selection state over `Subject` (plan §4, F11; M0 AC 28). The
 * server's own zod schema (`lib/schemas/student.ts`,
 * `z.array(z.enum(Subject)).min(1).max(8)`) enforces the same bounds — this
 * component makes the limit visible up front rather than letting a parent
 * hit it as a server rejection after the fact.
 *
 * Hand-rolled toggle chips rather than a shadcn primitive: no added
 * component in this project fits a bounded multi-select chip group, and
 * adding `toggle-group` for this one use isn't justified.
 */

import { SUBJECT_LABELS, SUBJECT_ORDER, type Subject } from "@/lib/domain/enums";
import { cn } from "@/lib/utils";

const MIN_SUBJECTS = 1;
const MAX_SUBJECTS = 8;

export function SubjectMultiselect({
  value,
  onChange,
  disabled,
}: {
  value: Subject[];
  onChange: (subjects: Subject[]) => void;
  disabled?: boolean;
}) {
  const atMax = value.length >= MAX_SUBJECTS;

  function toggle(subject: Subject) {
    if (value.includes(subject)) {
      onChange(value.filter((item) => item !== subject));
      return;
    }
    if (atMax) return;
    onChange([...value, subject]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Subjects</span>
        <span className="text-xs text-muted-foreground">
          {value.length}/{MAX_SUBJECTS} selected (choose at least {MIN_SUBJECTS})
        </span>
      </div>
      <div role="group" aria-label="Subjects" className="flex flex-wrap gap-2">
        {SUBJECT_ORDER.map((subject) => {
          const selected = value.includes(subject);
          const disableOption = disabled || (!selected && atMax);
          return (
            <button
              key={subject}
              type="button"
              disabled={disableOption}
              aria-pressed={selected}
              onClick={() => toggle(subject)}
              className={cn(
                "min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {SUBJECT_LABELS[subject]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
