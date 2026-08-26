import type { Metadata } from "next";
import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RETENTION_POLICY, type RetentionPolicyEntry } from "@/lib/config";

/**
 * The published retention policy (M0 AC 44). PUBLIC — reachable without
 * sign-in, and must stay that way: a parent has to be able to read this
 * before any account exists. No auth check, no data access — a pure render
 * of `RETENTION_POLICY`, the exact array `lib/jobs/enforce-retention.ts`
 * walks, so this page can never describe a window the code doesn&apos;t enforce
 * (plan §7).
 */

export const metadata: Metadata = {
  title: "Data retention policy",
  description:
    "What information we collect, why we keep it, and how long we keep it for.",
};

/**
 * Display-only labels for each `RETENTION_POLICY` category. Presentation
 * sugar, not a tunable — every duration and every word of purpose /
 * business-need copy comes from `lib/config.ts` itself, never from here.
 */
const CATEGORY_LABELS: Record<RetentionPolicyEntry["key"], string> = {
  PRE_CONSENT: "Age band collected before consent",
  SOURCE_FILE: "Uploaded schoolwork (photo or PDF)",
  EXTRACTED_TEXT: "Extracted problem text",
  PROFILE_FIELDS: "Display name, grade level, subjects and avatar",
  DIRECT_NOTICE: "Direct notice record",
  CONSENT_FULL: "Parental consent record",
  CONSENT_PSEUDONYM: "Pseudonymised consent record (after deletion)",
  ACCOUNT_SESSION: "Account and session records",
  CLOSED_ACCOUNT: "Closed account (recovery window)",
  DELETION_AUDIT: "Deletion audit record",
};

/** Human phrasing for each `anchor` field name used in `RETENTION_POLICY`. */
const ANCHOR_LABELS: Record<string, string> = {
  createdAt: "when it was first created",
  extractedAt: "successful extraction",
  deletedAt: "the underlying record's deletion",
  purgeAfter: "the scheduled purge date",
  closureRequestedAt: "the account closure request",
  completedAt: "the deletion completing",
};

function formatTimeframe(entry: RetentionPolicyEntry): string {
  if (entry.windowDays === null) {
    return entry.note ?? "No fixed window";
  }
  const anchor = entry.anchor ? ANCHOR_LABELS[entry.anchor] : undefined;
  const days = `${entry.windowDays} day${entry.windowDays === 1 ? "" : "s"}`;
  return anchor ? `${days} after ${anchor}` : days;
}

export default function RetentionPolicyPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Data retention policy
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          This page lists every category of information the app collects,
          why we collect it, the business need for retaining it, and when it
          is deleted. Every window below is enforced by the same
          configuration our deletion jobs run against — this page cannot
          describe a retention period the code does not actually enforce.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data category</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Business need</TableHead>
              <TableHead>Deletion timeframe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RETENTION_POLICY.map((entry) => (
              <TableRow key={entry.key}>
                <TableCell className="whitespace-normal align-top font-medium text-foreground">
                  {CATEGORY_LABELS[entry.key] ?? entry.key}
                </TableCell>
                <TableCell className="whitespace-normal align-top text-muted-foreground">
                  {entry.purpose}
                </TableCell>
                <TableCell className="whitespace-normal align-top text-muted-foreground">
                  {entry.businessNeed}
                </TableCell>
                <TableCell className="whitespace-normal align-top text-foreground">
                  {formatTimeframe(entry)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        Read more in our{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          privacy policy
        </Link>
        . If you&apos;re a parent and want to review or delete your child&apos;s
        information, you can do so from that child&apos;s profile once you&apos;re
        signed in.
      </p>
    </div>
  );
}
