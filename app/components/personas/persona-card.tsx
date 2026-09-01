/**
 * One persona's artwork, name and description (M5 AC 2). Pure presentation —
 * no state, no "use client" of its own — rendered inside `PersonaPicker`'s
 * radio group, one card per option.
 *
 * **Placeholder artwork.** §10.6 of the plan leaves the real art undesigned;
 * `artworkId` (e.g. `persona-smooth-j`) has no image behind it yet. This
 * follows the exact precedent `AvatarPicker` already set for `AVATAR_IDS` —
 * a captioned, deliberately provisional monogram swatch rather than a broken
 * `<img>` — so a second placeholder convention doesn't get invented here.
 */

import type { PersonaDTO } from "@/lib/schemas/dto";
import { cn } from "@/lib/utils";

// One swatch class per persona, keyed by array position so it stays stable
// however many personas there are — the same approach `AvatarPicker` uses.
const SWATCH_CLASSES: readonly string[] = [
  "bg-rose-100 text-rose-900",
  "bg-amber-100 text-amber-900",
  "bg-lime-100 text-lime-900",
  "bg-teal-100 text-teal-900",
  "bg-sky-100 text-sky-900",
  "bg-violet-100 text-violet-900",
];

function initialsFor(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function PersonaCard({ persona, index }: { persona: PersonaDTO; index: number }) {
  return (
    <div className="flex flex-1 items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-current text-sm font-semibold",
          SWATCH_CLASSES[index % SWATCH_CLASSES.length],
        )}
      >
        {initialsFor(persona.label)}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{persona.label}</span>
        <span className="text-xs text-muted-foreground">{persona.description}</span>
      </div>
    </div>
  );
}
