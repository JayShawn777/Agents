import { describe, expect, it } from "vitest";

import { detectsDistress } from "@/lib/chat/safety";

/**
 * `lib/chat/safety.ts` — M3 AC 21.
 *
 * The plan states plainly that this check "has false negatives and false
 * positives and neither is measurable in CI". These are fixtures, not a
 * measurement: they pin the behaviour the code claims, and they are not
 * evidence that the check catches what a real distressed child would type.
 */

describe("messages that must stop tutoring", () => {
  // Written the way a child types: lower case, missing apostrophes, no full
  // stops. That is the input this has to work on, so it is the input tested.
  it.each([
    "i want to kill myself",
    "sometimes i think about killing myself",
    "i want to die",
    "i wanna die",
    "i wish i was dead",
    "everyone would be better off dead without me",
    "i dont want to be alive anymore",
    "i dont want to wake up tomorrow",
    "nobody would miss me if i was gone",
    "i hurt myself last night",
    "i have been cutting myself",
    "i hate myself so much",
    "my dad hits me",
    "my brother punched me really hard",
    "he touched me and i didnt like it",
    "im being bullied at school",
    "im scared to go home",
    "i dont feel safe",
    "im thinking about running away from home",
  ])("flags %j", (message) => {
    expect(detectsDistress(message)).toBe(true);
  });

  /** Punctuation, capitals and curly apostrophes must not defeat a match. */
  it.each([
    "I WANT TO DIE!!!",
    "I don’t want to live.",
    "i...want...to...die",
    "I  want   to  die",
  ])("normalises %j before matching", (message) => {
    expect(detectsDistress(message)).toBe(true);
  });

  it("flags a distress line buried in an otherwise ordinary message", () => {
    expect(
      detectsDistress("i did question 3 and got 8 but i dont know question 4. also i hate myself"),
    ).toBe(true);
  });
});

describe("ordinary tutoring messages that must NOT be flagged", () => {
  /**
   * The false-positive cost is one turn of tutoring replaced by a kind message
   * — real, but far below the cost of a miss. These are the cases common enough
   * that firing on them would make the tutor unusable, and they are all cases
   * where the child is not the object.
   */
  it.each([
    "i dont get question 4",
    "this is really hard",
    "i hate fractions",
    "i hate this homework so much",
    "this homework is killing me",
    "my hand hurts from writing",
    "i died laughing at the last question",
    "the story says the wolf hurt the sheep",
    "napoleon killed a lot of people in the war",
    "in the book the boy runs away to find his dog",
    "i got 3 wrong and i dont know why",
    "can you just tell me the answer",
    "what is 1/4 + 1/4",
  ])("leaves %j alone", (message) => {
    expect(detectsDistress(message)).toBe(false);
  });

  it("does not fire on an empty or whitespace message", () => {
    expect(detectsDistress("")).toBe(false);
    expect(detectsDistress("   ")).toBe(false);
  });
});

/**
 * The signal is the SELF-REFERENCE, not the vocabulary. A keyword bag on
 * "kill", "die" and "hurt" would fire on every one of the history and reading
 * fixtures above while catching nothing these patterns miss — and this app
 * tutors history and reading, not just maths.
 */
it("distinguishes a child describing themselves from a child describing a text", () => {
  expect(detectsDistress("i want to die")).toBe(true);
  expect(detectsDistress("the character wanted to die at the end of the story")).toBe(false);
});
