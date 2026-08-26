/**
 * zod input schema for `POST /api/account/closure` (plan §3, #13).
 */

import { z } from "zod";

export const accountClosureInputSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();

export type AccountClosureInput = z.infer<typeof accountClosureInputSchema>;
