"use client";

/**
 * CLIENT: selection state and an optimistic PATCH to endpoint #4 (plan §3
 * row 4†, M5 AC 3/4). "use client" because choosing a voice is a real user
 * interaction with request state — the same reason `age-gate-form.tsx` and
 * `student-detail-form.tsx` are client components for the same PATCH route.
 *
 * **No response body is read back.** The extended `persona`/`captionsEnabled`
 * fields on the PATCH response (plan §3 row 4†) are the backend track's slice
 * 6, built in parallel and not landed yet — but this component doesn't need
 * them: it already knows which `personaId` it just sent, so on `result.ok`
 * it commits that id as the new saved selection rather than re-parsing it out
 * of the response. Only `result.ok` and `result.error.message` (always an
 * allowlisted string) are read, both already on the existing `StudentProfileDTO`
 * response shape — nothing here is typed from a shape that doesn't exist yet.
 *
 * A failed PATCH snaps the radio group back to the last SAVED selection, not
 * to whatever was on screen before the click — two rapid, alternating choices
 * where the second one fails must not leave the UI showing the first.
 */

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { PersonaCard } from "@/components/personas/persona-card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiFetch } from "@/lib/api/client";
import type { PersonaDTO, StudentProfileDTO } from "@/lib/schemas/dto";

export function PersonaPicker({
  studentId,
  personas,
  /**
   * The profile's stored `personaId`, or `null` — which means "the default
   * persona" (AC 4), never "no voice". Read directly off the `StudentProfile`
   * row by the server page, not off a DTO: the picker needs no route to load
   * its own data (plan §3's "there is no `GET /api/personas`").
   */
  initialPersonaId,
  /** `personas.find(p => p.slug === DEFAULT_PERSONA_SLUG)?.id`, resolved by the page. */
  defaultPersonaId,
}: {
  studentId: string;
  personas: PersonaDTO[];
  initialPersonaId: string | null;
  defaultPersonaId: string | null;
}) {
  const startingId = initialPersonaId ?? defaultPersonaId ?? "";
  const [savedId, setSavedId] = useState(startingId);
  const [selectedId, setSelectedId] = useState(startingId);
  const [error, setError] = useState<string | null>(null);
  // Whether the child has picked anything yet this visit — the status line
  // has nothing honest to say ("Saving…"/"Saved.") until then.
  const [touched, setTouched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function choose(personaId: string) {
    setSelectedId(personaId);
    setError(null);
    setTouched(true);
    startTransition(async () => {
      const result = await apiFetch<{ student: StudentProfileDTO }>(`/api/students/${studentId}`, {
        method: "PATCH",
        body: { personaId },
      });
      if (!result.ok) {
        setError(result.error.message);
        // Snap back to the last confirmed choice, not to whatever was
        // showing before this click.
        setSelectedId(savedId);
        return;
      }
      setSavedId(personaId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <RadioGroup
        aria-label="Tutor voice"
        value={selectedId || undefined}
        onValueChange={(value) => choose(value as string)}
        className="gap-3"
      >
        {personas.map((persona, index) => (
          <label
            key={persona.id}
            htmlFor={`persona-${persona.id}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5 aria-disabled:pointer-events-none aria-disabled:opacity-60"
            aria-disabled={isPending}
          >
            <RadioGroupItem id={`persona-${persona.id}`} value={persona.id} disabled={isPending} />
            <PersonaCard persona={persona} index={index} />
          </label>
        ))}
      </RadioGroup>

      {touched ? (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {isPending ? "Saving…" : "Saved."}
        </p>
      ) : null}
    </div>
  );
}
