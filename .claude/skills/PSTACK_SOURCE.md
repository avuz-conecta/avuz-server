# pstack skills: source and local edits

- Upstream repo: https://github.com/cursor/plugins (path `pstack/skills/`)
- Commit: `1e5c90a4b6f249917bd21fe361b3a2a7deb741b8`
- Commit date: 2026-10-14T00:04:30-07:00
- License: `PSTACK_LICENSE` (unchanged)

These skills were copied verbatim, then adapted for Claude Code with a single agent. Claude Code loads them from `.claude/skills/<name>/SKILL.md`.

## Vendored skills

- architect
- blast-radius
- principle-fix-root-causes
- principle-prove-it-works
- principle-test-behavior-not-implementation
- tdd
- typescript-best-practices

## Dropped skills

None. Only architect and blast-radius used multi-agent or multi-model mechanics. In both, those mechanics are a means to an end, not the skill's purpose, so both were rewritten for a single agent.

## Edits per skill

No vendored file contained a `.cursor/` path. All frontmatter (`name`, `description`, `disable-model-invocation`, `paths`) is unchanged.

Upstream skills cross-reference pstack skills that were not vendored. These include `how`, `why`, `arena`, `interrogate`, `unslop`, `show-me-your-work`, and principle skills such as `boundary-discipline` and `type-system-discipline`. Each reference was replaced with a one-line statement of its intent, or with a vendored skill when one covers it.

### architect

- `SKILL.md`:
  - Phase B used to run the `arena` skill, with parallel runners on several models taken from the `pstack-models.mdc` rule. The agent now sketches at least two structurally distinct candidates itself, one after another, deliberately pushes them apart, and then synthesizes them.
  - Removed the runner/model-selection paragraph (`architect runners`, `pstack-models.mdc`, fallback model IDs).
  - Phase A replaces the `how`/`why` skills with reading the subsystems and digging through history (`git log`/`git blame`, PRs).
  - Phase C replaces the `interrogate` skill with self-run adversarial checks against the sketch.
  - Phase E points to `principle-fix-root-causes` instead of the non-vendored principle skills, and says "re-ground" instead of "re-run how".
  - Removed references to the non-vendored principle skills: exhaust-the-design-space, foundational-thinking, outcome-oriented-execution, redesign-from-first-principles, and subtract-before-you-add.
- `references/runner-prompt.md` was renamed to `references/candidate-prompt.md`:
  - Rewritten as a brief the single agent follows for each candidate. Removed the orchestrator, parallel runners, worktree-per-runner setup, and the "different model" framing.
  - Kept the design discipline bullets. The non-vendored principle-skill citations are now inline wording.
- `references/rationale-template.md`:
  - "Synthesis decision" is now filled at the end of Phase B, not by `arena`.
  - "runner candidates" became "Phase B candidates".
  - Fixed an upstream slip: the sign-off checkpoint is Phase C, not Phase D.
- `references/design-red-flags.md`: unchanged.

### blast-radius

- Replaced the `how`/`why` companion framing with plain wording.
- "Use `why` step 2" became "pull PR/commits via `git log -L`, `git blame`, `gh pr view`".
- Step 6 asked several models via `arena`. It now makes a second independent pass from a different angle and merges the results.
- "Write it through `unslop`" became "write it plain and concise".

### principle-prove-it-works

- Removed the reference to the non-vendored `show-me-your-work` skill. The guidance itself is unchanged.

### typescript-best-practices

- `SKILL.md`: replaced "Apply the type-system-discipline principle skill" with a one-line statement of it. Removed the `boundary-discipline` pointer.
- `references/patterns.md`: removed the pointers to the `type-system-discipline` and `boundary-discipline` principle skills.

### principle-fix-root-causes, principle-test-behavior-not-implementation, tdd

- Unchanged. They had no Cursor mechanics and no dangling references.
