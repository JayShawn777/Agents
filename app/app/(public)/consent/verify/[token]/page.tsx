import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VerifyActions } from "@/components/consent/verify-actions";

/**
 * PUBLIC, session-free confirmation page (plan §4, F10; M0 AC 19, 21;
 * ADR-0008 §5). Reachable with no account, no cookie and no prior app
 * state — the parent may open the confirmation email on an entirely
 * different device — and `proxy.ts`'s matcher explicitly excludes
 * `/consent/*` so the optimistic sign-in redirect never intercepts it.
 *
 * **Safe to prefetch / safe for a mail scanner to fetch.** This page does
 * zero data fetching and has zero side effects: the token is never parsed,
 * hashed, or looked up here — it is passed through, opaque, as a plain
 * string to `VerifyActions`, which is the only place it is ever sent
 * anywhere, and only in response to an explicit click on one of the two
 * POST actions. The backend deliberately ships no `GET` handler for
 * `/api/consent/verify`/`/api/consent/decline` for the same reason (see the
 * frontend report for this milestone). A GET of this URL — by a browser, a
 * corporate mail scanner, or a link-preview bot — therefore touches no
 * database row and grants nothing.
 *
 * `?action=decline` is the backend's chosen convention for the "this was
 * not me" link in the confirmation email (`lib/consent/methods/email-plus.ts`,
 * `buildConsentPageUrl`). It only changes which of the two controls below is
 * visually emphasized — **both remain present and both still require an
 * explicit click** (ADR-0008 §5: "the page is also where a parent who did
 * NOT consent gets a visible 'this was not me' action").
 */

export const metadata: Metadata = {
  title: "Confirm parental consent",
};

export default async function ConsentVerifyPage({
  params,
  searchParams,
}: PageProps<"/consent/verify/[token]">) {
  const { token } = await params;
  const { action } = await searchParams;
  const declineByDefault = action === "decline";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-16 sm:px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Confirm parental consent</CardTitle>
          <CardDescription>
            A parent or guardian requested consent for a student&apos;s
            profile on Homework Helper.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>
            If you requested this, click &ldquo;Yes, I consent&rdquo; below
            to finish giving consent. If you did not request this, click
            &ldquo;This was not me&rdquo; — nothing will be activated and no
            further action is needed from you.
          </p>
          <VerifyActions token={token} declineByDefault={declineByDefault} />
        </CardContent>
      </Card>
    </div>
  );
}
