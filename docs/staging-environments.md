# Staging Environments

Three long-lived staging branches, each wired to a Portainer stack and an image
tag. Engineers test finished-but-unreleased work on whichever environment is
free; only completed work merges to `avuz-customization` (prod).

## Branch → stack → tag

| Branch                         | Portainer stack   | Image tag                                      | URL                   |
| ------------------------------ | ----------------- | ---------------------------------------------- | --------------------- |
| `avuz-customization-staging-1` | `avuz-conecta`    | `registry.avuz.app/admin/avuzconecta:staging-1` | conectahml.avuz.app   |
| `avuz-customization-staging-2` | `avuz-conecta-2`  | `registry.avuz.app/admin/avuzconecta:staging-2` |                       |
| `avuz-customization-staging-3` | `avuz-conecta-s3` | `registry.avuz.app/admin/avuzconecta:staging-3` |                       |

`s3` in the `avuz-conecta-s3` stack name carries no special meaning — any image
runs on any stack. The three environments are interchangeable; pick an idle one.

## Workflow

1. Code in a feature worktree branched off `avuz-customization`.
2. Merge your feature branch into the staging branch for the environment you want
   to test (e.g. `avuz-customization-staging-2`).
3. Build and push that environment's image (see below).
4. Deploy the stack to pull the new tag.
5. When the work is finished, merge the feature branch into `avuz-customization`
   (prod). Staging branches never flow into prod — only the feature branch does.

## Reset after every prod release

After each release to `avuz-customization`, every staging branch is reset or
rebased onto `avuz-customization`. This keeps staging a clean descendant of prod
and drops abandoned or already-shipped experiments. Treat staging branches as
disposable integration lines, not sources of truth.

## Build command

```bash
./scripts/build-push.sh latest staging <N>   # pushes :staging-<N>
```

`<N>` is the environment number (1, 2, or 3), producing `:staging-1` etc.

## Submodule init before building from a worktree

`scripts/build-push.sh` detects a linked worktree and, for any app the worktree
is missing or whose submodule is unpopulated, copies that app from the PRIMARY
checkout (`~/work/avuz/avuz-server`). It copies the primary checkout's on-disk
version — **not** the version your branch pins. If a submodule (Assinaturas,
Deck, integration_openai, 3rdparty, …) is uninitialized in the worktree, you ship
the primary checkout's copy instead of your branch's pin.

Before building a staging image from a worktree, run:

```bash
git submodule update --init
```

in that worktree. The pinned apps get checked out at the branch's revision and
the copy-from-primary step skips them.
