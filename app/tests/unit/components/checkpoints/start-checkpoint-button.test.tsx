// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { StartCheckpointButton } from "@/components/checkpoints/start-checkpoint-button";

/** `components/checkpoints/start-checkpoint-button.tsx` — M2.5's only entry point. */

describe("when a checkpoint is available", () => {
  it("offers one, in the student's language rather than the schema's", () => {
    render(<StartCheckpointButton studentId="sp_1" available />);

    expect(screen.getByRole("button")).toHaveTextContent(/check what's stuck/i);
    expect(screen.queryByText(/checkpoint|quiz|test|assessment/i)).not.toBeInTheDocument();
  });
});

describe("when it is not", () => {
  it("renders an invitation, never a locked door", () => {
    const { container } = render(<StartCheckpointButton studentId="sp_1" available={false} />);

    expect(container.textContent).toMatch(/once there's a bit more practice/i);
    expect(container.textContent).not.toMatch(/locked|not eligible|unavailable|can't|cannot|denied|need \d+/i);
  });

  it("offers no button at all, so there is nothing to press and be refused by", () => {
    render(<StartCheckpointButton studentId="sp_1" available={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
