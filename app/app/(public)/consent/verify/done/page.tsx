import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * PUBLIC, session-free terminal screen for the consent-verification flow
 * (plan §4, F10; M0 AC 19, 21). A static sibling route next to the dynamic
 * `[token]` segment — Next.js resolves the literal `done` segment in
 * preference to the dynamic one, so this never collides with a real token.
 *
 * Every outcome `VerifyActions` can produce lands here via `?state=`,
 * mapped from the endpoint's `ApiError.code` where it failed
 * (`components/consent/verify-actions.tsx`) — this file owns the copy for
 * "verified / declined / expired / already used" in one place, rather than
 * scattering terminal messaging across the action component.
 */

export const metadata: Metadata = {
  title: "Consent confirmation",
};

type DoneState = "verified" | "declined" | "not_found" | "conflict" | "rate_limited" | "error";

const COPY: Record<DoneState, { title: string; body: string }> = {
  verified: {
    title: "Thank you — consent confirmed",
    body: "This student's profile is now active. You can close this page.",
  },
  declined: {
    title: "Got it — nothing was activated",
    body: "We've recorded that this wasn't you. No information will be collected about this student, and the request has been cancelled.",
  },
  not_found: {
    title: "This link isn't valid",
    body: "We couldn't find a matching request for this link. It may be incomplete, or it may already have been used.",
  },
  conflict: {
    title: "This link no longer works",
    body: "This confirmation link has expired or has already been used. If you still need to confirm, ask the account holder to restart the consent step.",
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Please wait a few minutes before trying that link again.",
  },
  error: {
    title: "Something went wrong",
    body: "We couldn't process that just now. Please try the link again in a moment.",
  },
};

function isDoneState(value: string | undefined): value is DoneState {
  return value !== undefined && value in COPY;
}

export default async function ConsentVerifyDonePage({
  searchParams,
}: PageProps<"/consent/verify/done">) {
  const params = await searchParams;
  const rawState = Array.isArray(params.state) ? params.state[0] : params.state;
  const state: DoneState = isDoneState(rawState) ? rawState : "error";
  const copy = COPY[state];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-16 sm:px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="text-sm underline underline-offset-4 hover:text-foreground"
          >
            Return to the homepage
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
