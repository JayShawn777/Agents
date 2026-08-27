// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CheckpointResult } from "@/components/checkpoints/checkpoint-result";
import type { PracticeSetSummaryDTO } from "@/lib/schemas/dto";

/**
 * `components/checkpoints/checkpoint-result.tsx` — M2.5 slice 6.
 *
 * The FIRST component test in this repo (the jsdom environment and the react()
 * plugin have been configured since M0 waiting for one). It exists because
 * spec AC 13 is a claim about rendered output, and only rendered output can
 * settle it.
 */

function summary(overrides: Partial<PracticeSetSummaryDTO> = {}): PracticeSetSummaryDTO {
  return {
    skills: [{ skillCode: "4.NF.B.3", skillDescriptor: "Add and subtract fractions", problemsAnswered: 3 }],
    totalAnswered: 8,
    totalCorrect: 6,
    message: "Nice work — here's what you practiced.",
    ...overrides,
  };
}

describe("the point-in-time result (AC 12)", () => {
  it("shows how many were right out of how many were asked", () => {
    render(<CheckpointResult summary={summary()} />);
    expect(screen.getByText(/right/i).textContent).toMatch(/6\s*of\s*8/);
  });

  it("names the skills that came up, by descriptor and never by raw code", () => {
    render(<CheckpointResult summary={summary()} />);

    expect(screen.getByText("Add and subtract fractions")).toBeInTheDocument();
    expect(screen.queryByText("4.NF.B.3")).not.toBeInTheDocument();
  });

  it("renders no per-skill mark — 'which skills came up' is the useful part, 'you got fractions wrong' is not", () => {
    const { container } = render(
      <CheckpointResult
        summary={summary({
          skills: [
            { skillCode: "a", skillDescriptor: "Adding fractions", problemsAnswered: 4 },
            { skillCode: "b", skillDescriptor: "Long division", problemsAnswered: 4 },
          ],
        })}
      />,
    );
    // The only "n of m" on the page is the one overall result.
    expect(container.textContent?.match(/\d+\s*of\s*\d+/g) ?? []).toHaveLength(1);
  });
});

describe("AC 13 — nothing on this surface may read as a fall", () => {
  it("renders no percentage", () => {
    const { container } = render(<CheckpointResult summary={summary()} />);
    expect(container.textContent).not.toMatch(/%|percent/i);
  });

  it("renders no comparison to any earlier checkpoint", () => {
    const { container } = render(<CheckpointResult summary={summary()} />);
    expect(container.textContent).not.toMatch(/last time|previously|down from|up from|since|compared|better than|worse/i);
  });

  it("renders no delta or arrow", () => {
    const { container } = render(<CheckpointResult summary={summary()} />);
    expect(container.textContent).not.toMatch(/[▲▼↑↓]|[+-]\d/);
  });

  it("a checkpoint that went badly says nothing discouraging", () => {
    const { container } = render(<CheckpointResult summary={summary({ totalCorrect: 1, totalAnswered: 8 })} />);

    expect(container.textContent).toMatch(/1\s*of\s*8/);
    expect(container.textContent).not.toMatch(/fail|poor|bad|wrong|weak|struggl|only got/i);
  });

});

describe("edge cases", () => {
  it("zero answered reads as 'it'll keep', not as a zero score", () => {
    const { container } = render(
      <CheckpointResult summary={summary({ totalAnswered: 0, totalCorrect: 0, skills: [] })} />,
    );
    expect(container.textContent).toMatch(/it'll keep/i);
  });

  it("a perfect checkpoint is not celebrated differently from a hard one", () => {
    const perfect = render(<CheckpointResult summary={summary({ totalCorrect: 8 })} />).container.textContent ?? "";
    const hard = render(<CheckpointResult summary={summary({ totalCorrect: 2 })} />).container.textContent ?? "";

    // Same framing sentence in both — the message is chosen by how much was
    // answered, never by how much was right.
    expect(perfect.replace(/8 of 8/, "")).toBe(hard.replace(/2 of 8/, ""));
  });

  it("singularises a one-question skill", () => {
    render(
      <CheckpointResult
        summary={summary({ skills: [{ skillCode: "a", skillDescriptor: "Counting", problemsAnswered: 1 }] })}
      />,
    );
    expect(screen.getByText("1 question")).toBeInTheDocument();
  });
});
