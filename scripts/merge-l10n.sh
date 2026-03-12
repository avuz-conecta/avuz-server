#!/bin/sh
# Merge original Nextcloud translations with Avuz theme overrides.
#
# This script runs at BUILD TIME in the Dockerfile for bundled apps (apps/ and core/).
# App Store apps (custom_apps/) are handled separately at runtime in entrypoint.sh.
#
# Nextcloud has two translation layers:
#   - PHP backend loads .json from theme path mirroring the real app location
#   - JS frontend loads .js from themes/{theme}/apps/ (hardcoded in JSResourceLocator)
#
# The merge takes the original app's full translation file and overlays our overrides,
# so all strings remain in pt_BR instead of falling back to English.

NEXTCLOUD_ROOT="${1:-/var/www/html}"
THEME_ROOT="${2:-/var/www/html/themes/avuz}"

echo "Merging l10n translations (original + theme overrides)..."

find "$THEME_ROOT" -path "*/l10n/*.json" -type f | while read theme_json; do
    relative_path="${theme_json#$THEME_ROOT/}"

    case "$relative_path" in
        custom_apps/*)
            # Skip custom_apps — they don't exist at build time.
            # Handled at runtime in entrypoint.sh.
            continue
            ;;
        apps/core/*)
            # core lives at $NEXTCLOUD_ROOT/core/, not $NEXTCLOUD_ROOT/apps/core/
            app_name="core"
            locale=$(basename "$theme_json" .json)
            original_json="$NEXTCLOUD_ROOT/core/l10n/$locale.json"
            js_output_dir="$THEME_ROOT/apps/core/l10n"
            ;;
        apps/*)
            app_name=$(echo "$relative_path" | cut -d'/' -f2)
            locale=$(basename "$theme_json" .json)
            original_json="$NEXTCLOUD_ROOT/apps/$app_name/l10n/$locale.json"
            js_output_dir="$THEME_ROOT/apps/$app_name/l10n"
            ;;
        core/*)
            app_name="core"
            locale=$(basename "$theme_json" .json)
            original_json="$NEXTCLOUD_ROOT/core/l10n/$locale.json"
            js_output_dir="$THEME_ROOT/core/l10n"
            ;;
        *)
            echo "  Skipping unknown path: $relative_path"
            continue
            ;;
    esac

    if [ ! -f "$original_json" ]; then
        echo "  Skipping $app_name/$locale (original not found at $original_json)"
        continue
    fi

    echo "  Merging $app_name/$locale..."
    mkdir -p "$js_output_dir"

    python3 -c "
import json

with open('$original_json', 'r') as f:
    original = json.load(f)

with open('$theme_json', 'r') as f:
    theme = json.load(f)

merged = original.copy()
merged['translations'].update(theme.get('translations', {}))

# Write merged JSON back to the theme override location (for PHP backend)
with open('$theme_json', 'w') as f:
    json.dump(merged, f, indent=4, ensure_ascii=False)

# Generate JS file (for frontend)
entries = []
for key, value in merged['translations'].items():
    key_escaped = key.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\\n', '\\\\n')
    if isinstance(value, list):
        value_js = json.dumps(value, ensure_ascii=False)
        entries.append(f'    \"{key_escaped}\": {value_js}')
    else:
        value_escaped = value.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\\n', '\\\\n')
        entries.append(f'    \"{key_escaped}\": \"{value_escaped}\"')

plural_form = merged.get('pluralForm', 'nplurals=2; plural=(n != 1);')
js_file = '$js_output_dir/$locale.js'

with open(js_file, 'w') as f:
    f.write('OC.L10N.register(\n')
    f.write(f'    \"$app_name\",\n')
    f.write('    {\n')
    f.write(',\n'.join(entries))
    f.write('\n},\n')
    f.write(f'\"{plural_form}\");\n')

print(f'    -> {len(merged[\"translations\"])} translations')
"
done

echo "Done merging l10n translations."
