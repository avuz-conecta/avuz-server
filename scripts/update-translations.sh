#!/bin/sh
# Fetch latest translations from GitHub and apply Avuz overrides.
#
# Usage: ./scripts/update-translations.sh [branch]
#   branch: Nextcloud stable branch (default: stable32)
#
# Overrides are stored in *.overrides.json files (never modified by this script).
# The merged output goes to pt_BR.json and pt_BR.js in the theme directories.
#
# Bundled apps (files, dashboard, settings, etc.) are merged at Docker build
# time by merge-l10n.sh and don't need this script.

set -e

BRANCH="${1:-stable32}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
THEME_DIR="$SCRIPT_DIR/../themes/avuz"

# Apps that need full translation files pre-baked.
# Format: "app_name:github_org:github_repo:theme_subdir"
#   theme_subdir: where the PHP backend expects the theme file (apps or custom_apps)
#   JS files always go to apps/ (JSResourceLocator hardcodes this path)
APPS="
deck:nextcloud:deck:custom_apps
notifications:nextcloud:notifications:apps
"

echo "Updating translations from branch: $BRANCH"

for entry in $APPS; do
    app_name=$(echo "$entry" | cut -d: -f1)
    github_org=$(echo "$entry" | cut -d: -f2)
    github_repo=$(echo "$entry" | cut -d: -f3)
    theme_subdir=$(echo "$entry" | cut -d: -f4)

    url="https://raw.githubusercontent.com/$github_org/$github_repo/$BRANCH/l10n/pt_BR.json"
    overrides_json="$THEME_DIR/$theme_subdir/$app_name/l10n/pt_BR.overrides.json"

    if [ ! -f "$overrides_json" ]; then
        echo "  Skipping $app_name (no overrides file at $overrides_json)"
        continue
    fi

    echo "  Fetching $app_name translations from $url..."
    tmp_file=$(mktemp)
    if ! curl -sfL "$url" -o "$tmp_file"; then
        echo "  ERROR: Failed to fetch $app_name translations. Check branch '$BRANCH'."
        rm -f "$tmp_file"
        continue
    fi

    echo "  Merging $app_name..."
    python3 -c "
import json, os

with open('$tmp_file', 'r') as f:
    full = json.load(f)

with open('$overrides_json', 'r') as f:
    overrides = json.load(f)

override_keys = overrides.get('translations', {})
full['translations'].update(override_keys)

# Write merged JSON to theme_subdir path (PHP backend)
out_json = '$THEME_DIR/$theme_subdir/$app_name/l10n/pt_BR.json'
with open(out_json, 'w') as f:
    json.dump(full, f, indent=4, ensure_ascii=False)

# Write JSON + JS to apps/ path (JS frontend hardcodes apps/)
apps_l10n_dir = '$THEME_DIR/apps/$app_name/l10n'
os.makedirs(apps_l10n_dir, exist_ok=True)

apps_json = os.path.join(apps_l10n_dir, 'pt_BR.json')
with open(apps_json, 'w') as f:
    json.dump(full, f, indent=4, ensure_ascii=False)

entries = []
for key, value in full['translations'].items():
    key_escaped = key.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\n', '\\\\n')
    if isinstance(value, list):
        value_js = json.dumps(value, ensure_ascii=False)
        entries.append(f'    \"{key_escaped}\": {value_js}')
    else:
        value_escaped = value.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\n', '\\\\n')
        entries.append(f'    \"{key_escaped}\": \"{value_escaped}\"')

plural_form = full.get('pluralForm', 'nplurals=2; plural=(n != 1);')
js_path = os.path.join(apps_l10n_dir, 'pt_BR.js')

with open(js_path, 'w') as f:
    f.write('OC.L10N.register(\n')
    f.write(f'    \"$app_name\",\n')
    f.write('    {\n')
    f.write(',\n'.join(entries))
    f.write('\n},\n')
    f.write(f'\"{plural_form}\");\n')

print(f'    -> {len(full[\"translations\"])} total, {len(override_keys)} overridden')
"

    rm -f "$tmp_file"
done

echo "Done. Rebuild the Docker image to apply."
