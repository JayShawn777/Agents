import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CloseAccountDialog } from "@/components/settings/close-account-dialog";
import { auth } from "@/lib/auth/config";
import { requireUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { toStudentProfileDTO } from "@/lib/students/dto";
import { ACCOUNT_CLOSURE_RECOVERY_DAYS } from "@/lib/config";

/**
 * F17 (plan §4/§5.2; M0 AC 47). `requireUser()` redirects a signed-out
 * visitor to `/sign-in` (AC 1). `auth()` is only read here for
 * `session.user.email` display, exactly like `app/(app)/layout.tsx` — it
 * is never used to gate anything (that's the DAL call above).
 *
 * Lists every one of this parent's students with a direct link to that
 * student's `/privacy` page ALONGSIDE the close-account action, so this
 * screen itself demonstrates AC 49: closing the account is never the only
 * way to reach a student's deletion path. `toStudentProfileDTO` is reused
 * as-is (same reasoning as the dashboard and privacy pages: one mapping
 * function for this shape) even though `nextStep`/`canUpload` go unused
 * here — the point is the shared, single source of truth for
 * `displayName`, which can be `null` on a legitimate `ACTIVE` profile and
 * is rendered as an explicit fallback below rather than assumed non-null.
 */

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const { userId } = await requireUser();
  const session = await auth();

  const profiles = await db.studentProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { notices: { select: { id: true }, take: 1 } },
  });
  const students = profiles.map((profile) =>
    toStudentProfileDTO(profile, { hasNotice: profile.notices.length > 0 }),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Signed in as {session?.user?.email ?? "—"}</p>
        </CardContent>
      </Card>

      <Separator />

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Close your account</CardTitle>
          <CardDescription>
            A recoverable, {ACCOUNT_CLOSURE_RECOVERY_DAYS}-day soft delete of
            your whole account —
            profiles, consent records and uploads all become inaccessible
            immediately and are purged after the window. This is separate
            from deleting a single student&apos;s data, which is
            immediate, permanent, and reachable below without closing
            anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium text-foreground">
              Looking to delete a student&apos;s data instead?
            </p>
            {students.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {students.map((student) => (
                  <li key={student.id}>
                    <Link
                      href={`/students/${student.id}/privacy`}
                      className="inline-flex min-h-11 items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
                    >
                      <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                      {student.displayName ?? "Unnamed student"}&apos;s
                      privacy and data
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                You haven&apos;t added a student yet — once you do, their
                privacy and deletion options will be listed here.
              </p>
            )}
          </div>

          <CloseAccountDialog />
        </CardContent>
      </Card>
    </div>
  );
}
