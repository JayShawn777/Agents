import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("scaffold smoke", () => {
  it("merges class names via the shadcn cn() helper", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
