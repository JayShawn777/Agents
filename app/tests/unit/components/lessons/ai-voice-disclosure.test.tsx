// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AiVoiceDisclosure } from "@/components/lessons/ai-voice-disclosure";

/**
 * M6 AC 16. A stock persona is "a computer voice"; a parent's cloned voice is
 * the one a child could mistake for the real person, so it names them and says
 * it is a recreation.
 */
describe("AiVoiceDisclosure", () => {
  it("describes a stock persona as a computer voice", () => {
    render(<AiVoiceDisclosure personaLabel="Coach Vale" />);
    expect(screen.getByText("Spoken by a computer voice (Coach Vale).")).toBeTruthy();
  });

  it("names the person and says a custom voice is a recreation, not a recording", () => {
    render(<AiVoiceDisclosure personaLabel="Dad" isCustomVoice />);
    expect(screen.getByText("An AI recreation of Dad’s voice, not a recording of them.")).toBeTruthy();
    expect(screen.queryByText(/computer voice/)).toBeNull();
  });
});
