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
	interface ISimpleFolder {
		public function fileExists(string $name): bool;
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

	final class FakeFolder implements Files\SimpleFS\ISimpleFolder {
		public function __construct(private string $path) {
		}
		public function fileExists(string $name): bool {
			return is_file("$this->path/$name");
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
			file_put_contents(getenv('FAKE_STATE'), json_encode($state));
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
    add_library_icon globe
    add_library_icon mail
}
add_library_icon() {
    printf '<svg>%s</svg>' "$1" > "$LIBRARY/$1.svg"
    printf '<svg>%s dark</svg>' "$1" > "$LIBRARY/$1-dark.svg"
}
run() {
    if output="$(php "${1:-$SCRIPT}" 2>&1)"; then rc=0; else rc=$?; fi
}
icon_files() { (cd "$ICONS" && ls | tr '\n' ' '); }
seeded_record() { php -r 'echo json_decode(file_get_contents(getenv("FAKE_STATE")), true)["config"]["avuz_theme/external_icons_seeded"] ?? "";'; }

# ── first boot ──
reset_instance
run
assert_eq "seeds every library pair into an empty icon store" "seeded 2" "$output"
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
assert_eq "skips a pair whose light file the admin already uploaded" "seeded 1" "$output"
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
assert_eq "seeds only icons added to the library since the last boot" "seeded 1" "$output"
assert_eq "records the new name after the earlier ones" '["globe","mail","truck"]' "$(seeded_record)"

# ── library hygiene ──
reset_instance
printf '<svg>lonely</svg>' > "$LIBRARY/lonely.svg"
run
assert_eq "ignores a library icon without a dark variant" "globe-dark.svg globe.svg mail-dark.svg mail.svg " "$(icon_files)"

# ── icon store state ──
reset_instance
rm -rf "$ICONS"
run
assert_eq "creates the icons folder when the app never made it" "seeded 2" "$output"

reset_instance false
run
assert_eq "skips while External sites is disabled" "skipped: external app disabled" "$output"
assert_eq "writes nothing while External sites is disabled" "" "$(icon_files)"
assert_eq "records nothing while External sites is disabled" "" "$(seeded_record)"

reset_instance
printf '{"enabled":true,"config":{},"throw":true}' > "$FAKE_STATE"
run
assert_eq "reports only the exception class on a storage failure" "failed: RuntimeException" "$output"
assert_eq "exits non-zero on a storage failure" "1" "$rc"
assert_eq "records nothing after a storage failure, so the next boot retries" "" "$(seeded_record)"

# ── shipped library ──
reset_instance
run "$SHIPPED_SCRIPT"
assert_eq "seeds all 34 shipped Lucide icons" "seeded 34" "$output"
assert_eq "ships a dark variant for every icon" "34" "$(cd "$ICONS" && ls ./*-dark.svg | wc -l | tr -d ' ')"
assert_eq "ships only SVG pairs" "68" "$(cd "$ICONS" && ls | wc -l | tr -d ' ')"

rm -rf "$WORK_DIR"
exit "$fail"
