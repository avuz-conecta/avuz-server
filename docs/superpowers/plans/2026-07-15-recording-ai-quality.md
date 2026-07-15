# Recording AI Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Whisper silence-hallucination from polluting transcripts, and make call summaries structured + proportional instead of over-compressed.

**Architecture:** Two independent edits in the `integration_openai` fork. §A filters hallucinated segments out of `transcribe()` using the `verbose_json` per-segment metrics we already receive. §B/§C rewrite `SummaryProvider::process()` with a structured PT prompt, kill the recursive re-compression, and short-circuit empty transcripts. Fork-only — no spreed change.

**Tech Stack:** PHP 8 (Nextcloud app), OpenAI Whisper `verbose_json`, `createChatCompletion` via `OC\Http\Client`.

## Global Constraints

- Sentinel for all new/changed blocks: `AVUZ-STT-QUALITY-V1` (code comment).
- Fork repo `avuz-conecta/integration_openai`, branch `avuz`, submodule `apps/integration_openai`.
- Version pin bump **4.5.1.3 → 4.5.1.4** in `appinfo/info.xml` (must stay ≥ store).
- Segment-filter thresholds (literals, no config): drop if `no_speech_prob > 0.6` (**primary** — silence-hallucination scores ~0.95, empirically confirmed) **or** `compression_ratio > 2.4` (**secondary** — within-segment loops). **Missing metric key → keep the segment.**
- Summary output cap: `max($maxTokens, 2000)`.
- Empty/short transcript (`< 20` trimmed chars) → fixed note `# Resumo\n\nSem conteúdo de fala detectado na gravação.` — no LLM call.
- No new config surface, no new Composer deps, no spreed overlay.
- **Testing reality:** the fork's phpunit needs the full NC tree (not runnable in this deployment checkout). Per `AVUZ-AUDIO-CHUNK-V1` precedent: standalone `php` scripts that mirror the pure filter/routing logic (runnable here) + `php -l`, with the definitive gate being staging e2e.

**Reference (current code):**
- `OpenAiAPIService::transcribe()` — `lib/Service/OpenAiAPIService.php:1021-1038` (response → quota → `return $response['text']`).
- `SummaryProvider::process()` — `lib/TaskProcessing/SummaryProvider.php:100-175` (chunk → per-chunk summary → **recursive** `do-while` `:121-171`). Deps: `openAiAPIService`, `openAiSettingsService`, `l` (IL10N), `chunkService`. `createChatCompletion(?userId, model, ?userPrompt, ?systemPrompt, ?history, n, ?maxTokens, …)` returns `['messages' => string[]]`; take `end($messages)`.

---

### Task 1: §A — filter hallucinated segments in `transcribe()`

**Files:**
- Modify: `apps/integration_openai/lib/Service/OpenAiAPIService.php` (add private helper; rewire `transcribe()` `:1021-1038`)
- Verify: standalone PHP mirroring the filter + `php -l`

**Interfaces:**
- Consumes: `$response` from `request()` — has `text` and (for `verbose_json`) `segments[]`, each optionally carrying `no_speech_prob`, `compression_ratio`, `end`, `text`.
- Produces: `filterHallucinatedSegments(array $segments): string`; `transcribe()` returns the filtered transcript (unchanged signature).

- [ ] **Step 1: Add the filter helper** (insert immediately before `public function transcribe(` — find its line, add above its docblock)

```php
	/**
	 * AVUZ-STT-QUALITY-V1
	 * Rebuild transcript text from Whisper verbose_json segments, dropping
	 * hallucinated ones. Whisper loops filler ("Legendas pela comunidade
	 * Amara.org", "E aí E aí…") on silence; those segments score no_speech_prob
	 * ~0.95 (empirically confirmed) — the reliable signal. compression_ratio is
	 * per-segment so it only catches within-segment loops (secondary). A segment
	 * missing a metric is kept (never drop on absent data).
	 */
	private function filterHallucinatedSegments(array $segments): string {
		$kept = [];
		foreach ($segments as $segment) {
			$noSpeechProb = $segment['no_speech_prob'] ?? null;
			if ($noSpeechProb !== null && (float)$noSpeechProb > 0.6) {
				continue;
			}
			$compressionRatio = $segment['compression_ratio'] ?? null;
			if ($compressionRatio !== null && (float)$compressionRatio > 2.4) {
				continue;
			}
			$text = trim((string)($segment['text'] ?? ''));
			if ($text !== '') {
				$kept[] = $text;
			}
		}
		return implode(' ', $kept);
	}
```

- [ ] **Step 2: Rewire `transcribe()`'s tail** — replace lines `1028-1038` (the quota block + `return $response['text'];`) with:

```php
		// Extract audio duration from response and store it as quota usage.
		// AVUZ-STT-QUALITY-V1: read duration from the ORIGINAL segments before
		// filtering (do not array_pop — the filter needs the full array).
		$transcript = $response['text'];
		if (isset($response['segments']) && is_array($response['segments']) && count($response['segments']) > 0) {
			$lastSegment = end($response['segments']);
			if (is_array($lastSegment) && isset($lastSegment['end'])) {
				$audioDuration = intval(round(floatval($lastSegment['end'])));
				try {
					$this->createQuotaUsage($userId ?? '', Application::QUOTA_TYPE_TRANSCRIPTION, $audioDuration);
				} catch (DBException $e) {
					$this->logger->warning('Could not create quota usage for user: ' . $userId . ' and quota type: ' . Application::QUOTA_TYPE_TRANSCRIPTION . '. Error: ' . $e->getMessage(), ['app' => Application::APP_ID]);
				}
			}
			// AVUZ-STT-QUALITY-V1: drop hallucinated segments. All-hallucinated
			// (silent recording) → empty string; §C turns that into a note.
			$transcript = $this->filterHallucinatedSegments($response['segments']);
		}
		return $transcript;
```

- [ ] **Step 3: Lint**

Run: `cd apps/integration_openai && php -l lib/Service/OpenAiAPIService.php`
Expected: `No syntax errors detected`

- [ ] **Step 4: Prove the filter logic (standalone, runnable locally)**

```bash
cat > /tmp/avuz_filter_test.php <<'PHP'
<?php
// Mirrors filterHallucinatedSegments exactly.
function filt(array $segments): string {
  $kept = [];
  foreach ($segments as $s) {
    $nsp = $s['no_speech_prob'] ?? null;
    if ($nsp !== null && (float)$nsp > 0.6) continue;
    $cr = $s['compression_ratio'] ?? null;
    if ($cr !== null && (float)$cr > 2.4) continue;
    $t = trim((string)($s['text'] ?? ''));
    if ($t !== '') $kept[] = $t;
  }
  return implode(' ', $kept);
}
$segs = [
  ['text'=>'Olá, boa tarde','no_speech_prob'=>0.02,'compression_ratio'=>1.1], // real → keep
  ['text'=>'Legendas pela comunidade Amara.org','no_speech_prob'=>0.96,'compression_ratio'=>0.81], // silence → drop
  ['text'=>'E aí E aí E aí E aí','no_speech_prob'=>0.10,'compression_ratio'=>3.0], // in-seg loop → drop
  ['text'=>'tudo bem?','no_speech_prob'=>0.05], // missing cr → keep
  ['text'=>'combinado'], // missing both → keep
];
$out = filt($segs);
$want = 'Olá, boa tarde tudo bem? combinado';
echo "got=[$out]\n";
$ok1 = $out === $want;
$ok2 = filt([['text'=>'x','no_speech_prob'=>0.9],['text'=>'y','no_speech_prob'=>0.95]]) === ''; // all hallucinated
echo ($ok1 ? "ok join+guards\n" : "FAIL join\n");
echo ($ok2 ? "ok all-dropped→empty\n" : "FAIL all-dropped\n");
exit($ok1 && $ok2 ? 0 : 1);
PHP
php /tmp/avuz_filter_test.php; echo "exit=$?"
```
Expected: `got=[Olá, boa tarde tudo bem? combinado]`, both `ok`, `exit=0`. Proves no_speech_prob primary, compression_ratio secondary, missing-metric keep, all-dropped→empty.

- [ ] **Step 5: Commit**

```bash
cd apps/integration_openai
git add lib/Service/OpenAiAPIService.php
git commit -m "AVUZ-STT-QUALITY-V1: filter silence-hallucination segments (no_speech_prob)"
```

---

### Task 2: §B/§C — structured summary, kill recursion, empty guard

**Files:**
- Modify: `apps/integration_openai/lib/TaskProcessing/SummaryProvider.php` (replace `process()` body `:100-175`)
- Verify: standalone PHP for routing/empty logic + `php -l`

**Interfaces:**
- Consumes: `$input['input']` (transcript), optional `$input['max_tokens']`, `$input['model']`; `chunkService->chunkSplitPrompt(string): string[]`; `createChatCompletion(...): array` (`['messages'=>string[]]`).
- Produces: `process(...): array` → `['output' => string]` (unchanged contract).

- [ ] **Step 1: Replace the `process()` body.** Keep the signature + the initial `$input['input']` validation (`:103-106`). Replace everything from the `$maxTokens = …` line (`:108`) through the `return ['output' => $summary];` (`:175`) with:

```php
		$prompt = $input['input'];

		// AVUZ-STT-QUALITY-V1 (§C): silent recording → empty/near-empty transcript.
		// Don't ask the LLM to summarize nothing (it hallucinates structure).
		if (mb_strlen(trim($prompt)) < 20) {
			return ['output' => "# Resumo\n\nSem conteúdo de fala detectado na gravação."];
		}

		$maxTokens = $this->openAiSettingsService->getMaxTokens();
		if (isset($input['max_tokens']) && is_int($input['max_tokens'])) {
			$maxTokens = $input['max_tokens'];
		}
		$maxTokens = max($maxTokens, 2000); // room for the structured summary

		$model = $this->openAiSettingsService->getAdminDefaultCompletionModelId();
		if (isset($input['model']) && is_string($input['model'])) {
			$model = $input['model'];
		}

		// AVUZ-STT-QUALITY-V1 (§B): structured PT summary; no recursive re-compress.
		$structuredSystemPrompt =
			'Você é um assistente que resume reuniões em português do Brasil. '
			. 'Produza um resumo em markdown com esta estrutura, omitindo qualquer '
			. "seção sem conteúdo real:\n\n"
			. "# Resumo\n<visão geral em 2 a 4 frases>\n\n"
			. "## Tópicos discutidos\n- ...\n\n"
			. "## Decisões\n- ...\n\n"
			. "## Ações / próximos passos\n- [responsável] ...\n\n"
			. 'O nível de detalhe deve ser proporcional à duração da reunião. '
			. 'Responda no mesmo idioma do texto. '
			. 'Retorne apenas o resumo em markdown, sem comentários adicionais.';

		$runChat = function (string $text, string $system) use ($userId, $model, $maxTokens): string {
			$completion = $this->openAiAPIService->createChatCompletion($userId, $model, $text, $system, null, 1, $maxTokens);
			$messages = $completion['messages'] ?? [];
			$last = end($messages);
			return is_string($last) ? $last : '';
		};

		$chunks = $this->chunkService->chunkSplitPrompt($prompt);
		$reportProgress(0.1);

		if (count($chunks) <= 1) {
			// Fits the model context → one structured completion. This is the
			// common case (a 2-3h transcript fits) and preserves detail.
			$summary = $runChat($chunks[0] ?? $prompt, $structuredSystemPrompt);
		} else {
			// Too long for one call → single map-reduce pass (never recursive).
			// map: extract key points per chunk; reduce: one structured summary.
			$pointsSystemPrompt = 'Extraia os pontos-chave deste trecho de uma reunião, '
				. 'em português, como uma lista concisa de bullets. Retorne apenas os bullets.';
			$points = [];
			$step = 0.7 / (float)count($chunks);
			$progress = 0.1;
			foreach ($chunks as $chunk) {
				$points[] = $runChat($chunk, $pointsSystemPrompt);
				$progress += $step;
				$reportProgress($progress);
			}
			$summary = $runChat(implode("\n", $points), $structuredSystemPrompt);
		}

		$reportProgress(1.0);
		$this->openAiAPIService->updateExpTextProcessingTime(time() - $startTime);
		return ['output' => $summary];
```

Note `$startTime` is already set at the top of `process()` (`:101`) — keep it. The generic-vs-chat branch and the recursive `do-while` are gone; `createChatCompletion` is the single path (this instance's LLM is chat-capable — OpenRouter).

- [ ] **Step 2: Lint**

Run: `cd apps/integration_openai && php -l lib/TaskProcessing/SummaryProvider.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Prove the empty-guard + chunk routing (standalone, runnable locally)**

```bash
cat > /tmp/avuz_summary_test.php <<'PHP'
<?php
// Mirrors the §C empty guard + §B chunk-count routing decision.
function route(string $prompt, array $chunks): string {
  if (mb_strlen(trim($prompt)) < 20) return 'EMPTY_NOTE';
  return count($chunks) <= 1 ? 'SINGLE' : 'MAP_REDUCE';
}
$cases = [
  ['',                     [],          'EMPTY_NOTE'],
  ['   . ',                ['. '],      'EMPTY_NOTE'],
  [str_repeat('a',50),     ['chunk'],   'SINGLE'],
  [str_repeat('a',50000),  ['c1','c2','c3'], 'MAP_REDUCE'],
];
$fail=0;
foreach ($cases as [$p,$ch,$want]) {
  $got = route($p,$ch); if ($got!==$want) $fail++;
  printf("%s want=%s got=%s\n", $got===$want?'ok ':'FAIL', $want, $got);
}
exit($fail===0?0:1);
PHP
php /tmp/avuz_summary_test.php; echo "exit=$?"
```
Expected: all `ok`, `exit=0`. Proves empty/short → note, 1 chunk → single, >1 → map-reduce (no recursion).

- [ ] **Step 4: Commit**

```bash
cd apps/integration_openai
git add lib/TaskProcessing/SummaryProvider.php
git commit -m "AVUZ-STT-QUALITY-V1: structured PT summary, kill recursive over-compress, empty guard"
```

---

### Task 3: Bump pin + push fork + submodule pointer

**Files:**
- Modify: `apps/integration_openai/appinfo/info.xml` (`<version>`)
- Modify: avuz-server submodule pointer

- [ ] **Step 1: Bump 4.5.1.3 → 4.5.1.4**

Edit `apps/integration_openai/appinfo/info.xml`: `<version>4.5.1.4</version>`

- [ ] **Step 2: Verify**

Run: `cd apps/integration_openai && grep -n '<version>' appinfo/info.xml`
Expected: `<version>4.5.1.4</version>`

- [ ] **Step 3: Commit + push fork**

```bash
cd apps/integration_openai
git add appinfo/info.xml
git commit -m "AVUZ-STT-QUALITY-V1: bump pin 4.5.1.3 -> 4.5.1.4"
git push origin avuz
```

- [ ] **Step 4: Advance submodule pointer + commit avuz-server**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
git add apps/integration_openai
git commit -m "chore(submodule): integration_openai -> AVUZ-STT-QUALITY-V1 (silence filter + structured summary)"
```

---

### Task 4: Build, deploy (staging), e2e

**Files:** none (operational). Reuse `2026-07-14-whisper-chunked-transcription-PROD-RUNBOOK.md` mechanics; **staging first** (`avuz-conecta-2-app-1`).

- [ ] **Step 1: Build + push the staging image**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
./scripts/build-push.sh latest staging
```
(Staging stack pulls `:staging`. Confirm which tag `avuz-conecta-2` uses; use the matching build target.)

- [ ] **Step 2: Deploy staging + verify sentinel/pin**

Redeploy `avuz-conecta-2` (`./scripts/deploy.sh <staging-stack>`), then:
```bash
./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 grep -c AVUZ-STT-QUALITY-V1 /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php /var/www/html/apps/integration_openai/lib/TaskProcessing/SummaryProvider.php
./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 grep '<version>' /var/www/html/apps/integration_openai/appinfo/info.xml
```
Expect the sentinel present in both files and version `4.5.1.4`.

- [ ] **Step 3: e2e — silence filter**

Re-run transcription on a silence-heavy recording (or re-schedule a real recording via the runbook recipe). Read the transcript via `taskprocessing:task:get` (PHP, TTY-safe) as in the chunking e2e; expect **no `Amara.org` / `E aí` loops**, real speech intact.

- [ ] **Step 4: e2e — structured summary**

Re-run a real meeting recording; read the summary output. Expect structured markdown (`# Resumo`, `## Tópicos discutidos`, `## Decisões`, `## Ações / próximos passos`), proportional detail (not over-compressed), and a silent recording → `Sem conteúdo de fala detectado na gravação.`

- [ ] **Step 5: Promote to prod (grupo-vidalar) when staging passes**

Build+push prod (`build-push.sh latest prod`), `./scripts/deploy-prod.sh grupo-vidalar`, verify sentinel/pin, then (optionally) re-recover tasks 11/12 under the improved quality.

- [ ] **Step 6: Update memory**

Append to `talk-ai-stt-chain`: `AVUZ-STT-QUALITY-V1` shipped (pin 4.5.1.4) — no_speech_prob silence filter + structured PT summary; e2e date.

---

## Self-Review

**Spec coverage:**
- §A no_speech_prob primary / compression_ratio secondary / missing-metric keep / duration-before-filter / fallbacks → Task 1 ✓
- §B structured PT prompt + kill recursion + max(2000) + single-vs-map-reduce → Task 2 ✓
- §C empty guard → Task 2 Step 1 ✓
- Pin 4.5.1.4 + submodule → Task 3 ✓
- Build/deploy/e2e (staging→prod) → Task 4 ✓
- No spreed overlay (B1) → honored (fork-only) ✓

**Placeholder scan:** none — full code in every code step; e2e steps name concrete commands. The only judgment left to execution is the staging stack/tag name (Task 4 Step 1-2), flagged explicitly.

**Type consistency:** `filterHallucinatedSegments(array): string`, `transcribe()` returns string, `process(): array{output:string}`, `createChatCompletion(...): array{messages:string[]}` with `end()` — consistent across tasks and with the current code. Sentinel `AVUZ-STT-QUALITY-V1` uniform.
