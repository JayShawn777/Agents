"use client";

/**
 * CLIENT: radio group selection state and a POST to endpoint #2 (plan §4,
 * §5.2 F7; M0 AC 8, 9, 10).
 *
 * AC 8 is a DOM assertion this file must not soften: the only input in this
 * tree is the age band radio group. No name, grade, subject or avatar field
 * exists here — the API's `.strict()` schema (`lib/schemas/student.ts`)
 * would reject them anyway, but the rule is enforced by never rendering the
 * control in the first place. Neither `RadioGroup` nor `RadioGroupItem`
 * below is given a `value`/`defaultValue` that preselects anything — the
 * component starts with `ageBand === null` and stays that way until the
 * learner's guardian clicks an option. The three option labels ("Under 13",
 * "13 to 17", "18 or older") are the only copy on this step and state
 * nothing about what any option unlocks.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiFetch } from "@/lib/api/client";
import { AgeBand } from "@/lib/domain/enums";
import type { StudentProfileDTO } from "@/lib/schemas/dto";

const AGE_BAND_OPTIONS: readonly { value: AgeBand; label: string }[] = [
  { value: AgeBand.UNDER_13, label: "Under 13" },
  { value: AgeBand.AGE_13_17, label: "13 to 17" },
  { value: AgeBand.ADULT, label: "18 or older" },
];

export function AgeGateForm() {
  const router = useRouter();
  // No initial value: the step renders with nothing selected (AC 8).
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ageBand) {
      setError("Choose an option to continue.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ student: StudentProfileDTO }>(
        "/api/students",
        { method: "POST", body: { ageBand } },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const { student } = result.data;
      // AC 10: the adult band goes straight to the profile-detail step, with
      // no notice and no consent screen shown. Every other band's `nextStep`
      // is `NOTICE` immediately after creation (`lib/students/dto.ts`).
      router.push(
        student.nextStep === "PROFILE_DETAILS"
          ? `/students/${student.id}/profile`
          : `/students/${student.id}/notice`,
      );
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <RadioGroup
        aria-label="Learner's age"
        value={ageBand ?? undefined}
        onValueChange={(value) => setAgeBand(value as AgeBand)}
        className="gap-3"
      >
        {AGE_BAND_OPTIONS.map((option) => (
          <label
            key={option.value}
            htmlFor={`age-band-${option.value}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
          >
            <RadioGroupItem id={`age-band-${option.value}`} value={option.value} />
            <span className="text-sm font-medium text-foreground">
              {option.label}
            </span>
          </label>
        ))}
      </RadioGroup>

      <Button type="submit" disabled={isPending} className="h-11">
        {isPending ? "Continuing…" : "Continue"}
      </Button>
    </form>
  );
}
