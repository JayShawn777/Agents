import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { MAGIC_LINK_TTL_SECONDS } from "@/lib/config";

/**
 * Auth.js's configured `pages.error` target (plan §5.1 B1; M0 AC 4). Shown
 * when a sign-in link is expired, already used, or otherwise invalid — no
 * session is created and this is the "error state" AC 4 requires.
 *
 * Deliberately does not surface Auth.js's raw `error` query value: that
 * value is a NextAuth-internal code, not one of `lib/errors.ts`'s
 * allowlisted messages, so it is treated the same as any other
 * exception-shaped string that must never reach a rendered surface.
 */

export const metadata: Metadata = {
  title: "Sign-in link no longer valid",
};

export default function SignInErrorPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        That link no longer works
      </h1>
      <p className="text-sm text-muted-foreground">
        This sign-in link has expired or has already been used. Links are
        valid for {MAGIC_LINK_TTL_SECONDS / 60} minutes and can only be used
        once.
      </p>
      <Link
        href="/sign-in"
        className="text-sm font-medium text-primary underline underline-offset-4 hover:no-underline"
      >
        Request a new sign-in link
      </Link>
    </div>
  );
}
