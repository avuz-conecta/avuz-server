#!/bin/bash
# Runs docker/seed-external-icons.php against fakes: the External sites icon
# store is a temp directory, app config and the app-enabled flag live in a JSON
# file. A temp copy of the script points its bootstrap at a fake base.php and
# its library at a temp library, so no Nextcloud is needed. Skips when no local
# php CLI exists.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SHIPPED_LIBRARY="$HERE/../../apps/avuz_theme/img/external-icons"

if ! command -v php >/dev/null 2>&1; then
    echo "ok - # SKIP no php CLI"
    exit 0
fi

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

WORK_DIR="$(mktemp -d)"
FAKE_BASE="$WORK_DIR/base.php"
LIBRARY="$WORK_DIR/library"
SCRIPT="$WORK_DIR/seed-external-icons.php"
SHIPPED_SCRIPT="$WORK_DIR/seed-shipped-library.php"
export FAKE_STATE="$WORK_DIR/state.json"
export FAKE_APPDATA="$WORK_DIR/appdata"
sed -e "s#/var/www/html/lib/base.php#$FAKE_BASE#" \
    -e "s#/var/www/html/apps/avuz_theme/img/external-icons#$LIBRARY#" \
    "$HERE/../seed-external-icons.php" > "$SCRIPT"
sed -e "s#/var/www/html/lib/base.php#$FAKE_BASE#" \
    -e "s#/var/www/html/apps/avuz_theme/img/external-icons#$SHIPPED_LIBRARY#" \
    "$HERE/../seed-external-icons.php" > "$SHIPPED_SCRIPT"

# State: {"enabled": bool, "config": {"app/key": "value"}, "throw": bool}
cat > "$FAKE_BASE" <<'PHP'
<?php
namespace OCP\Files {
	class NotFoundException extends \Exception {
	}
}

namespace OCP\Files\SimpleFS {
	interface ISimpleFile {
		public function getContent(): string;
		public function putContent($data): void;
	}

	interface ISimpleFolder {
		public function fileExists(string $name): bool;
		public function getFile(string $name): ISimpleFile;
		public function newFile(string $name, $content = null);
	}
}

namespace OCP\Files\AppData {
	interface IAppDataFactory {
		public function get(string $appId);
	}
}

namespace OCP\App {
	interface IAppManager {
		public function isEnabledForAnyone(string $appId): bool;
	}
}

namespace OCP {
	interface IAppConfig {
		public function getValueString(string $app, string $key, string $default = '', bool $lazy = false): string;
		public function setValueString(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool;
	}

	function fakeState(): array {
		return json_decode(file_get_contents(getenv('FAKE_STATE')), true);
	}

	function saveFakeState(array $state): void {
		file_put_contents(getenv('FAKE_STATE'), json_encode($state));
	}

	final class FakeFile implements Files\SimpleFS\ISimpleFile {
		public function __construct(private string $path) {
		}
		public function getContent(): string {
			$state = fakeState();
			$state['reads'] = ($state['reads'] ?? 0) + 1;
			saveFakeState($state);
			return file_get_contents($this->path);
		}
		public function putContent($data): void {
			if (fakeState()['throw']) {
				throw new \RuntimeException("storage down while writing $this->path");
			}
			file_put_contents($this->path, $data);
		}
	}

	final class FakeFolder implements Files\SimpleFS\ISimpleFolder {
		public function __construct(private string $path) {
		}
		public function fileExists(string $name): bool {
			return is_file("$this->path/$name");
		}
		public function getFile(string $name): Files\SimpleFS\ISimpleFile {
			if (!is_file("$this->path/$name")) {
				throw new Files\NotFoundException();
			}
			return new FakeFile("$this->path/$name");
		}
		public function newFile(string $name, $content = null) {
			if (fakeState()['throw']) {
				throw new \RuntimeException("storage down while writing $name");
			}
			file_put_contents("$this->path/$name", $content);
		}
	}

	final class FakeAppData {
		public function __construct(private string $root) {
		}
		public function getFolder(string $name): FakeFolder {
			if (!is_dir("$this->root/$name")) {
				throw new Files\NotFoundException();
			}
			return new FakeFolder("$this->root/$name");
		}
		public function newFolder(string $name): FakeFolder {
			mkdir("$this->root/$name", 0777, true);
			return new FakeFolder("$this->root/$name");
		}
	}

	final class FakeAppDataFactory implements Files\AppData\IAppDataFactory {
		public function get(string $appId) {
			return new FakeAppData(getenv('FAKE_APPDATA') . "/$appId");
		}
	}

	final class FakeAppManager implements App\IAppManager {
		public function isEnabledForAnyone(string $appId): bool {
			return fakeState()['enabled'];
		}
	}

	final class FakeAppConfig implements IAppConfig {
		public function getValueString(string $app, string $key, string $default = '', bool $lazy = false): string {
			return fakeState()['config']["$app/$key"] ?? $default;
		}
		public function setValueString(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
			$state = fakeState();
			$state['config']["$app/$key"] = $value;
			saveFakeState($state);
			return true;
		}
	}

	final class Server {
		public static function get(string $class): object {
			return match ($class) {
				App\IAppManager::class => new FakeAppManager(),
				Files\AppData\IAppDataFactory::class => new FakeAppDataFactory(),
				IAppConfig::class => new FakeAppConfig(),
			};
		}
	}
}
PHP

ICONS="$FAKE_APPDATA/external/icons"
reset_instance() {
    local enabled="${1:-true}"
    rm -rf "$FAKE_APPDATA" "$LIBRARY"
    mkdir -p "$ICONS" "$LIBRARY"
    printf '{"enabled":%s,"config":{},"throw":false}' "$enabled" > "$FAKE_STATE"
    printf '{}' > "$LIBRARY/superseded.json"
    add_library_icon globe
    add_library_icon mail
}
# supersede <file> <old content>: lists the old content's hash for that file,
# as the generator does when it replaces a library file.
supersede() {
    php -r '$path = $argv[1]; $list = json_decode(file_get_contents($path), true);
        $list[$argv[2]][] = hash("sha256", $argv[3]); file_put_contents($path, json_encode($list));' \
        "$LIBRARY/superseded.json" "$1" "$2"
}
# An instance seeded by an earlier image: the store holds that image's globe
# and mail pairs, recorded as seeded, and the library has moved on.
seed_old_library() {
    run
    for name in globe mail; do
        printf '<svg>old %s</svg>' "$name" > "$ICONS/$name.svg"
        printf '<svg>old %s dark</svg>' "$name" > "$ICONS/$name-dark.svg"
        supersede "$name.svg" "<svg>old $name</svg>"
        supersede "$name-dark.svg" "<svg>old $name dark</svg>"
    done
}
set_state() { php -r '$state = json_decode(file_get_contents(getenv("FAKE_STATE")), true); $state[$argv[1]] = json_decode($argv[2]); file_put_contents(getenv("FAKE_STATE"), json_encode($state));' "$1" "$2"; }
state_value() { php -r '$state = json_decode(file_get_contents(getenv("FAKE_STATE")), true); echo json_encode($state[$argv[1]] ?? null);' "$1"; }
add_library_icon() {
    printf '<svg>%s</svg>' "$1" > "$LIBRARY/$1.svg"
    printf '<svg>%s dark</svg>' "$1" > "$LIBRARY/$1-dark.svg"
}
run() {
    if output="$(php "${1:-$SCRIPT}" 2>&1)"; then rc=0; else rc=$?; fi
}
icon_files() { (cd "$ICONS" && ls | tr '\n' ' '); }
seeded_record() { php -r 'echo json_decode(file_get_contents(getenv("FAKE_STATE")), true)["config"]["avuz_theme/external_icons_seeded"] ?? "";'; }
library_record() { php -r 'echo json_decode(file_get_contents(getenv("FAKE_STATE")), true)["config"]["avuz_theme/external_icons_library"] ?? "";'; }

# ── first boot ──
reset_instance
run
assert_eq "seeds every library pair into an empty icon store" "seeded 2, upgraded 0, kept 0" "$output"
assert_eq "exits 0 after seeding" "0" "$rc"
assert_eq "writes the light and the dark file of each icon" "globe-dark.svg globe.svg mail-dark.svg mail.svg " "$(icon_files)"
assert_eq "copies the library file content unchanged" "<svg>globe dark</svg>" "$(cat "$ICONS/globe-dark.svg")"
assert_eq "records the seeded names" '["globe","mail"]' "$(seeded_record)"

# ── every later boot ──
run
assert_eq "reports nothing to do on the next boot" "unchanged" "$output"
assert_eq "leaves the icon store as it was" "globe-dark.svg globe.svg mail-dark.svg mail.svg " "$(icon_files)"

# ── admin uploads ──
reset_instance
printf 'admin globe' > "$ICONS/globe.svg"
run
assert_eq "skips a pair whose light file the admin already uploaded" "seeded 1, upgraded 0, kept 1" "$output"
assert_eq "never overwrites the admin's icon" "admin globe" "$(cat "$ICONS/globe.svg")"
assert_eq "does not add a dark variant to the admin's icon" "globe.svg mail-dark.svg mail.svg " "$(icon_files)"

reset_instance
printf 'admin globe dark' > "$ICONS/globe-dark.svg"
run
assert_eq "skips a pair whose dark file the admin already uploaded" "globe-dark.svg mail-dark.svg mail.svg " "$(icon_files)"
assert_eq "keeps the admin's dark icon" "admin globe dark" "$(cat "$ICONS/globe-dark.svg")"

# ── admin deletions ──
reset_instance
run
rm "$ICONS/mail.svg" "$ICONS/mail-dark.svg"
run
assert_eq "does not bring back an icon the admin deleted" "unchanged" "$output"
assert_eq "keeps the deleted icon gone" "globe-dark.svg globe.svg " "$(icon_files)"

# ── a later image grows the library ──
reset_instance
run
add_library_icon truck
run
assert_eq "seeds only icons added to the library since the last boot" "seeded 1, upgraded 0, kept 0" "$output"
assert_eq "records the new name after the earlier ones" '["globe","mail","truck"]' "$(seeded_record)"

# ── library hygiene ──
reset_instance
printf '<svg>lonely</svg>' > "$LIBRARY/lonely.svg"
run
assert_eq "ignores a library icon without a dark variant" "globe-dark.svg globe.svg mail-dark.svg mail.svg " "$(icon_files)"

# ── fresh install ──
reset_instance
run
assert_eq "records the shipped superseded list after the first boot" "$(shasum -a 256 < "$LIBRARY/superseded.json" | cut -d' ' -f1)" "$(library_record)"

# ── upgrade from an earlier library ──
reset_instance
seed_old_library
run
assert_eq "upgrades every pair still holding an earlier library version" "seeded 0, upgraded 2, kept 0" "$output"
assert_eq "writes the current light file" "<svg>globe</svg>" "$(cat "$ICONS/globe.svg")"
assert_eq "writes the current dark file" "<svg>globe dark</svg>" "$(cat "$ICONS/globe-dark.svg")"
assert_eq "keeps the seeded record as it was" '["globe","mail"]' "$(seeded_record)"

set_state reads 0
run
assert_eq "reports nothing to do once the store is upgraded" "unchanged" "$output"
assert_eq "reads no store file once the store is upgraded" "0" "$(state_value reads)"

reset_instance
seed_old_library
printf 'admin globe' > "$ICONS/globe.svg"
run
assert_eq "keeps a pair whose light file the admin edited" "seeded 0, upgraded 1, kept 1" "$output"
assert_eq "leaves the admin's light file" "admin globe" "$(cat "$ICONS/globe.svg")"
assert_eq "leaves the dark file next to the admin's light file" "<svg>old globe dark</svg>" "$(cat "$ICONS/globe-dark.svg")"

reset_instance
seed_old_library
printf '\x89PNG admin' > "$ICONS/globe-dark.svg"
run
assert_eq "keeps a pair whose dark file the admin replaced" "seeded 0, upgraded 1, kept 1" "$output"
assert_eq "leaves the light file next to the admin's dark file" "<svg>old globe</svg>" "$(cat "$ICONS/globe.svg")"

reset_instance
seed_old_library
rm "$ICONS/mail.svg" "$ICONS/mail-dark.svg"
run
assert_eq "does not bring back a pair the admin deleted" "globe-dark.svg globe.svg " "$(icon_files)"

reset_instance
seed_old_library
rm "$ICONS/globe.svg"
run
assert_eq "upgrades the dark file of a pair whose light file the admin deleted" "<svg>globe dark</svg>" "$(cat "$ICONS/globe-dark.svg")"
assert_eq "does not bring back the deleted light file" "globe-dark.svg mail-dark.svg mail.svg " "$(icon_files)"

reset_instance
seed_old_library
run
printf '<svg>old globe</svg>' > "$ICONS/globe.svg"
run
assert_eq "skips the upgrade while the superseded list is the one already applied" "unchanged" "$output"
supersede "truck.svg" "<svg>old truck</svg>"
run
assert_eq "runs the upgrade again when a new image changes the superseded list" "seeded 0, upgraded 1, kept 0" "$output"

reset_instance
seed_old_library
set_state throw true
run
assert_eq "reports only the exception class when the upgrade hits a storage failure" "failed: RuntimeException" "$output"
recorded_current_list() {
    [ "$(library_record)" = "$(shasum -a 256 < "$LIBRARY/superseded.json" | cut -d' ' -f1)" ] && echo yes || echo no
}
assert_eq "does not record the new superseded list after a failed upgrade" "no" "$(recorded_current_list)"
set_state throw false
run
assert_eq "finishes the upgrade on the next boot" "seeded 0, upgraded 2, kept 0" "$output"

# ── broken superseded list ──
reset_instance
rm "$LIBRARY/superseded.json"
run
assert_eq "fails without a superseded list" "failed: invalid superseded.json" "$output"
assert_eq "exits non-zero without a superseded list" "1" "$rc"
assert_eq "writes nothing without a superseded list" "" "$(icon_files)"
assert_eq "records nothing without a superseded list" "" "$(seeded_record)"

reset_instance
printf '{' > "$LIBRARY/superseded.json"
run
assert_eq "fails on a superseded list that is not JSON" "failed: invalid superseded.json" "$output"

reset_instance
printf '{"globe.svg":"abc"}' > "$LIBRARY/superseded.json"
run
assert_eq "fails on a superseded entry that is not a list" "failed: invalid superseded.json" "$output"

# ── icon store state ──
reset_instance
rm -rf "$ICONS"
run
assert_eq "creates the icons folder when the app never made it" "seeded 2, upgraded 0, kept 0" "$output"

reset_instance false
run
assert_eq "skips while External sites is disabled" "skipped: external app disabled" "$output"
assert_eq "writes nothing while External sites is disabled" "" "$(icon_files)"
assert_eq "records nothing while External sites is disabled" "" "$(seeded_record)"

reset_instance
set_state throw true
run
assert_eq "reports only the exception class on a storage failure" "failed: RuntimeException" "$output"
assert_eq "exits non-zero on a storage failure" "1" "$rc"
assert_eq "records nothing after a storage failure, so the next boot retries" "" "$(seeded_record)"

# ── shipped library ──
reset_instance
run "$SHIPPED_SCRIPT"
assert_eq "seeds all 34 shipped icons" "seeded 34, upgraded 0, kept 0" "$output"
assert_eq "ships a dark variant for every icon" "34" "$(cd "$ICONS" && ls ./*-dark.svg | wc -l | tr -d ' ')"
assert_eq "ships only SVG pairs" "68" "$(cd "$ICONS" && ls | wc -l | tr -d ' ')"
assert_eq "lists an earlier version for every shipped file" "68" "$(php -r 'echo count(json_decode(file_get_contents($argv[1]), true));' "$SHIPPED_LIBRARY/superseded.json")"
assert_eq "never lists a shipped file's current version as superseded" "" "$(php -r '
    $library = $argv[1];
    foreach (json_decode(file_get_contents("$library/superseded.json"), true) as $file => $hashes) {
        if (in_array(hash_file("sha256", "$library/$file"), $hashes, true)) { echo "$file "; }
    }' "$SHIPPED_LIBRARY")"

rm -rf "$WORK_DIR"
exit "$fail"
