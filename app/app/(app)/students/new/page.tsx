import type { Metadata } from "next";

import { AgeGateForm } from "@/components/students/age-gate-form";
import { requireUser } from "@/lib/auth/dal";

/**
 * STEP 1 of the four-step add-a-student flow (plan §4/§5.2, F7; M0 AC 8, 9,
 * 10). Age gate ONLY — see `age-gate-form.tsx` for the DOM assertion this
 * step exists to satisfy.
 */

export const metadata: Metadata = {
  title: "Add a student",
};

export default async function NewStudentPage() {
  await requireUser();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          How old is this learner?
        </h1>
        <p className="text-sm text-muted-foreground">
          We ask this first so we know what to tell you before we collect
          anything else.
        </p>
      </div>
      <AgeGateForm />
    </div>
  );
}
