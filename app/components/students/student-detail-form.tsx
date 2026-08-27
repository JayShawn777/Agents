"use client";

/**
 * CLIENT: controlled multi-field form, live validation, submit state, PATCH
 * endpoint #4 (plan §4, F11; M0 AC 25, 26, 30). Shared between the
 * first-time setup step (`students/[studentId]/profile/page.tsx`) and
 * editing an already-complete profile (`students/[studentId]/edit/page.tsx`)
 * — both pass the same `initial` shape and studentId; this component
 * doesn't know or care which flow invoked it.
 *
 * `initial` is typed as a `Pick` off the shared `StudentProfileDTO`
 * (`lib/schemas/dto.ts`) rather than a redeclared shape, per this
 * milestone's brief. `avatarId` is `string | null` there (not `AvatarId`) —
 * deliberately, since it's validated against the config array rather than a
 * Prisma enum — so this component narrows it once, here, with
 * `isAvatarId`, rather than trusting an upstream cast.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AvatarPicker } from "@/components/students/avatar-picker";
import { SubjectMultiselect } from "@/components/students/subject-multiselect";
import { apiFetch } from "@/lib/api/client";
import {
  AVATAR_IDS,
  GRADE_LEVEL_LABELS,
  GRADE_LEVEL_ORDER,
  type AvatarId,
  type GradeLevel,
  type Subject,
} from "@/lib/domain/enums";
import type { StudentProfileDTO } from "@/lib/schemas/dto";

const DISPLAY_NAME_MAX_LENGTH = 40;

function isAvatarId(value: string | null): value is AvatarId {
  return value !== null && (AVATAR_IDS as readonly string[]).includes(value);
}

export function StudentDetailForm({
  studentId,
  initial,
}: {
  studentId: string;
  initial: Pick<StudentProfileDTO, "displayName" | "gradeLevel" | "subjects" | "avatarId">;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [gradeLevel, setGradeLevel] = useState<GradeLevel | null>(initial.gradeLevel);
  const [subjects, setSubjects] = useState<Subject[]>(initial.subjects);
  const [avatarId, setAvatarId] = useState<AvatarId | null>(
    isAvatarId(initial.avatarId) ? initial.avatarId : null,
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function validateName(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "Enter a display name.";
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return `Display names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
    }
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nameProblem = validateName(displayName);
    setNameError(nameProblem);
    if (nameProblem || !gradeLevel || subjects.length === 0 || !avatarId) {
      setError("Fill in every field before saving.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ student: StudentProfileDTO }>(
        `/api/students/${studentId}`,
        {
          method: "PATCH",
          body: {
            displayName: displayName.trim(),
            gradeLevel,
            subjects,
            avatarId,
          },
        },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/students/${studentId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          required
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          disabled={isPending}
          className="h-11"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            if (nameError) setNameError(validateName(event.target.value));
          }}
          onBlur={(event) => setNameError(validateName(event.target.value))}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "displayName-error" : undefined}
        />
        {nameError ? (
          <p id="displayName-error" className="text-xs text-destructive">
            {nameError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {displayName.trim().length}/{DISPLAY_NAME_MAX_LENGTH} characters
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gradeLevel">Grade level</Label>
        <Select
          value={gradeLevel ?? undefined}
          onValueChange={(value) => setGradeLevel(value as GradeLevel)}
        >
          <SelectTrigger id="gradeLevel" className="h-11 w-full">
            <SelectValue placeholder="Choose a grade level" />
          </SelectTrigger>
          <SelectContent>
            {GRADE_LEVEL_ORDER.map((grade) => (
              <SelectItem key={grade} value={grade}>
                {GRADE_LEVEL_LABELS[grade]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SubjectMultiselect value={subjects} onChange={setSubjects} disabled={isPending} />

      <AvatarPicker value={avatarId} onChange={setAvatarId} disabled={isPending} />

      <Button type="submit" disabled={isPending} className="h-11">
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
