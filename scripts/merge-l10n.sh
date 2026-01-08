#!/bin/sh
# Merge original Nextcloud translations with Avuz theme overrides
# Run this during Docker build after copying theme files

NEXTCLOUD_ROOT="${1:-/var/www/html}"
THEME_ROOT="${2:-/var/www/html/themes/avuz}"

echo "Merging l10n translations (original + theme overrides)..."

# Process all JSON files in the theme l10n directories
find "$THEME_ROOT" -path "*/l10n/*.json" -type f | while read theme_json; do
    # Get relative path from theme root (e.g., apps/dashboard/l10n/pt_BR.json or core/l10n/pt_BR.json)
    relative_path="${theme_json#$THEME_ROOT/}"

    # Determine the original file path and app name
    case "$relative_path" in
        apps/*)
            # e.g., apps/dashboard/l10n/pt_BR.json -> app_name=dashboard
            app_name=$(echo "$relative_path" | cut -d'/' -f2)
            original_json="$NEXTCLOUD_ROOT/$relative_path"
            ;;
        core/*)
            # e.g., core/l10n/pt_BR.json -> app_name=core
            app_name="core"
            original_json="$NEXTCLOUD_ROOT/$relative_path"
            ;;
        *)
            echo "  Skipping unknown path: $relative_path"
            continue
            ;;
    esac

    locale=$(basename "$theme_json" .json)

    if [ ! -f "$original_json" ]; then
        echo "  Skipping $app_name/$locale (no original file at $original_json)"
        continue
    fi

    echo "  Merging $app_name/$locale..."

    # Merge: start with original, overlay theme overrides
    python3 -c "
import json
import sys

# Read original translations
with open('$original_json', 'r') as f:
    original = json.load(f)

# Read theme overrides
with open('$theme_json', 'r') as f:
    theme = json.load(f)

# Merge: original + theme overrides
merged = original.copy()
merged['translations'].update(theme.get('translations', {}))

# Write merged JSON back to theme
with open('$theme_json', 'w') as f:
    json.dump(merged, f, indent=4, ensure_ascii=False)

# Generate JS file
js_file = '$theme_json'.replace('.json', '.js')
entries = []
for key, value in merged['translations'].items():
    key_escaped = key.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\\n', '\\\\n')
    # Handle both string and list values (pluralization)
    if isinstance(value, list):
        value_escaped = json.dumps(value, ensure_ascii=False)
        entries.append(f'    \"{key_escaped}\": {value_escaped}')
    else:
        value_escaped = value.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\\n', '\\\\n')
        entries.append(f'    \"{key_escaped}\": \"{value_escaped}\"')

plural_form = merged.get('pluralForm', 'nplurals=2; plural=(n != 1);')

with open(js_file, 'w') as f:
    f.write('OC.L10N.register(\\n')
    f.write(f'    \"$app_name\",\\n')
    f.write('    {\\n')
    f.write(',\\n'.join(entries))
    f.write('\\n},\\n')
    f.write(f'\"{plural_form}\");\\n')

print(f'    -> {len(merged[\"translations\"])} translations')
"
done

echo "Done merging l10n translations."
