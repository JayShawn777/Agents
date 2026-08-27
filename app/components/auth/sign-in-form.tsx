"use client";

/**
 * CLIENT: needs `useActionState` to surface pending/field-error state from
 * the `signInWithEmail` server action (plan §5.2, F3; M0 AC 1-6), and needs
 * an uncontrolled, interactive checkbox the parent must actively tick.
 *
 * AC 6 lives entirely in this file's JSX: the 18+ checkbox has no
 * `defaultChecked` (so it renders unticked) and `required` (so the browser
 * — and, redundantly, the server's `z.literal(true)` — refuses submission
 * without it). There is no code path in this component that can submit
 * `isAdult: true` without the parent having clicked the box themselves.
 *
 * AC 2 (non-disclosure) is NOT enforced here — it can't be. This component
 * renders the exact same markup and takes the exact same success path
 * (the action calls `redirect('/sign-in/sent')`) regardless of whether the
 * submitted address belongs to an existing account. It never branches on
 * "did this email exist," because `ApiResult`/`ERROR_CODES` (`lib/errors.ts`)
 * has no error code that could tell it. The only two outcomes this form can
 * render are a validation/rate-limit error (about the input itself) or a
 * redirect to the identical "check your email" page.
 */

import { useActionState } from "react";

import { submitSignIn, type SignInActionState } from "@/lib/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignInActionState = null;

export function SignInForm() {
  const [state, formAction, pending] = useActionState(
    submitSignIn,
    initialState,
  );

  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  const formError =
    state && !state.ok && !fieldErrors ? state.error.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className="h-11"
          aria-invalid={Boolean(fieldErrors?.email)}
          aria-describedby={fieldErrors?.email ? "email-error" : undefined}
        />
        {fieldErrors?.email ? (
          <p id="email-error" className="text-xs text-destructive">
            {fieldErrors.email[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="isAdult"
            name="isAdult"
            required
            disabled={pending}
            aria-describedby={
              fieldErrors?.isAdult ? "is-adult-error" : undefined
            }
            className="mt-0.5"
          />
          <Label
            htmlFor="isAdult"
            className="cursor-pointer font-normal text-muted-foreground"
          >
            I am 18 years of age or older.
          </Label>
        </div>
        {fieldErrors?.isAdult ? (
          <p id="is-adult-error" className="text-xs text-destructive">
            {fieldErrors.isAdult[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Sending…" : "Send me a sign-in link"}
      </Button>
    </form>
  );
}
