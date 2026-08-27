import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { NoticeAcknowledge } from "@/components/consent/notice-acknowledge";
import { DIRECT_NOTICE_COPY, DIRECT_NOTICE_VERSION } from "@/lib/notice/copy";

/**
 * THE §312.4 direct notice (plan §4, F8; M0 AC 12, 13). Server component —
 * pure copy plus two links; the only interactive control on the page is
 * `NoticeAcknowledge`.
 *
 * Renders `DIRECT_NOTICE_COPY` / `DIRECT_NOTICE_VERSION` from
 * `lib/notice/copy.ts` (backend track) rather than declaring its own copy.
 * That module's own docstring names this exact file as one of its two
 * intended consumers — the other being the notice email
 * (`lib/notice/service.ts`) — specifically so the screen and the email can
 * never drift apart, and so a version bump (AC 14) only ever has to happen
 * in one place. This file only *imports* from `lib/notice/`, never edits
 * it.
 */

export function DirectNotice({ studentId }: { studentId: string }) {
  const copy = DIRECT_NOTICE_COPY;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Before we set up your child&apos;s profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Federal law (COPPA) requires us to tell you exactly what we&apos;ll
          collect about your child and get your verified consent before we
          collect any of it. Please read this notice before continuing.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What we&apos;ll collect, and why</CardTitle>
          <CardDescription>
            Nothing on this list is collected until you&apos;ve given consent
            on the next step.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {copy.collected.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {copy.uses.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who else sees it</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {copy.thirdParties.map((party) => (
              <li key={party.name}>
                <span className="font-medium text-foreground">
                  {party.name}
                </span>{" "}
                — {party.receives}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your rights as a parent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            {copy.rights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            See exactly how long we keep each category of information in our{" "}
            <Link
              href={copy.retentionPolicyPath}
              className="underline underline-offset-4 hover:text-foreground"
            >
              data retention policy
            </Link>
            , and read the full{" "}
            <Link
              href={copy.privacyPolicyPath}
              className="underline underline-offset-4 hover:text-foreground"
            >
              privacy policy
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Separator />

      <NoticeAcknowledge studentId={studentId} noticeVersion={DIRECT_NOTICE_VERSION} />
    </div>
  );
}
