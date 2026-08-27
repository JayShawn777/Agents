import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SessionList } from "@/components/chat/session-list";
import { requireStudentProfile } from "@/lib/auth/dal";
import { toChatSessionDTO } from "@/lib/chat/dto";
import { db } from "@/lib/db";

/**
 * AC 14 (plan §4, F27) — the account owner reads their profile's tutor
 * conversations.
 *
 * The user story is trust: "I want to read what the tutor said to my child, so
 * that I can trust a machine talking to them unsupervised." That is why this
 * page exists, and why the transcript it links to is the FULL conversation
 * rather than a summary.
 *
 * `requireStudentProfile` is owner-scoped, so a cross-account `studentId` is a
 * 404 exactly as it is at the API boundary (M0 AC 32, M3 AC 15).
 *
 * **Not gated on `status === 'ACTIVE'`**, matching endpoint 38's auth for the
 * same reason: a parent who has just withdrawn consent must still be able to
 * read what was said to their child, which is precisely the moment they are
 * most likely to want to. Withdrawal stops new data being created; removing the
 * old is the retention job's business, not this page's.
 */

export const metadata: Metadata = {
  title: "Tutor conversations",
};

export default async function StudentChatSessionsPage({
  params,
}: PageProps<"/students/[studentId]/chat">) {
  const { studentId } = await params;

  const profile = await requireStudentProfile(studentId);
  if (!profile) notFound();

  const sessionRows = await db.chatSession.findMany({
    where: { studentProfileId: profile.id },
    orderBy: { openedAt: "desc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tutor conversations</h1>
        <p className="text-sm text-muted-foreground">
          Everything the tutor and your child said to each other, exactly as it happened.
        </p>
      </div>

      <SessionList sessions={sessionRows.map(toChatSessionDTO)} />
    </div>
  );
}
