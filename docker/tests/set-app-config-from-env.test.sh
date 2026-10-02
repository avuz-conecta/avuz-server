#!/bin/bash
# Runs docker/set-app-config-from-env.php against in-memory IAppConfig and
# IConfig fakes. A temp copy of the script points its bootstrap at a fake
# base.php, so no Nextcloud is needed. Skips when no local php CLI exists.
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

# State: {"values": {"app/key": {"value": "...", "sensitive": bool, "type": "string|mixed|int", "lazy": bool}},
#         "system": {"key": value}, "writes": ["..."], "throw": bool}
# IAppConfig and IConfig are declared here only: the script must not touch
# them before its bootstrap, as in a real container.
cat > "$FAKE_BASE" <<'PHP'
<?php
namespace OCP;

interface IAppConfig {
	public const VALUE_SENSITIVE = 1;
	public const VALUE_MIXED = 2;
	public const VALUE_STRING = 4;
	public const VALUE_INT = 8;
	public function hasKey(string $app, string $key, ?bool $lazy = false): bool;
	public function isSensitive(string $app, string $key, ?bool $lazy = false): bool;
	public function isLazy(string $app, string $key): bool;
	public function getValueType(string $app, string $key, ?bool $lazy = null): int;
	public function getValueString(string $app, string $key, string $default = '', bool $lazy = false): string;
	public function setValueString(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool;
	public function setValueMixed(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool;
	public function deleteKey(string $app, string $key): void;
}

interface IConfig {
	public function getSystemValue(string $key, mixed $default = ''): mixed;
	public function setSystemValue(string $key, mixed $value): void;
}

final class FakeState {
	public array $state;
	public function __construct(private string $path) {
		$this->state = json_decode(file_get_contents($path), true);
	}
	public function record(string $write): void {
		if ($this->state['throw']) {
			throw new \RuntimeException("db down while writing $write");
		}
		$this->state['writes'][] = $write;
		file_put_contents($this->path, json_encode($this->state));
	}
}

final class FakeAppConfig implements IAppConfig {
	private const TYPES = ['mixed' => self::VALUE_MIXED, 'string' => self::VALUE_STRING, 'int' => self::VALUE_INT];
	public function __construct(private FakeState $store) {
	}
	private function entry(string $app, string $key): array {
		return $this->store->state['values']["$app/$key"];
	}
	public function hasKey(string $app, string $key, ?bool $lazy = false): bool {
		return isset($this->store->state['values']["$app/$key"]);
	}
	public function isSensitive(string $app, string $key, ?bool $lazy = false): bool {
		return $this->entry($app, $key)['sensitive'];
	}
	public function isLazy(string $app, string $key): bool {
		return $this->entry($app, $key)['lazy'];
	}
	public function getValueType(string $app, string $key, ?bool $lazy = null): int {
		return self::TYPES[$this->entry($app, $key)['type']];
	}
	public function getValueString(string $app, string $key, string $default = '', bool $lazy = false): string {
		return $this->store->state['values']["$app/$key"]['value'] ?? $default;
	}
	private function set(string $type, string $app, string $key, string $value, bool $lazy, bool $sensitive): bool {
		$this->store->state['values']["$app/$key"] = ['value' => $value, 'sensitive' => $sensitive, 'type' => $type, 'lazy' => $lazy];
		$this->store->record("set $key $type" . ($sensitive ? ' sensitive' : ' plain') . ($lazy ? ' lazy' : ''));
		return true;
	}
	public function setValueString(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
		return $this->set('string', $app, $key, $value, $lazy, $sensitive);
	}
	public function setValueMixed(string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
		return $this->set('mixed', $app, $key, $value, $lazy, $sensitive);
	}
	public function deleteKey(string $app, string $key): void {
		unset($this->store->state['values']["$app/$key"]);
		$this->store->record("delete $key");
	}
}

final class FakeConfig implements IConfig {
	public function __construct(private FakeState $store) {
	}
	public function getSystemValue(string $key, mixed $default = ''): mixed {
		return $this->store->state['system'][$key] ?? $default;
	}
	public function setSystemValue(string $key, mixed $value): void {
		$this->store->state['system'][$key] = $value;
		$this->store->record("system $key");
	}
}

final class Server {
	public static function get(string $class): object {
		$store = new FakeState(getenv('FAKE_STATE'));
		return $class === IConfig::class ? new FakeConfig($store) : new FakeAppConfig($store);
	}
}
PHP

SECRET="s3cr3t-token-value"
seed_key() {
    local value="$1" sensitive="$2" type="$3" lazy="$4"
    printf '{"values":{"assinaturas/api_token":{"value":"%s","sensitive":%s,"type":"%s","lazy":%s}},"system":{},"writes":[],"throw":false}' \
        "$value" "$sensitive" "$type" "$lazy" > "$FAKE_STATE"
}
seed_empty() { printf '{"values":{},"system":{},"writes":[],"throw":false}' > "$FAKE_STATE"; }
run() {
    if output="$(php "$SCRIPT" "$@" 2>&1)"; then rc=0; else rc=$?; fi
}
writes() { php -r 'echo implode("\n", json_decode(file_get_contents(getenv("FAKE_STATE")), true)["writes"]);'; }
stored() { php -r '$v = json_decode(file_get_contents(getenv("FAKE_STATE")), true)["values"]["assinaturas/api_token"]; echo ($v["sensitive"] ? "sensitive" : "plain") . " " . $v["value"];'; }
system_value() { php -r 'echo json_decode(file_get_contents(getenv("FAKE_STATE")), true)["system"][$argv[1]] ?? "";' "$1"; }

export ZAPSIGN_API_TOKEN="$SECRET"

# ── app config ──
seed_empty
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "sets a missing key" "set" "$output"
assert_eq "exits 0 after a write" "0" "$rc"
assert_eq "stores the env value as sensitive" "sensitive $SECRET" "$(stored)"
assert_eq "stores a new key as mixed and not lazy, like occ" "set api_token mixed sensitive" "$(writes)"

seed_empty
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive --type=string
assert_eq "stores a new key with the requested type" "set api_token string sensitive" "$(writes)"

seed_key "$SECRET" true mixed false
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "reports an unchanged key" "unchanged" "$output"
assert_eq "writes nothing when value, sensitivity and type match" "" "$(writes)"

seed_key old true string true
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "sets a new value in place, keeping the key's type and lazy flag" "set api_token string sensitive lazy" "$(writes)"

seed_key "$SECRET" false mixed true
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "deletes a plaintext key before making it sensitive, keeping it lazy" "delete api_token
set api_token mixed sensitive lazy" "$(writes)"

seed_key "$SECRET" true mixed false
run assinaturas api_token ZAPSIGN_API_TOKEN
assert_eq "deletes a sensitive key before making it plain" "delete api_token
set api_token mixed plain" "$(writes)"

seed_key "$SECRET" true mixed false
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive --type=string
assert_eq "deletes a key before changing its type" "delete api_token
set api_token string sensitive" "$(writes)"

seed_key 42 false int false
run assinaturas api_token ZAPSIGN_API_TOKEN
assert_eq "refuses a key holding a non-text type" "failed: assinaturas/api_token holds a non-text value type" "$output"
assert_eq "leaves a non-text key untouched" "" "$(writes)"

seed_empty
run assinaturas api_token ZAPSIGN_MISSING_VARIABLE --sensitive
assert_eq "fails on an unset env variable" "failed: ZAPSIGN_MISSING_VARIABLE is not set" "$output"
assert_eq "exits non-zero on an unset env variable" "1" "$rc"

run assinaturas api_token
assert_eq "fails on missing arguments" "1" "$rc"

run assinaturas api_token ZAPSIGN_API_TOKEN --type=int
assert_eq "fails on an unsupported type" "1" "$rc"

seed_empty
printf '{"values":{},"system":{},"writes":[],"throw":true}' > "$FAKE_STATE"
run assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
assert_eq "reports only the exception class" "failed: RuntimeException" "$output"
assert_eq "exits non-zero on an exception" "1" "$rc"
assert_lacks "never prints the value from an exception message" "$SECRET" "$output"

# ── system config ──
export SMTP_PASSWORD="$SECRET"
seed_empty
run --system mail_smtppassword SMTP_PASSWORD
assert_eq "sets a system value" "set" "$output"
assert_eq "stores the env value in system config" "$SECRET" "$(system_value mail_smtppassword)"

printf '{"values":{},"system":{"mail_smtppassword":"%s"},"writes":[],"throw":false}' "$SECRET" > "$FAKE_STATE"
run --system mail_smtppassword SMTP_PASSWORD
assert_eq "reports an unchanged system value" "unchanged" "$output"
assert_eq "writes nothing when the system value matches" "" "$(writes)"

run --system mail_smtppassword SMTP_PASSWORD --sensitive
assert_eq "refuses --sensitive on a system value" "1" "$rc"

run --system conectamail sso_secret SMTP_PASSWORD
assert_eq "refuses an app argument on a system value" "1" "$rc"

rm -rf "$WORK_DIR"
exit "$fail"
