# Recording AI quality — design

**Date:** 2026-07-15
**Sentinel:** `AVUZ-STT-QUALITY-V1`
**Fork:** `avuz-conecta/integration_openai` branch `avuz` (submodule `apps/integration_openai`), pin 4.5.1.3 → **4.5.1.4**
**Also touches:** spreed overlay (`docker/overlays/spreed/lib/Service/RecordingService.php`)
**Builds on:** `AVUZ-AUDIO-CHUNK-V1` (chunked transcription, same fork)

## Problems (both real client complaints)

1. **Silence hallucination.** Whisper loops subtitle-credit / filler text on
   silent or near-silent audio (`"Legendas pela comunidade Amara.org"` ×N,
   `"E aí E aí…"`). Observed on a recovered prod recording (head+tail loops) and,
   worse, a client recording that transcribed to *nothing but* the Amara.org loop
   — so the summary correctly reported "no substantive content." An entire meeting
   effectively lost.
2. **Over-thin summary.** A 2 h meeting summarized to a few sentences. Three
   compounding causes in `SummaryProvider::process()`: a generic system prompt
   (`SummaryProvider.php:130`), a **recursive re-summarization** `do-while`
   (`:121-171`) that keeps compressing the combined
   summary until it stops shrinking, and a possibly-low global `maxTokens`
   (`:108`). No structure, no length proportionality.

Both are fixable in code we already own (the fork + the spreed overlay).

## A. Silence-hallucination filter (fork, transcription path)

`transcribe()` (`OpenAiAPIService.php` ~880-933) already requests
`response_format = verbose_json`, whose `segments[]` carry per-segment metrics
(`compression_ratio`, `no_speech_prob`, `avg_logprob`). Today it returns
`response['text']` wholesale (only using the last segment's `end` for quota).

**Change:** rebuild the returned text from `segments`, **dropping hallucinated
ones**, using Whisper's own thresholds:

- drop a segment if `compression_ratio > 2.4` (repetition — the loops score very
  high), **or** `no_speech_prob > 0.6` (non-speech/silence).
- join the surviving segments' `text` (trimmed, single space) → returned transcript.
- if `segments` is absent (non-verbose / other providers) or the filter removes
  everything, fall back to the original `response['text']` **only when no segments
  exist**; when segments exist but all are hallucinated, return the empty/near-empty
  result honestly (a silent recording legitimately has no transcript → the summary
  says so, instead of an Amara.org wall).
- quota still uses the last **original** segment's `end` (unchanged), so billing
  reflects real audio duration regardless of filtering.

Thresholds are literals (`2.4`, `0.6`); no config surface. Sentinel
`AVUZ-STT-QUALITY-V1`. Independent of B — pure fork change, one method.

### Interaction with chunking

`transcribeFile` calls `transcribe()` per chunk (`AVUZ-AUDIO-CHUNK-V1`); the
filter runs per chunk, then chunk texts are joined as today. No change to the
chunking loop.

## B. Structured meeting summary (spreed overlay + fork provider)

`SummaryProvider` is the **generic** `TextToTextSummary` provider (call summaries
and any other summarize-text use share it). `process(?string $userId, array
$input, callable)` gets only the input text — not the task's `appId` (`spreed`)
or `customId` (`call/summary/...`) — so it cannot tell a call recording from a
generic summary from the inside. To structure **only call recordings** without
disturbing generic summaries, spreed must signal the provider. Chosen signal: a
**sentinel prefix in the input text**.

1. **spreed overlay** — `RecordingService.php:267-273`, the summary `Task`
   construction. Change the input from `['input' => $output]` to
   `['input' => "<<AVUZ-MEETING>>\n" . $output]`. The sentinel travels in the
   summary input only (ephemeral); the stored transcript `.md` is separate and
   unaffected, so users never see it.
2. **fork `SummaryProvider::process()`** — detect a leading `<<AVUZ-MEETING>>`:
   - strip the sentinel line from the prompt.
   - use a **structured PT system prompt** producing:
     ```
     # Resumo
     <2-4 sentence overview>

     ## Tópicos discutidos
     - ...

     ## Decisões
     - ...

     ## Ações / próximos passos
     - [responsável] ...
     ```
     Instruct: same language as the transcript (PT), detail proportional to
     meeting length, omit a section only if it truly had no content, return only
     the summary markdown.
   - **skip the recursive re-compression.** For meeting input that fits the model
     context (a 2-3 h transcript ≈ 3-13k tokens; the completion model has ample
     context) → a **single** structured completion. Only if the transcript
     genuinely exceeds context → one map-reduce pass (summarize chunks with the
     structured prompt, combine once) — never the `while (oldNumChunks >
     newNumChunks)` recursive collapse.
   - use a generous output cap (e.g. `max($maxTokens, 2000)`) so structure isn't
     truncated.
   - **No sentinel → existing behavior verbatim** (generic prompt, current loop).
     Generic summaries are untouched.

Sentinel `AVUZ-STT-QUALITY-V1` on both edits.

### Why the spreed overlay (trade-off)

"Call-recordings-only" requires the spreed signal; the alternative ("all
summaries get structure") needed no spreed change but would put meeting sections
on unrelated summaries. Adding `RecordingService.php` to the existing spreed
overlay follows the established pattern (overlay applied at build, sentinel
verified at entrypoint) — but note spreed is a bundled app (not a version-pinned
fork), so this overlay file must be re-checked against spreed on NC upgrades,
same as the existing `RecordingController.php` overlay.

## Delivery

1. Fork branch `avuz`: A (`transcribe`) + B (`SummaryProvider`) + pin bump
   4.5.1.3 → 4.5.1.4; commit + push; advance submodule pointer in avuz-server.
2. spreed overlay: add/patch `docker/overlays/spreed/lib/Service/RecordingService.php`
   with the sentinel-prefixed summary input; ensure the build applies it and (if
   the entrypoint sentinel-verifies spreed overlays) add a verification line.
3. Build + deploy per the existing runbook; verify sentinels in the running container.

## Testing

Runnable locally where no NC harness is needed (matches `AVUZ-AUDIO-CHUNK-V1`
precedent — the fork phpunit needs the full NC tree, unavailable in this
deployment checkout):

**A — segment filter (pure logic, standalone PHP):**
1. segments with one high-`compression_ratio` loop segment + real ones → loop
   dropped, real text joined.
2. `no_speech_prob > 0.6` segment → dropped.
3. all segments hallucinated → empty result (not the loop text).
4. no `segments` key → falls back to `response['text']` unchanged.

**B — sentinel routing + structure (pure logic where possible):**
5. input with `<<AVUZ-MEETING>>` → sentinel stripped, structured system prompt
   selected, single-shot path (no recursive loop) for in-context length.
6. input without sentinel → generic prompt + existing loop (unchanged).

**e2e (staging, real wiring):** recover/re-run a real recording (incl. the
silence-heavy one) → transcript free of Amara.org loops; summary is structured
(Resumo/Tópicos/Decisões/Ações) and proportional. Verify via `taskprocessing:task:get`
through `portainer-exec` as in the chunking e2e.

## Out of scope (YAGNI)

- Admin/user-configurable summary instruction (chose a good default instead).
- `ffmpeg silenceremove` pre-filter (segment-metric filtering addresses the
  hallucination without audio-clipping risk; revisit only if loops survive).
- Restructuring generic (non-recording) summaries.
- Per-call or per-user summary settings.
