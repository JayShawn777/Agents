/**
 * zod input schema for `/api/students/[studentId]/notice` (plan §3, #7).
 */

import { z } from "zod";

/**
 * `noticeVersion` is compared server-side against the deployed
 * `DIRECT_NOTICE_VERSION` (409 on mismatch, plan §3 #7) — that comparison is
 * B9's job, not this schema's.
 */
export const submitNoticeInputSchema = z
  .object({
    noticeVersion: z.string().max(32),
    acknowledged: z.literal(true),
  })
  .strict();

export type SubmitNoticeInput = z.infer<typeof submitNoticeInputSchema>;
