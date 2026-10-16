#!/usr/bin/env python3
"""Generate the External sites icon library (Deck #417) from the pinned Lucide build.

Reads the icon nodes from apps/avuz_theme/js/lucide.js (the Lucide UMD bundle the
theme already ships, version in its @license header) and writes, per icon:
  <name>.svg       stroke="currentColor", like themes/avuz/apps/*/img/<app>.svg
  <name>-dark.svg  stroke="#000000", the variant External sites serves to the
                   mobile and desktop clients
into apps/avuz_theme/img/external-icons/. docker/seed-external-icons.php copies
them into the External sites icon store at boot.

Usage: python3 -I scripts/generate-external-icons.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LUCIDE_BUNDLE = REPO_ROOT / "apps/avuz_theme/js/lucide.js"
OUTPUT_DIR = REPO_ROOT / "apps/avuz_theme/img/external-icons"

ICONS = [
    "briefcase", "book-open", "building-2", "calendar", "chart-column", "chart-pie",
    "circle-help", "clipboard-list", "cloud", "cog", "credit-card", "database",
    "external-link", "file-text", "folder", "globe", "graduation-cap", "headset",
    "house", "landmark", "link", "mail", "map-pin", "message-circle", "newspaper",
    "phone", "receipt", "server", "shield-check", "shopping-cart", "truck", "users",
    "video", "wallet",
]

LIGHT_STROKE = "currentColor"
DARK_STROKE = "#000000"
SVG_OPEN = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" '
    'fill="none" stroke="{stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
)
UNQUOTED_KEY = re.compile(r'([{,])([A-Za-z][\w-]*):')


def pascal_case(icon_name: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in icon_name.split("-"))


def bracketed_array(source: str, start: int) -> str:
    depth = 0
    for index in range(start, len(source)):
        if source[index] == "[":
            depth += 1
        elif source[index] == "]":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise ValueError("unbalanced icon node array")


def icon_nodes(bundle: str, icon_name: str) -> list:
    export = re.search(rf'[{{,]{pascal_case(icon_name)}:([\w$]+)[,}}]', bundle)
    if export is None:
        raise KeyError(f"{icon_name} is not exported by {LUCIDE_BUNDLE.name}")
    definition = re.search(rf'[,;\s]{re.escape(export.group(1))}=\[', bundle)
    if definition is None:
        raise KeyError(f"{icon_name}: no definition for {export.group(1)}")
    array_source = bracketed_array(bundle, definition.end() - 1)
    return json.loads(UNQUOTED_KEY.sub(r'\1"\2":', array_source))


def render_svg(nodes: list, stroke: str) -> str:
    elements = [
        "  <{tag} {attributes}/>".format(
            tag=tag,
            attributes=" ".join(f'{name}="{value}"' for name, value in attributes.items()),
        )
        for tag, attributes in nodes
    ]
    return "\n".join([SVG_OPEN.format(stroke=stroke), *elements, "</svg>"]) + "\n"


def main() -> int:
    bundle = LUCIDE_BUNDLE.read_text(encoding="utf-8")
    version = re.search(r"@license lucide v([\d.]+)", bundle).group(1)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for icon_name in ICONS:
        nodes = icon_nodes(bundle, icon_name)
        (OUTPUT_DIR / f"{icon_name}.svg").write_text(render_svg(nodes, LIGHT_STROKE), encoding="utf-8")
        (OUTPUT_DIR / f"{icon_name}-dark.svg").write_text(render_svg(nodes, DARK_STROKE), encoding="utf-8")
    print(f"wrote {len(ICONS)} icons (Lucide {version}) to {OUTPUT_DIR.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
