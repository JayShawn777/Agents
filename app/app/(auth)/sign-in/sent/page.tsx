import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { MAGIC_LINK_TTL_SECONDS } from "@/lib/config";

/**
 * Static "check your email" state (plan §5.2, F3; M0 AC 2). This page is
 * reached identically whether or not the submitted address has an account —
 * it takes no params, reads no query string, and fetches nothing, so there
 * is nothing here that COULD reveal which case just happened. The copy
 * itself is written to be true either way ("if that address has an
 * account, or can have one").
 */

export const metadata: Metadata = {
  title: "Check your email",
};

export default function SignInSentPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MailCheck className="size-6" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Check your email
      </h1>
      <p className="text-sm text-muted-foreground">
        If that address has an account, or can have one, we&apos;ve sent a
        sign-in link to it. The link expires in {MAGIC_LINK_TTL_SECONDS / 60}{" "}
        minutes and can only be used once.
      </p>
      <p className="text-sm text-muted-foreground">
        Wrong address, or didn&apos;t get it?{" "}
        <Link
          href="/sign-in"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Try again
        </Link>
        .
      </p>
    </div>
  );
}
