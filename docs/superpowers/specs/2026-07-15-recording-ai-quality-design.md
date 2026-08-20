# Recording AI quality — design

**Date:** 2026-07-15
**Sentinel:** `AVUZ-STT-QUALITY-V1`
**Fork:** `avuz-conecta/integration_openai` branch `avuz` (submodule `apps/integration_openai`), pin 4.5.1.3 → **4.5.1.4**
**Scope:** fork-only — no spreed overlay (grilled B1)
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

Both are fixable in the fork we already own (no spreed change — see §B).

## A. Silence-hallucination filter (fork, transcription path)

`transcribe()` (`OpenAiAPIService.php` ~1000-1038) already requests
`response_format = verbose_json`, whose `segments[]` carry per-segment metrics.
**Empirically confirmed on staging (2026-07-15)** via `request()` on a 10-min
silent tone → 20 hallucinated segments, each `text = "Legendas pela comunidade
Amara.org"`, with keys: `id, seek, start, end, text, tokens, temperature,
avg_logprob, compression_ratio, no_speech_prob`. Critically:

```
compression_ratio = 0.81   ← LOW  (a single short line compresses poorly)
no_speech_prob    = 0.95-0.97 ← HIGH (silence)
```

**CORRECTION (2026-07-15, from real recording data):** `no_speech_prob` is **NOT**
a reliable signal. Probing a real recording (avuz-app3 `kx6p5im6`) measured **real
Portuguese speech at `no_speech_prob = 0.93`** — as high as the hallucination
(0.95). Any nsp threshold that catches the loop also deletes real speech (it would
drop "conectar aqui no nosso servidor…"). nsp is abandoned.

The reliable signal is **repetition**: on silence/noise Whisper loops the *same
short text* dozens of times ("o"×hundreds, "Amara.org"×20), whereas real speech is
varied even when nsp is high. Today `transcribe()` returns `response['text']`
wholesale (using the last segment's `end` for quota).

**Change:** rebuild the returned text from `segments`, **dropping hallucinated
ones** by repetition:

- **primary (repetition):** count each segment's trimmed, lowercased text; drop a
  segment whose text is short (`mb_strlen <= 60`) and appears **>= 3 times** across
  the response (the loop signature). Real varied speech never repeats identically,
  so it survives regardless of nsp.
- **secondary:** drop if `compression_ratio > 2.4` (within-segment loops like
  "E aí E aí E aí…" packed into one segment).
- **missing-metric guard:** a segment lacking `compression_ratio` is kept.
- **duration before filtering:** compute quota duration from the *original*
  segments **before** filtering — today's code `array_pop`s the array (`:1030`),
  so read duration first (via `end()`, non-mutating).
- join surviving segments' `text` (trimmed, single space) → returned transcript.
- **fallback:** if `segments` is absent (non-verbose response), return
  `response['text']` unchanged. If all segments are filtered out, return empty —
  §C turns that into a "sem conteúdo de fala" note.

**Does NOT solve the whole-chunk loop (separate gap):** when a long noise/silence
*prefix* (e.g. 30 min of load-test bot tone) makes Whisper loop for the ENTIRE
chunk, the real speech after it is never emitted — there is nothing in `segments`
to keep. The filter yields empty; recovery requires cutting the noise prefix
(`silenceremove` / smaller chunks) — a follow-up spec, not this change.

**Tradeoff (accept):** a real phrase repeated >= 3× identically as short segments
(e.g. "obrigado" ×3) would be dropped — rare for real speech, negligible loss.
Constants are literals (`60`, `3`, `2.4`); no config surface. Sentinel
`AVUZ-STT-QUALITY-V1`. Independent of B — pure fork change, one method.

### Interaction with chunking

`transcribeFile` calls `transcribe()` per chunk (`AVUZ-AUDIO-CHUNK-V1`); the
filter runs per chunk, then chunk texts are joined as today. No change to the
chunking loop.

## B. Structured summary (fork provider only — no spreed overlay)

`SummaryProvider` is the **generic** `TextToTextSummary` provider;
`process(?string $userId, array $input, callable)` gets only the input text — not
the task's `appId`/`customId` — so it cannot distinguish a call recording from a
generic summary. **Decision (grilled B1):** rather than overlay a ~500-line,
upstream-volatile `RecordingService.php` just to prefix a sentinel (permanent
skew debt for one line), **structure ALL summaries**. On this Talk-centric
instance, generic (non-recording) summaries are rare, and the prompt is written
to degrade gracefully (empty sections collapse). Confirmed `SummaryProvider` is
the provider that runs (empty `ai.taskprocessing_provider_preferences`;
integration_openai is the only AI app; a real summary — task 19 — ran through it).

**Edit `SummaryProvider::process()` (`SummaryProvider.php:100-175`):**

- Replace the generic system prompt (`:130-131`) with a **structured PT prompt**
  producing:
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
  Instruct: reply in the same language as the text (PT), detail proportional to
  the source length, **omit any section that genuinely had no content** (so a
  short/generic text collapses to just `# Resumo`), return only the markdown.
- **Kill the recursive re-compression.** Today `process()` loops
  `while ($oldNumChunks > $newNumChunks)` (`:121-171`), re-summarizing the
  combined summary until it stops shrinking — that is what over-compresses a 2 h
  meeting. Replace with: if the transcript fits the model context (typical 2-3 h
  ≈ 3-13k tokens) → a **single** structured completion. Only if it genuinely
  exceeds context → **one** map-reduce pass (structured-summarize each chunk,
  combine once) — never a recursive re-collapse. The fit boundary is concrete:
  chunk with the existing `chunkService->chunkSplitPrompt()`; if it yields **1
  chunk**, single-shot; if **>1**, one pass over the chunks then a single combine
  completion.
- Reuse `createChatCompletion($userId, $model, $userPrompt, $systemPrompt, null,
  1, $maxTokens)` (signature confirmed) with the structured `$systemPrompt`.
- Raise the output cap: `$maxTokens = max($maxTokens, 2000)` so structure isn't
  truncated.

Sentinel `AVUZ-STT-QUALITY-V1`. Pure fork change, one file. **No spreed change,
no sentinel-in-input, no overlay skew.**

## C. Empty-transcript handling (silent recording)

After §A a fully-silent recording yields an empty transcript; spreed still
schedules a summary. Guard in `SummaryProvider::process()`: if the input text
(trimmed) is empty or trivially short (< ~20 chars), **short-circuit** and return
a fixed note `# Resumo\n\nSem conteúdo de fala detectado na gravação.` — do not
call the LLM (avoids the model hallucinating structure over nothing). The stored
transcript stays empty; the summary is honest. Same sentinel.

## Delivery

1. Fork branch `avuz`: §A (`transcribe`) + §B/§C (`SummaryProvider`) + pin bump
   4.5.1.3 → **4.5.1.4**; commit + push; advance submodule pointer in avuz-server.
2. Build + deploy per the existing runbook; verify the `AVUZ-STT-QUALITY-V1`
   sentinel + pin in the running container. **No spreed overlay touched.**

## Testing

Runnable locally where no NC harness is needed (matches `AVUZ-AUDIO-CHUNK-V1`
precedent — the fork phpunit needs the full NC tree, unavailable in this
deployment checkout):

**A — repetition filter (pure logic, standalone PHP mirroring the filter):**
1. same short text repeated ≥3× (Amara.org ×20, "o" ×N) → dropped → empty.
2. real varied speech at `no_speech_prob = 0.93` → **kept** (proves nsp-independence).
3. mixed loop + real segments → only the real ones kept.
4. `compression_ratio > 2.4` within-segment loop → dropped.
5. no `segments` key at all → falls back to `response['text']` unchanged.
6. quota duration read from original segments even though the array is later
   filtered/`array_pop`ed.

**B/C — summary (pure logic where possible):**
7. input yields 1 chunk → single structured completion, no recursive loop.
8. input empty / < ~20 chars → short-circuit "Sem conteúdo de fala" note, no LLM call.

**e2e (staging, real wiring):** re-run a real silence-heavy recording → transcript
free of Amara.org/E-aí loops; a real meeting → summary is structured
(Resumo/Tópicos/Decisões/Ações) and proportional (not over-compressed). Verify via
`taskprocessing:task:get` through `portainer-exec` as in the chunking e2e.

## Out of scope (YAGNI)

- Admin/user-configurable summary instruction (chose a good default instead).
- `ffmpeg silenceremove` pre-filter (`no_speech_prob` filtering addresses the
  hallucination without audio-clipping risk; revisit only if loops survive).
- Call-recording-only summary structure (grilled B1 — not worth the spreed
  overlay skew; all summaries get the graceful structured prompt).
- Per-call or per-user summary settings.
