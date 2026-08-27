import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MASTERY_LEVEL_LABELS, type MasteryLevel } from "@/lib/domain/enums";
import type { SkillMasteryDTO } from "@/lib/schemas/dto";

/**
 * The PARENT-facing mastery display (plan §4, F20; M2 AC 9, AC 18-20;
 * ADR-0010). Renders on `app/(app)/students/[studentId]/page.tsx` — the
 * account owner's view of one profile, never a page a student practises on.
 * Server component: `SkillMasteryDTO` is a plain read, no interactivity.
 *
 * Two rules this component must never soften (M2 AC 20, checked here by a
 * Playwright regex sweep of the rendered page):
 *   - no accuracy percentage, 0-100 score, or streak, anywhere in this tree
 *   - no `n/m` fraction next to a skill name — `problemsPracticed` is a plain
 *     COUNT, not a numerator over a denominator, and it only rises.
 *
 * The skill descriptor is rendered prominently and is the load-bearing
 * field: the architect's brief names it "the only realistic way we would
 * ever catch" a practice problem recorded against the wrong skill code, so
 * this is not decorative copy — a parent has to be able to read it and think
 * "yes, that's what my kid is working on."
 */

const LEVEL_BADGE_VARIANT: Record<MasteryLevel, "outline" | "secondary" | "default"> = {
  NOT_STARTED: "outline",
  BEGINNING: "outline",
  DEVELOPING: "secondary",
  SECURE: "default",
};

const LEVEL_EXPLAINER: Record<MasteryLevel, string> = {
  NOT_STARTED: "No graded practice on this skill yet.",
  BEGINNING: "Just getting started with this skill.",
  DEVELOPING: "Making consistent progress on this skill.",
  SECURE: "Answering this skill correctly and consistently.",
};

export function MasteryStrip({ mastery }: { mastery: SkillMasteryDTO[] }) {
  return (
    <section aria-label="Skills practiced" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">Skills practiced</h2>
        {/* ADR-0010's accepted trade-off, said out loud: a level here is a
            ratchet, not a live score. */}
        <p className="text-xs text-muted-foreground">
          These levels only move up. A rough day of practice won&apos;t lower
          one — more practice is what raises it.
        </p>
      </div>

      {mastery.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nothing tracked yet — this fills in once a practice set has been
          completed.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mastery.map((skill) => (
            <li
              key={skill.skillCode}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="text-sm text-foreground">{skill.skillDescriptor}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {skill.problemsPracticed} problem{skill.problemsPracticed === 1 ? "" : "s"} practiced
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant={LEVEL_BADGE_VARIANT[skill.level]}>
                      {MASTERY_LEVEL_LABELS[skill.level]}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{LEVEL_EXPLAINER[skill.level]}</TooltipContent>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
