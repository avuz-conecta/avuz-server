#!/usr/bin/env bash
#
# deploy-deck.sh — ship the Avuz Deck fork with a GUARANTEED version bump.
#
# Why this exists:
#   Nextcloud appends one global "?v=<hash>" to every asset URL. The hash is a
#   digest of all installed app versions. Assets are served "immutable" for six
#   months, so the ONLY thing that makes a browser (or Cloudflare) refetch is a
#   changed URL. Bump any app version -> the hash moves -> every client pulls
#   fresh JS/CSS on the next reload, with NO cache clear.
#   Every stale-cache incident so far was a deploy that forgot the bump. This
#   script makes the bump impossible to skip.
#
# Usage:
#   scripts/deploy-deck.sh "fix(folders): commit subject line"   # PREP (default)
#   scripts/deploy-deck.sh --prod                                # PROD build + app3 redeploy
#
# PREP does: auto-increment the patch version, rebuild js, run the js tests,
#   commit + push the deck fork, bump the submodule, commit the avuz-server repo.
# PROD does: build+push the prod image (:latest-internal) and redeploy Portainer
#   stack 14 (avuz-app3), then verify health + the running deck version.
# The two are split so the production step stays an explicit, separate action.
#
# Env overrides:
#   DECK_FORK   path to the deck build workspace (default: ~/work/avuz/deck-fork)
#   PROD_ENV    path to Portainer prod creds (default: main-repo scripts/deploy.prod.env)
#   IMAGE_SUFFIX  image tag suffix for the prod build (default: internal -> :latest-internal)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUBMODULE="$SERVER_ROOT/apps/deck"
DECK_FORK="${DECK_FORK:-$HOME/work/avuz/deck-fork}"
PROD_ENV="${PROD_ENV:-$HOME/work/avuz/avuz-server/scripts/deploy.prod.env}"
IMAGE_SUFFIX="${IMAGE_SUFFIX:-internal}"
STACK_ID=14
ENDPOINT_ID=6
CONTAINER=avuz-app3

info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

read_version() {
	grep -oE '<version>[0-9]+\.[0-9]+\.[0-9]+</version>' "$DECK_FORK/appinfo/info.xml" \
		| grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

prep() {
	local subject="${1:-}"
	[ -n "$subject" ] || die "prep needs a commit subject: deploy-deck.sh \"fix(...): ...\""
	[ -d "$DECK_FORK/.git" ] || die "deck fork not found at $DECK_FORK (set DECK_FORK)"

	cd "$DECK_FORK"

	local cur new major minor patch
	cur="$(read_version)"
	[ -n "$cur" ] || die "could not read <version> from appinfo/info.xml"
	IFS=. read -r major minor patch <<<"$cur"
	new="$major.$minor.$((patch + 1))"
	info "deck version $cur -> $new"
	sed -i '' "s|<version>$cur</version>|<version>$new</version>|" appinfo/info.xml

	info "building js (webpack production)"
	npm run build

	info "running js tests (jest)"
	./node_modules/.bin/jest
	# NOTE: backend phpunit needs a full Nextcloud checkout to bootstrap and is not
	# runnable here; php -l is the local gate. Backend tests run in CI / the container.
	info "php lint (backend)"
	find lib -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null

	info "commit + push deck fork"
	git add -A
	git commit -m "$subject"$'\n\n'"Bump $new (moves NC global asset ?v= hash so clients refetch without a cache clear)."
	git push avuz avuz
	local sha
	sha="$(git rev-parse HEAD)"

	info "bump submodule -> $sha and commit avuz-server"
	cd "$SUBMODULE"
	git fetch origin --quiet
	git checkout --quiet "$sha"
	cd "$SERVER_ROOT"
	git add apps/deck
	git commit -m "chore(deck): bump submodule -> v$new"

	info "PREP done. deck v$new committed. Next: scripts/deploy-deck.sh --prod"
}

# --- Portainer helpers (prod) ---
api() { curl -fsS ${PORTAINER_INSECURE:+-k} -H "X-API-Key: $PORTAINER_TOKEN" "$@"; }

prod() {
	local ver
	ver="$(read_version)"
	info "building + pushing prod image :latest-$IMAGE_SUFFIX (deck v$ver)"
	docker builder prune -f >/dev/null 2>&1 || true
	docker image prune -f >/dev/null 2>&1 || true
	"$SERVER_ROOT/scripts/build-push.sh" latest prod "$IMAGE_SUFFIX"

	[ -f "$PROD_ENV" ] || die "prod Portainer creds not found at $PROD_ENV (set PROD_ENV)"
	set -a; . "$PROD_ENV"; set +a
	local PU="${PORTAINER_URL%/}"
	local tmp; tmp="$(mktemp -d)"

	info "redeploy Portainer stack $STACK_ID ($CONTAINER) with re-pull"
	api "$PU/api/stacks/$STACK_ID/file" | jq -r '.StackFileContent' >"$tmp/content.yml"
	api "$PU/api/stacks/$STACK_ID" | jq '.Env' >"$tmp/env.json"
	jq -n --rawfile c "$tmp/content.yml" --slurpfile e "$tmp/env.json" \
		'{StackFileContent:$c, Env:$e[0], Prune:false, PullImage:true}' >"$tmp/payload.json"
	api -X PUT "$PU/api/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" \
		-H "Content-Type: application/json" --data-binary "@$tmp/payload.json" >/dev/null
	rm -rf "$tmp"

	info "waiting for $CONTAINER to report healthy"
	local filt='%7B%22name%22%3A%5B%22'"$CONTAINER"'%22%5D%7D'
	local i state
	for i in $(seq 1 40); do
		# The compact list endpoint avoids the control-chars in a full inspect's
		# health-log that break jq.
		state="$(api "$PU/api/endpoints/$ENDPOINT_ID/docker/containers/json?all=1&filters=$filt" \
			| jq -r '.[0].Status')"
		printf '  poll %2d: %s\n' "$i" "$state"
		case "$state" in
			*"(healthy)"*) info "healthy"; break ;;
		esac
		sleep 15
	done

	info "deployed deck version on $CONTAINER:"
	"$SERVER_ROOT/scripts/portainer-exec-prod.sh" -u www-data "$CONTAINER" php occ app:list 2>/dev/null \
		| grep -iE 'deck:' || true
}

case "${1:-}" in
	--prod) prod ;;
	--help|-h|"") printf 'usage:\n  %s "commit subject"   # PREP\n  %s --prod            # build + deploy app3\n' "$0" "$0" ;;
	*) prep "$1" ;;
esac
