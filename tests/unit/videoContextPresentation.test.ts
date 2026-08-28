import { describe, expect, it } from "vitest";
import type { VideoSpeechStamp } from "../../shared/contracts";
import { videoSpeechLabel, videoSpeechSummary } from "../../src/features/generation/videoContextPresentation";

function speech(mode: VideoSpeechStamp["mode"], spokenText: string | null): VideoSpeechStamp {
  return {
    schemaVersion: "creative-studio-video-speech/1.0",
    mode,
    authoredText: spokenText,
    spokenText,
    directive: "Provider-specific speech direction.",
  };
}

describe("video context presentation", () => {
  it("labels every speech policy compactly", () => {
    expect(videoSpeechLabel(speech("no-speech", null))).toBe("No dialogue");
    expect(videoSpeechLabel(speech("short-natural-line", "We should go."))).toBe("Simple line");
    expect(videoSpeechLabel(speech("exact-script", "Do not open that door."))).toBe("Exact script");
  });

  it("shows the actual spoken line while keeping no-speech explicit", () => {
    expect(videoSpeechSummary(speech("no-speech", null))).toBe("No dialogue · designed sound remains");
    expect(videoSpeechSummary(speech("short-natural-line", "We should go."))).toBe("Simple line · “We should go.”");
    expect(videoSpeechSummary(speech("exact-script", "Do not open that door."))).toBe("Exact script · “Do not open that door.”");
  });
});
