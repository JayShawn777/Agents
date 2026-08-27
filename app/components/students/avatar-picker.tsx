"use client";

/**
 * CLIENT: selection state over the fixed `AVATAR_IDS` preset (plan §4, F11;
 * M0 AC 29). Renders `<button>`s only — there is no `<input type="file">`
 * anywhere in this tree, and there never will be: a child-uploaded avatar
 * would be a photograph of a minor's face, a different privacy problem
 * entirely from anything else this app collects.
 *
 * Hand-rolled rather than a shadcn primitive: no added component in this
 * project (`components/ui/*`) is a fit for a bounded grid of selectable
 * image-like tiles, and a `toggle-group` add for this one use isn't
 * justified.
 *
 * `AVATAR_IDS` (`lib/config.ts`) is a **placeholder set with no artwork
 * behind it yet** — each option renders a deliberately provisional
 * monogram swatch, captioned as such, rather than a broken `<img>`. See the
 * frontend report for this milestone for what a designer needs to supply
 * (one square asset per id in `AVATAR_IDS`, delivered under
 * `public/avatars/<id>.svg` per that config file's own docstring).
 */

import { AVATAR_IDS, type AvatarId } from "@/lib/domain/enums";
import { cn } from "@/lib/utils";

const AVATAR_LABELS: Record<AvatarId, string> = {
  fox: "Fox",
  owl: "Owl",
  panda: "Panda",
  robot: "Robot",
  astronaut: "Astronaut",
  dinosaur: "Dinosaur",
  dragon: "Dragon",
  unicorn: "Unicorn",
};

// One swatch class per `AVATAR_IDS` entry, in fixed array order — distinct
// and deterministic without needing a hash function.
const SWATCH_CLASSES: readonly string[] = [
  "bg-rose-100 text-rose-900",
  "bg-amber-100 text-amber-900",
  "bg-lime-100 text-lime-900",
  "bg-teal-100 text-teal-900",
  "bg-sky-100 text-sky-900",
  "bg-violet-100 text-violet-900",
  "bg-fuchsia-100 text-fuchsia-900",
  "bg-orange-100 text-orange-900",
];

export function AvatarPicker({
  value,
  onChange,
  disabled,
}: {
  value: AvatarId | null;
  onChange: (avatarId: AvatarId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">Avatar</span>
      <p className="text-xs text-muted-foreground">
        Placeholder artwork — final avatar art is still pending design.
      </p>
      <div
        role="group"
        aria-label="Avatar"
        className="grid grid-cols-4 gap-3 sm:grid-cols-8"
      >
        {AVATAR_IDS.map((avatarId, index) => {
          const selected = value === avatarId;
          return (
            <button
              key={avatarId}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={AVATAR_LABELS[avatarId]}
              onClick={() => onChange(avatarId)}
              className={cn(
                "flex min-h-11 flex-col items-center gap-1.5 rounded-lg border-2 border-transparent p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                selected ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-full border border-dashed border-current text-sm font-semibold",
                  SWATCH_CLASSES[index % SWATCH_CLASSES.length],
                )}
              >
                {AVATAR_LABELS[avatarId].slice(0, 2).toUpperCase()}
              </span>
              <span className="text-xs text-muted-foreground">
                {AVATAR_LABELS[avatarId]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
