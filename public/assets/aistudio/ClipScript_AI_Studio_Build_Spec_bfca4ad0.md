---
title: "ClipScript — AI Video Editor MVP Build Specification"
subtitle: "A document-first video editor: edit the transcript, edit the video"
author: "Product Requirements + Google AI Studio Build Prompt"
output:
  html_document:
    toc: true
    toc_depth: 3
    number_sections: false
---

# 0. Instructions for Google AI Studio

**Build the working application described in this document. Do not create a static mockup.** Build a responsive, functional full-stack web app called **ClipScript**. The core user experience is that a user uploads a video, the app transcribes the spoken words with word-level timestamps, and deleting words or sentences from the transcript automatically removes the matching time ranges from the video and its audio. The transcript is the primary editing surface; the video preview updates to reflect edits.

Use the attached `clipscript_45_second_demo.mp4` as the first end-to-end test asset if it is available in the AI Studio project. Otherwise, allow the user to upload that file after the app is built. The demo is exactly 45 seconds and contains clear English narration, including the filler word “um” twice. The app should preserve filler words in its raw transcript so the user can delete them.

Implement real file upload, real transcription, timestamp-linked transcript editing, real video cutting, preview, undo/redo, and MP4 export. Do not fake transcription or simulate an export. If an API/model is unavailable, show a clear actionable error rather than returning invented transcript data.

# 1. Product vision

## Product name

**ClipScript**

## One-line value proposition

**Edit video like a document.** Upload a video, edit the words, and the matching video and audio are cut automatically.

## Problem

Traditional video editing requires users to learn a timeline, locate exact moments, split clips, and manually remove matching audio/video. For spoken-word videos, the transcript is a more natural representation of the content than a traditional timeline.

## MVP solution

ClipScript converts speech into a timestamped transcript. Each transcript word is linked to its location in the original video. When the user selects and deletes words or sentences, ClipScript removes the corresponding time ranges from both the video and audio, closes the gaps, and updates the preview.

## Primary user

A creator, student, founder, educator, or professional who edits talking-head videos, product demos, tutorials, interviews, lectures, or voice-led social content and wants a simpler alternative to timeline-first editing.

## Product principle

The transcript is the main editing interface. The timeline and video preview are supporting surfaces that make the text-to-video relationship understandable.

# 2. MVP scope and editing rules

## P0 — Must work in the first build

1. Upload a local video file: MP4, MOV, or WebM.
2. Show the video preview, filename, duration, upload state, and processing state.
3. Extract the audio from the uploaded video on the server using FFmpeg.
4. Transcribe the audio using Google's `gemini-3.5-transcribe` model, requesting **VERBATIM transcription and word-level timestamps**. Preserve filler words such as “um” and “uh”; do not use smart-cleanup mode for the editing transcript.
5. Render the transcript as a readable document with paragraph breaks, word-level timing metadata, and optional speaker labels when returned.
6. Let the user select one or more consecutive words or a sentence and press Backspace/Delete or click **Delete selection**.
7. Remove the corresponding source time range from both the video and audio. Close the gap so the remaining content plays continuously.
8. Update the transcript, edited duration, cut markers, and edited preview.
9. Provide Undo and Redo for transcript/video edits.
10. Export a real MP4 file with synchronized video and audio.
11. Provide clear loading, success, empty, and error states.

## Important distinction: deletion versus rewriting

The MVP's core promise is **delete text to cut the corresponding spoken moment from the video**.

- **Delete spoken words or sentences:** remove their timestamp range from the video and audio. This is the primary editing behavior and must work.
- **Correct a transcription typo:** allow a text-only correction, but clearly label it as a transcript correction. It does not change what was spoken in the source video.
- **Replace spoken wording with new wording:** do not silently change only the transcript while leaving the old audio. Show a clear “Voice replacement is not available in this MVP” message. AI-generated replacement speech, voice selection, lip-sync, and visual reconstruction belong in a later version.

This distinction prevents the transcript from claiming that a person said something they did not say.

## Explicitly out of scope for MVP

- AI-generated voice cloning or voice replacement.
- Automatic lip-sync or face re-animation.
- Multi-track editing, complex transitions, color grading, effects, filters, and keyframing.
- Team collaboration, user accounts, cloud project libraries, and subscriptions.
- Automatic removal of filler words. The raw verbatim transcript should retain them so users decide what to remove.
- Mobile-native editing. The web app must be responsive, but desktop is the primary editing experience.

# 3. Target user flow

1. User opens ClipScript and sees a focused upload screen.
2. User drags a video onto the upload area or selects a file.
3. App validates file type and duration, then displays the uploaded video in the preview player.
4. User clicks **Transcribe video**.
5. App extracts the audio and requests a verbatim timestamped transcription.
6. The editor opens with the video preview on the left/top and the editable transcript on the right/below.
7. User clicks a word to seek the video to that word's timestamp. While the video plays, the active word is highlighted.
8. User selects a phrase (for the demo, try deleting one or both instances of “um”) and presses Delete.
9. The app marks the selected source interval as removed, updates the transcript, and rebuilds the edited preview.
10. User presses Play to review the edited video, uses Undo if necessary, and clicks **Export MP4**.
11. Browser downloads the rendered MP4.

# 4. Experience and visual design

## Style direction

Create a polished, minimalist, calm, premium creator tool. Use a dark editor theme with a restrained teal/mint accent, high-contrast text, generous spacing, subtle borders, and rounded panels. Avoid a cluttered professional video-editing interface. It should feel closer to a document editor with a video preview than to a traditional nonlinear editor.

Suggested palette:

- App background: deep navy/charcoal (`#0B1220` or similar).
- Main panels: `#121E2B` / `#172738`.
- Main text: near-white.
- Secondary text: muted blue-gray.
- Accent: mint/teal (`#24D6B4` or similar).
- Removed text: muted red, strikethrough, and a “cut” indicator.
- Active word: subtle teal highlight.

Use a clean sans-serif font such as Inter. Keep controls obvious and accessible. Do not use excessive gradients, neon glows, or decorative visual noise.

## Main editor layout — desktop

- **Top navigation:** ClipScript logo/name on the left; project filename and saved/processing status in the middle; Undo, Redo, and Export MP4 on the right.
- **Video preview:** large player with play/pause, current time, total edited duration, volume, and a simple playback bar.
- **Transcript editor:** a scrollable document-like panel. Words should be individually addressable internally so their source start/end timestamps can be mapped to selection and deletion. Show natural punctuation and paragraph spacing.
- **Mini timeline / cut map:** a minimal strip below the video preview showing retained segments and removed ranges. This is a visual aid only; the transcript remains the primary editor.
- **Context toolbar:** when text is selected, show a small floating or inline action with “Delete from video”.
- **Export state:** show rendering progress and a clear download action.

## Main editor layout — mobile/tablet

Stack the video player above the transcript. Keep the primary Delete and Export actions accessible. Do not attempt to reproduce a dense desktop timeline on mobile.

## Transcript interaction details

- Render words as visually continuous text, not as a grid of buttons.
- Preserve spaces and punctuation when joining tokens into readable paragraphs.
- Support mouse drag selection and keyboard selection where practical.
- Also support a reliable fallback: click a word to select it, shift-click another word to extend the selection, then click **Delete selection**.
- Clearly show selected words before deletion.
- After deletion, collapse the text naturally and display a brief confirmation such as “Removed 2 words · 0.48 sec”.
- Clicking a word seeks the source preview to its timestamp. The active word follows playback.
- If the user deletes a word while playback is running, pause playback and apply the edit safely.

# 5. Transcription and timestamp requirements

## Preferred transcription model

Use the Google Gemini API server-side with model ID:

`gemini-3.5-transcribe`

Use the currently documented Google GenAI SDK/API method for prerecorded audio transcription. Configure it for **VERBATIM** output and request **word-level timestamps**. Do not use SMART mode for this editor transcript because SMART mode may remove filler words and is incompatible with word-level timestamps in the documented model configuration.

Normalize the model response into this internal shape regardless of the exact upstream response format:

```ts
export type TranscriptWord = {
  id: string;
  text: string;
  start: number;       // seconds, relative to original source video
  end: number;         // seconds, relative to original source video
  speakerId?: string;
  deleted: boolean;
  correctedText?: string;
};

export type TranscriptParagraph = {
  id: string;
  wordIds: string[];
};
```

If the API provides word-level timing offsets in a different unit or structure, normalize those values to seconds. Preserve the original token text and original timestamps as immutable source metadata.

## Transcription requirements

- Extract the audio track from the source video using FFmpeg.
- Submit the extracted audio to the transcription model, not the full video, for this audio-first workflow.
- Prefer an audio format accepted by the current API documentation (for example WAV or another supported audio MIME type).
- Request verbatim transcription and word-level timestamps. Do not ask an LLM to guess word timestamps from the transcript.
- If the model returns no word timestamps, do not invent them. Show a clear error or use a separately implemented forced-alignment service only if it can be integrated reliably.
- Preserve filler words and repetitions in the initial editor transcript.
- Support automatic language detection where the model returns it.
- Speaker labels are optional in this MVP; if returned, display them unobtrusively.

## Practical limits

For the first version, limit uploads to videos no longer than **15 minutes** when requesting word-level timestamps, and enforce a configurable upload-size limit. Display the limits before the upload begins. Make the limits easy to change later.

# 6. Video editing engine

## Source-of-truth model

Never destructively alter the original upload during editing. Store an immutable original source file and maintain an edit decision list (EDL) describing which original time ranges remain.

Example:

```ts
export type TimeRange = {
  start: number; // original source time in seconds
  end: number;
};

export type EditDecisionList = {
  deletedRanges: TimeRange[];
  version: number;
};
```

## Delete behavior

When selected transcript words are deleted:

1. Read the original `start` and `end` timestamp from every selected word.
2. Create a deletion range from the earliest selected start to the latest selected end for that contiguous selection.
3. Normalize ranges: clamp to the source duration, sort by start time, and merge overlapping ranges. Do not accidentally merge separate distant selections.
4. Add the range to the edit decision list.
5. Remove the selected transcript tokens from the visible transcript while retaining their source metadata in undo history.
6. Recalculate the retained source ranges as the complement of all deleted ranges.
7. Rebuild the preview/export from the original source using only the retained ranges.
8. Recalculate the edited duration and update the timeline strip.

For an MVP, it is acceptable to re-render the edited preview after each applied deletion rather than implementing frame-perfect live non-destructive playback. Show a short progress state while rendering. Cache the last rendered preview when practical.

## Accurate cutting

Use FFmpeg on the server for dependable export:

- Cut the same source time ranges from audio and video.
- Reset timestamps on each retained segment.
- Concatenate retained segments in order.
- Re-encode the final output to H.264 video + AAC audio in an MP4 container for consistent playback.
- Keep audio/video in sync after every cut.
- Avoid copying streams without re-encoding when cuts may not align with keyframes.
- Add very short audio fades at cut boundaries only if they do not change the word-selection behavior or create audible gaps.
- Preserve the source aspect ratio and resolution for MVP export.

If the user has removed all spoken words but video remains, retain non-deleted video intervals. If no media remains, disable Export and explain why.

## Undo and redo

Maintain an edit history stack. Each action should store the previous and next EDL state and transcript visibility state. Undo restores removed words and the previous edit list; Redo reapplies the deletion. Do not lose the original file when undoing.

# 7. Architecture and implementation

## Recommended stack

- Frontend: React + TypeScript.
- Styling: Tailwind CSS or a clean CSS module system.
- Backend: Node.js server runtime provided by Google AI Studio Build mode.
- Transcription: Google Gemini API, `gemini-3.5-transcribe`.
- Media processing: FFmpeg installed/available in the server runtime. If system FFmpeg is unavailable, use a server-compatible FFmpeg package. Avoid relying exclusively on browser FFmpeg for the first MVP because large video files can exhaust browser memory.
- State: React state/context for the active project and edit history. Keep original file and render artifacts in temporary server storage or browser memory for the active project.

## Suggested project structure

```text
src/
  App.tsx
  components/
    UploadScreen.tsx
    EditorShell.tsx
    VideoPreview.tsx
    TranscriptEditor.tsx
    MiniTimeline.tsx
    ExportButton.tsx
    ProcessingStatus.tsx
  lib/
    transcriptTypes.ts
    selectionMapping.ts
    editDecisionList.ts
    timeRanges.ts
    formatTime.ts
  styles/
    globals.css
server/
  index.ts
  routes/
    upload.ts
    transcribe.ts
    render.ts
  services/
    geminiTranscription.ts
    ffmpegMedia.ts
    editRenderer.ts
```

The exact structure can change if the generated project uses a different convention, but separate UI, transcription, and media-rendering concerns.

## Backend endpoints

Implement real server endpoints similar to:

- `POST /api/transcribe`: receive the uploaded video, extract audio, call Gemini transcription, return normalized transcript words and source duration.
- `POST /api/render`: receive the original project identifier or source file reference plus the EDL, render the retained ranges, and return an output file or temporary download URL.

You may add a lightweight upload/health endpoint if needed. Validate all inputs and return useful error messages.

## API key and privacy

- Use the server-side secret `GEMINI_API_KEY` managed by Google AI Studio.
- Never put the Gemini API key in frontend JavaScript, HTML, browser storage, or network-visible client configuration.
- Call Gemini only from the server runtime.
- Treat the original uploaded video and extracted audio as private user data.
- Do not make uploaded media publicly accessible.
- Delete temporary uploaded files, extracted audio, and rendered intermediates after the project expires or the user resets the project.
- Do not log raw audio, video, or full transcripts unnecessarily.

## Error handling

Handle at least:

- Unsupported file type.
- File too large or longer than the supported limit.
- Corrupt or unreadable video.
- Video with no audio track.
- Gemini API key missing or invalid.
- Transcription service/model unavailable.
- Empty transcript or missing word-level timestamps.
- FFmpeg unavailable or rendering failure.
- Export download failure.

Never silently return sample text when the real transcription fails.

# 8. Data model and mapping logic

Each word must retain source timestamps even after the visible transcript changes. Example:

```ts
export type Project = {
  id: string;
  filename: string;
  duration: number;
  originalFile: File | Blob;
  words: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
  editList: EditDecisionList;
  renderUrl?: string;
};
```

Maintain these rules:

- Source timestamps always refer to the original uploaded video.
- Edited timeline time is calculated from the source ranges that remain.
- Clicking a visible word seeks the original preview to its source timestamp before export, or seeks to its mapped edited timestamp when viewing the rendered preview.
- Deleted words are hidden from the visible transcript but remain recoverable through undo history.
- Corrected text is separate from source text and never changes the source time mapping.
- Do not use word order alone to infer timestamps after edits.

# 9. Acceptance tests

The MVP is not complete until these tests pass:

## Test A — upload and transcribe

1. Upload `clipscript_45_second_demo.mp4`.
2. Confirm the video preview loads and reports a duration of approximately 45 seconds.
3. Click **Transcribe video**.
4. Confirm a real transcript is returned with word-level start/end timestamps.
5. Confirm the initial transcript preserves the word “um” (the demo says it twice).

## Test B — text-to-video deletion

1. Select one visible “um” in the transcript.
2. Press Backspace/Delete or click **Delete selection**.
3. Confirm the word disappears from the transcript.
4. Confirm the matching source interval is included in the EDL as a deleted range.
5. Confirm the rendered preview no longer contains the matching spoken “um” segment.
6. Confirm the video and audio remain synchronized and the edited duration decreases by approximately the deleted interval.

## Test C — sentence deletion

1. Select a complete sentence.
2. Delete it.
3. Confirm the matching video and audio interval is cut and the remaining footage closes the gap.

## Test D — playback and navigation

1. Click a word in the transcript.
2. Confirm the preview seeks to the corresponding source moment.
3. Play the source and confirm the active word follows playback when timing data is available.

## Test E — undo and redo

1. Delete a phrase.
2. Click Undo and confirm the phrase and media range are restored.
3. Click Redo and confirm the deletion returns.

## Test F — export

1. Click Export MP4.
2. Confirm an actual MP4 is generated and downloaded.
3. Play the exported file and verify audio/video sync and the expected cuts.

## Test G — honest failure states

1. Upload a video with no audio and confirm a clear error.
2. Simulate a missing/invalid API key and confirm no fake transcript is shown.
3. If word-level timestamps are absent, do not enable text-to-video deletion based on guessed times.

# 10. Build order

Implement in this order and keep the app runnable after each phase:

1. Build the complete polished UI with upload state and editor layout.
2. Implement file upload and server-side video metadata/audio extraction.
3. Implement the real Gemini transcription endpoint and normalized word timestamps.
4. Render the document-style transcript and implement word selection/deletion.
5. Implement EDL generation, time-range normalization, and synchronized FFmpeg rendering.
6. Wire Undo/Redo, live preview updates, and Export MP4.
7. Run all acceptance tests using `clipscript_45_second_demo.mp4`.
8. Fix any issues discovered during the tests. Do not stop at a clickable prototype.

# 11. Final instruction to the coding agent

Prioritize a reliable end-to-end path over extra features. The defining moment of this product is: **I delete a phrase in the transcript, and the matching video and audio are removed automatically.** Make that behavior real before adding anything else.

Before finishing, verify the application compiles, the server starts, the API key is only used server-side, transcription returns real word timestamps, FFmpeg produces a playable MP4, and the included demo file can pass the acceptance tests. Report any feature that could not be completed honestly; do not claim that a non-functional control works.

---

# Appendix A — Demo asset details

**File:** `clipscript_45_second_demo.mp4`  
**Duration:** 45.0 seconds  
**Format:** MP4, H.264 video, AAC audio, 1280 × 720  
**Audio:** clear synthesized English narration  
**Transcript script:**

> Hi, welcome to ClipScript. Um, editing video should feel as simple as editing a document. First, upload your video. The AI listens and creates a transcript, with every word connected to its moment in the footage. Now, watch this. I built a short product demo, and, um, the transcript is ready. Delete a sentence, and the matching video and audio disappear. Remove a filler word, and the gap closes automatically. You can also correct a transcript, preview the edit, undo it, and export your video. For this first version, deleting text controls the cuts. Rewriting spoken words uses generated replacement audio. That's document-style video editing.

**Suggested first test:** upload the MP4, transcribe in VERBATIM mode, find the two instances of “um”, delete one, preview, undo, then delete the other and export.

# Appendix B — Official implementation references

- Google AI Studio Build mode: <https://ai.google.dev/gemini-api/docs/aistudio-build-mode>
- Gemini 3.5 Transcribe announcement and model identifiers: <https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5-transcribe/>
- Gemini 3.5 Transcribe model documentation, including VERBATIM/SMART modes and word-level timestamps: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-transcribe>
- FFmpeg.wasm project (browser-side alternative if needed): <https://github.com/ffmpegwasm/ffmpeg.wasm>

**Reference design note:** No external reference URL or attachment was present with the request. The visual direction above is therefore based on the product description. Add the reference URL or image to the AI Studio project and ask the agent to adapt the styling without changing the MVP behavior.
