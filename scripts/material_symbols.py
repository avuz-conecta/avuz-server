"""Pinned Material Symbols glyphs (Rounded, weight 300), shared by the icon generators.

Downloads from the npm package through jsDelivr. Every glyph must be a single
<path> on the 960-unit viewBox, so it renders as one fill="currentColor" shape.

Used by scripts/generate-rail-icons.py and scripts/generate-external-icons.py.
"""

import re
import urllib.request

WEIGHT = 300
PACKAGE = f"@material-symbols/svg-{WEIGHT}"
VERSION = "0.48.1"
STYLE = "rounded"
PACKAGE_URL = f"https://cdn.jsdelivr.net/npm/{PACKAGE}@{VERSION}"
VIEW_BOX = "0 -960 960 960"

LIGHT_FILL = "currentColor"
DARK_FILL = "#000000"

SINGLE_PATH = re.compile(r'^<svg[^>]*viewBox="0 -960 960 960"[^>]*><path d="([^"]+)"/></svg>$')


def download(path: str) -> str:
    with urllib.request.urlopen(f"{PACKAGE_URL}/{path}", timeout=30) as response:
        return response.read().decode("utf-8")


def glyph_path(file_name: str) -> str:
    source = download(f"{STYLE}/{file_name}.svg").strip()
    match = SINGLE_PATH.match(source)
    if match is None:
        raise ValueError(f"{file_name}: expected one <path> on a {VIEW_BOX} viewBox, got {source[:120]}")
    return match.group(1)


def render_svg(path_data: str, fill: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="{VIEW_BOX}" fill="{fill}">\n'
        f'  <path d="{path_data}"/>\n'
        "</svg>\n"
    )
