"use client";

/**
 * CLIENT: name/relationship/affirmation state and a POST to endpoint #8
 * (plan §4, F9; M0 AC 17, 18, 20). Needs pending/error state around a
 * mutation, so it can't be a server component.
 *
 * `method` and `methodInput` are passed straight through from the
 * server-resolved active provider (`consent/page.tsx`) — this component
 * never selects, infers, or hard-codes a `ConsentMethod` itself, and it
 * never branches its own behavior on `method`'s value (ADR-0008 §3). The
 * only method live today, `EMAIL_PLUS`, contributes no extra fields
 * (`extraInputSchema: z.object({}).strict()` in `lib/consent/methods/email-plus.ts`),
 * so `methodInput` is always `{}` here; a future method with real extra
 * fields would extend this form's props, not add a branch to it.
 *
 * Routing after submit is driven entirely by the server-computed
 * `student.nextStep` in the response — never by `method` — which is what
 * keeps this component correct regardless of which method is configured
 * (a synchronous method could return `ACTIVE`/`PROFILE_DETAILS` directly;
 * `EMAIL_PLUS` always returns `CONSENT_PENDING`).
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api/client";
import { ConsentRelationship, ConsentScope, type ConsentMethod } from "@/lib/domain/enums";
import type { ConsentDTO, StudentProfileDTO } from "@/lib/schemas/dto";

const RELATIONSHIP_OPTIONS: readonly { value: ConsentRelationship; label: string }[] = [
  { value: ConsentRelationship.PARENT, label: "Parent" },
  { value: ConsentRelationship.LEGAL_GUARDIAN, label: "Legal guardian" },
  { value: ConsentRelationship.OTHER_CAREGIVER, label: "Other authorized caregiver" },
  { value: ConsentRelationship.SELF, label: "This is me (I am the student)" },
];

type SubmitConsentResponse = { student: StudentProfileDTO; consent: ConsentDTO };

export function ConsentForm({
  studentId,
  directNoticeId,
  noticeVersion,
  consentTextVersion,
  method,
}: {
  studentId: string;
  directNoticeId: string;
  noticeVersion: string;
  consentTextVersion: string;
  method: ConsentMethod;
}) {
  const router = useRouter();
  const [consentingAdultName, setConsentingAdultName] = useState("");
  const [relationship, setRelationship] = useState<ConsentRelationship | null>(null);
  const [affirmed, setAffirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consentingAdultName.trim() || !relationship || !affirmed) {
      setError("Fill in every field and confirm the affirmation to continue.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<SubmitConsentResponse>(
        `/api/students/${studentId}/consent`,
        {
          method: "POST",
          body: {
            directNoticeId,
            noticeVersion,
            consentTextVersion,
            consentingAdultName: consentingAdultName.trim(),
            relationship,
            // Only one scope is defined today (`ConsentScope.DATA_PROCESSING`,
            // required by `submitConsentInputSchema`'s own refinement) — no
            // picker is shown for a "choice" of one.
            scopes: [ConsentScope.DATA_PROCESSING],
            method,
            methodInput: {},
            affirmed: true,
          },
        },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const { student } = result.data;
      if (student.nextStep === "PROFILE_DETAILS") {
        router.push(`/students/${studentId}/profile`);
        return;
      }
      router.push(`/students/${studentId}/consent/pending`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="consentingAdultName">Your full name</Label>
        <Input
          id="consentingAdultName"
          name="consentingAdultName"
          autoComplete="name"
          required
          maxLength={80}
          disabled={isPending}
          className="h-11"
          value={consentingAdultName}
          onChange={(event) => setConsentingAdultName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="relationship">Your relationship to this student</Label>
        <Select
          value={relationship ?? undefined}
          onValueChange={(value) => setRelationship(value as ConsentRelationship)}
        >
          <SelectTrigger id="relationship" className="h-11 w-full">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id="affirmed"
          required
          disabled={isPending}
          checked={affirmed}
          onCheckedChange={(checked) => setAffirmed(checked === true)}
          className="mt-0.5"
        />
        <Label htmlFor="affirmed" className="cursor-pointer font-normal text-muted-foreground">
          I affirm that I am this student&apos;s parent or legal guardian (or
          otherwise authorized to consent on their behalf), and I consent to
          the collection and use described above.
        </Label>
      </div>

      <Button type="submit" disabled={isPending} className="h-11">
        {isPending ? "Submitting…" : "Give consent"}
      </Button>
    </form>
  );
}
