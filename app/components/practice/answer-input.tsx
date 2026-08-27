"use client";

/**
 * CLIENT: switches on `AnswerFormat` (plan §4, F22; M2 AC 10). A leaf of
 * `practice-runner.tsx` — it owns no submission logic itself, only the
 * current draft value (text formats) or an immediate choice pick
 * (`MULTIPLE_CHOICE`, which submits on click rather than needing a separate
 * button, matching how a child expects a multiple-choice question to work).
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AnswerFormat } from "@/lib/domain/enums";

const PLACEHOLDER: Record<AnswerFormat, string> = {
  NUMERIC: "Type a number…",
  EXPRESSION: "Type an expression…",
  FRACTION: "e.g. 1/2",
  SHORT_TEXT: "Type your answer…",
  MULTIPLE_CHOICE: "",
};

export function AnswerInput({
  format,
  choices,
  value,
  onChange,
  onSelectChoice,
  disabled,
  maxLength,
}: {
  format: AnswerFormat;
  choices: string[];
  value: string;
  onChange: (value: string) => void;
  onSelectChoice: (choice: string) => void;
  disabled: boolean;
  maxLength: number;
}) {
  if (format === "MULTIPLE_CHOICE") {
    return (
      <div className="flex flex-col gap-2">
        {choices.map((choice) => (
          <Button
            key={choice}
            type="button"
            variant="outline"
            className="h-11 w-full justify-start whitespace-normal text-left"
            disabled={disabled}
            onClick={() => onSelectChoice(choice)}
          >
            {choice}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={PLACEHOLDER[format]}
      autoComplete="off"
      inputMode={format === "NUMERIC" ? "decimal" : "text"}
      className="h-11"
    />
  );
}
