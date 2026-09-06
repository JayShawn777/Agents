"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VoiceCaptureStep } from "@/components/voice/voice-capture-step";
import { uploadVoiceRecording } from "@/components/voice/voice-upload-flow";
import { apiFetch } from "@/lib/api/client";
import {
  VOICE_CONSENT_MAX_MS,
  VOICE_CONSENT_MIN_MS,
  VOICE_SAMPLE_MAX_MS,
  VOICE_SAMPLE_MIN_MS,
} from "@/lib/config";

/**
 * M6 AC 5/9/10 — the step machine for creating a custom voice.
 *
 * ## The order is the requirement, not a UX preference
 *
 * Consent statement, THEN sample. AC 5 requires it and the server enforces it —
 * `issueSampleGrant` refuses without a usable consent recording — so this
 * component cannot skip a step even if it wanted to. The ordering is here as
 * well because a flow that let someone record their voice and only then asked
 * for consent would have already captured the thing consent is about.
 *
 * ## Every failure is a plain sentence
 *
 * AC 14. Messages come from our own API envelope or from the small set of
 * constants below. No vendor text, no status codes, no error objects.
 */

type Step = "consent" | "sample" | "naming" | "done";

const GENERIC = "Something went wrong. Please try again.";

type GrantResponse = { grantId: string; pathname: string; wordingVersion?: string; lines?: string[] };

export type VoiceFlowProps = {
  /** The words to read, from the server so screen and stored version cannot drift. */
  consentLines: readonly string[];
};

export function VoiceFlow({ consentLines }: VoiceFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("consent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentRecordingId, setConsentRecordingId] = useState<string | null>(null);
  const [sampleGrantId, setSampleGrantId] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  function extensionFor(blob: Blob): string {
    const type = blob.type.split(";")[0];
    if (type === "audio/mp4") return "m4a";
    if (type === "audio/ogg") return "ogg";
    return "webm";
  }

  async function submitConsent(recording: { blob: Blob; durationMs: number }) {
    setBusy(true);
    setError(null);
    try {
      const grant = await apiFetch<GrantResponse>("/api/voice/consent-recording", {
        method: "POST",
        body: { contentType: recording.blob.type.split(";")[0], extension: extensionFor(recording.blob) },
      });
      if (!grant.ok) {
        setError(grant.error.message ?? GENERIC);
        return;
      }

      const uploaded = await uploadVoiceRecording({
        blob: recording.blob,
        pathname: grant.data.pathname,
        grantId: grant.data.grantId,
      });
      if (!uploaded.ok) {
        setError(uploaded.message);
        return;
      }

      const confirmed = await apiFetch<{ consentRecordingId: string }>(
        `/api/voice/consent-recording/${grant.data.grantId}/confirm`,
        { method: "POST", body: {} },
      );
      if (!confirmed.ok) {
        setError(confirmed.error.message ?? GENERIC);
        return;
      }

      setConsentRecordingId(confirmed.data.consentRecordingId);
      setStep("sample");
    } finally {
      setBusy(false);
    }
  }

  async function submitSample(recording: { blob: Blob; durationMs: number }) {
    if (!consentRecordingId) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await apiFetch<GrantResponse>("/api/voice/sample", {
        method: "POST",
        body: {
          contentType: recording.blob.type.split(";")[0],
          extension: extensionFor(recording.blob),
          durationMs: Math.round(recording.durationMs),
          consentRecordingId,
        },
      });
      if (!grant.ok) {
        setError(grant.error.message ?? GENERIC);
        return;
      }

      const uploaded = await uploadVoiceRecording({
        blob: recording.blob,
        pathname: grant.data.pathname,
        grantId: grant.data.grantId,
      });
      if (!uploaded.ok) {
        setError(uploaded.message);
        return;
      }

      setSampleGrantId(grant.data.grantId);
      setStep("naming");
    } finally {
      setBusy(false);
    }
  }

  async function createVoice() {
    if (!sampleGrantId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ persona: { id: string; status: string } }>("/api/voice", {
        method: "POST",
        body: { sampleGrantId, label: label.trim() },
      });
      if (!created.ok) {
        setError(created.error.message ?? GENERIC);
        return;
      }
      setStep("done");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === "consent" ? (
        <VoiceCaptureStep
          title="Step 1 of 3 — read this aloud"
          instructions={
            <>
              Read the statement below in your own voice. This is your recorded permission, and it is kept
              separately from your voice sample. It is never played to your children and never sent to our
              speech provider.
            </>
          }
          script={consentLines}
          minDurationMs={VOICE_CONSENT_MIN_MS}
          maxDurationMs={VOICE_CONSENT_MAX_MS}
          approveLabel="Use this recording"
          busy={busy}
          onApprove={(recording) => void submitConsent(recording)}
        />
      ) : null}

      {step === "sample" ? (
        <VoiceCaptureStep
          title="Step 2 of 3 — record your voice"
          instructions={
            <>
              Speak naturally for at least {Math.round(VOICE_SAMPLE_MIN_MS / 1000)} seconds — read a page of a
              book, or talk about your day. A quiet room and a steady distance from the microphone matter more
              than what you say.
            </>
          }
          minDurationMs={VOICE_SAMPLE_MIN_MS}
          maxDurationMs={VOICE_SAMPLE_MAX_MS}
          approveLabel="Use this recording"
          busy={busy}
          onApprove={(recording) => void submitSample(recording)}
        />
      ) : null}

      {step === "naming" ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Step 3 of 3 — name this voice</h2>
          <p className="text-muted-foreground text-sm">
            This is what your children will see when they choose a voice. It stays on your account — our speech
            provider never receives it.
          </p>
          <div className="space-y-2">
            <Label htmlFor="voice-label">Voice name</Label>
            <Input
              id="voice-label"
              value={label}
              maxLength={40}
              placeholder="Dad"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void createVoice()} disabled={busy || label.trim().length === 0}>
            {busy ? "Creating the voice…" : "Create my voice"}
          </Button>
        </section>
      ) : null}

      {step === "done" ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Your voice is ready</h2>
          <p className="text-muted-foreground text-sm">
            Your children can now choose {label.trim() || "this voice"} for their lessons. Your voice sample has
            been deleted — only the voice itself is kept, and you can remove it at any time.
          </p>
        </section>
      ) : null}
    </div>
  );
}
