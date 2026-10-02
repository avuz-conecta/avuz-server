#!/bin/bash
# Runs docker/set-app-config-from-env.php against an in-memory IAppConfig fake.
# A temp copy of the script points its bootstrap at a fake base.php, so no
# Nextcloud is needed. Skips when no local php CLI exists.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

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
assert_lacks() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s\n' "$haystack" | grep -qF -- "$needle"; then
        echo "NOT OK - $desc"; echo "  unexpected: [$needle]"; fail=1; else echo "ok - $desc"; fi
}

WORK_DIR="$(mktemp -d)"
FAKE_BASE="$WORK_DIR/base.php"
SCRIPT="$WORK_DIR/set-app-config-from-env.php"
export FAKE_STATE="$WORK_DIR/state.json"
sed "s#/var/www/html/lib/base.php#$FAKE_BASE#" "$HERE/../set-app-config-from-env.php" > "$SCRIPT"

# State: {"values": {"app/key": {"value": "...", "sensitive": bool}}, "writes": ["..."], "throw": bool}
cat > "$FAKE_BASE" <<'PHP'
<?php
namespace OCP;

interface IAppConfig {
	public function hasKey(string $app, string $key, ?bool $lazy = false): bool;
	public function isSensitive(string $app, string $key, ?bool $lazy = false): bool;
	public function getValueString(string $app, string $key, string $default = '', bool $lazy = false): string;
	public function setValueString(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool;
	public function deleteKey(string $app, string $key): void;
}

final class FakeAppConfig implements IAppConfig {
	private array $state;
	public function __construct(private string $path) {
		$this->state = json_decode(file_get_contents($path), true);
	}
	private function save(): void {
		file_put_contents($this->path, json_encode($this->state));
	}
	public function hasKey(string $app, string $key, ?bool $lazy = false): bool {
		return isset($this->state['values']["$app/$key"]);
	}
	public function isSensitive(string $app, string $key, ?bool $lazy = false): bool {
		return $this->state['values']["$app/$key"]['sensitive'];
	}
	public function getValueString(string $app, string $key, string $default = '', bool $lazy = false): string {
		return $this->state['values']["$app/$key"]['value'] ?? $default;
	}
	public function setValueString(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
		if ($this->state['throw']) {
			throw new \RuntimeException("db down while writing $value");
		}
		$this->state['values']["$app/$key"] = ['value' => $value, 'sensitive' => $sensitive];
		$this->state['writes'][] = 'set ' . $key . ($sensitive ? ' sensitive' : ' plain');
		$this->save();
		return true;
	}
	public function deleteKey(string $app, string $key): void {
		unset($this->state['values']["$app/$key"]);
		$this->state['writes'][] = "delete $key";
		$this->save();
	}
}

final class Server {
	public static function get(string $class): IAppConfig {
		return new FakeAppConfig(getenv('FAKE_STATE'));
	}
}
PHP

SECRET="s3cr3t-token-value"
seed() { printf '%s' "$1" > "$FAKE_STATE"; }
run() {
    if output="$(php "$SCRIPT" "$@" 2>&1)"; then rc=0; else rc=$?; fi
}
writes() { php -r 'echo implode("\n", json_decode(file_get_contents(getenv("FAKE_STATE")), true)["writes"]);'; }
stored() { php -r '$v = json_decode(file_get_contents(getenv("FAKE_STATE")), true)["values"]["assinaturas/api_token"]; echo ($v["sensitive"] ? "sensitive" : "plain") . " " . $v["value"];'; }

export ZAPSIGN_API_TOKEN="$SECRET"

seed '{"values":{},"writes":[],"throw":false}'
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "sets a missing key" "set" "$output"
assert_eq "exits 0 after a write" "0" "$rc"
assert_eq "stores the env value as sensitive" "sensitive $SECRET" "$(stored)"

seed "{\"values\":{\"assinaturas/api_token\":{\"value\":\"$SECRET\",\"sensitive\":true}},\"writes\":[],\"throw\":false}"
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "reports an unchanged key" "unchanged" "$output"
assert_eq "writes nothing when value and sensitivity match" "" "$(writes)"

seed "{\"values\":{\"assinaturas/api_token\":{\"value\":\"old\",\"sensitive\":true}},\"writes\":[],\"throw\":false}"
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "sets a sensitive key in place on a new value" "set api_token sensitive" "$(writes)"

seed "{\"values\":{\"assinaturas/api_token\":{\"value\":\"$SECRET\",\"sensitive\":false}},\"writes\":[],\"throw\":false}"
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "deletes a plaintext key before making it sensitive" "delete api_token
set api_token sensitive" "$(writes)"

seed "{\"values\":{\"assinaturas/api_token\":{\"value\":\"$SECRET\",\"sensitive\":true}},\"writes\":[],\"throw\":false}"
run assinaturas api_token ZAPSIGN_API_TOKEN
assert_eq "deletes a sensitive key before making it plain" "delete api_token
set api_token plain" "$(writes)"

seed '{"values":{},"writes":[],"throw":false}'
run assinaturas api_token ZAPSIGN_MISSING_VARIABLE --sensitive
assert_eq "fails on an unset env variable" "failed: ZAPSIGN_MISSING_VARIABLE is not set" "$output"
assert_eq "exits non-zero on an unset env variable" "1" "$rc"

run assinaturas api_token
assert_eq "fails on missing arguments" "1" "$rc"

seed '{"values":{},"writes":[],"throw":true}'
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "reports only the exception class" "failed: RuntimeException" "$output"
assert_eq "exits non-zero on an exception" "1" "$rc"
assert_lacks "never prints the value from an exception message" "$SECRET" "$output"

rm -rf "$WORK_DIR"
exit "$fail"
