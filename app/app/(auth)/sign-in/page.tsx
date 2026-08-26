import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { verifySession } from "@/lib/auth/dal";

/**
 * Renders the sign-in form (plan §5.2, F3; M0 AC 1, AC 2, AC 6). No app
 * chrome — the sign-in flow is deliberately outside `app/(app)/layout.tsx`.
 *
 * `verifySession` is read-only here and used only to skip the form for an
 * already-signed-in visitor; it is not this route's authorization boundary
 * (there isn't one to enforce — anyone may view a sign-in form).
 */

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage() {
  const session = await verifySession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Sign in
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to sign in — no
          password needed.
        </p>
      </div>
      <SignInForm />
    </div>
  );
}
