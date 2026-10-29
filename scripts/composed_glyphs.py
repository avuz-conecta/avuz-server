"""Glyphs Material Symbols lacks: composed from pinned Material glyphs, or drawn.

A composition keeps some subpaths of a frame glyph and places some subpaths of
an inner glyph in it (uniform scale, then offset, in the 960-unit viewBox).
Both come from the same package and weight, so strokes and corners match.
The filled variant is the regular shape: Material's filled frame would need
the inner shape cut out of it.

A drawn glyph is fixed path data in Material's grid: 60-unit strokes, round
joins, outer edges within 80..880, like the weight 400 glyphs.

Used by scripts/material_symbols.py: glyph_path() resolves these names too.
"""

import re
from dataclasses import dataclass

ARGUMENT_COUNTS = {"M": 2, "L": 2, "H": 1, "V": 1, "Q": 4, "T": 2, "C": 6, "S": 4, "Z": 0}
TOKEN = re.compile(r"[MLHVQTCSZ]|-?(?:\d+\.\d*|\.\d+|\d+)", re.IGNORECASE)
FILL_SUFFIX = "-fill"


@dataclass(frozen=True)
class Composition:
    frame: str
    frame_subpaths: slice
    inner: str
    inner_subpaths: slice
    inner_scale: float
    inner_offset: tuple


MONITOR = ("desktop_cloud", slice(2, None))

COMPOSITIONS = {
    "avuz_desktop_check": Composition(*MONITOR, "check_small", slice(None), 1, (0, -64.5)),
    "avuz_desktop_image": Composition(*MONITOR, "imagesmode", slice(3, None), 0.85, (71.15, -157.525)),
}

DRAWN_GLYPHS = {
    # grupo-vidalar's three peaks (their External sites icon), redrawn as
    # three peak outlines over a base line, stroked 60 units, round joins.
    "avuz_mountains": "M544.7-861.5L716.7-448.8L719.2-451.5L724-454.9L729.3-457.4L735-458.7L740.9-458.9L746.7-458L752.1-455.9L757.1-452.9L761.4-448.9L764.9-444.1L767.3-438.8L878.3-119.9L879.4-115.9L880-110L879.4-104.1L877.7-98.5L874.9-93.3L870-87.6L865.2-84.1L859.9-81.7L854.1-80.3L850-80L110-80L104.1-80.6L98.5-82.3L93.8-84.7L89.2-88.4L85.4-92.8L82.3-98.5L80.7-103.6L80-109.4L80.5-115.3L82.1-120.9L291.7-656.8L294.5-662.1L298.2-666.8L302.8-670.6L308-673.5L313.7-675.3L319.7-675.9L325.6-675.3L331.3-673.5L336.6-670.6L341.2-666.8L344.9-662.1L347.6-656.8L390-548.4L488.4-859.1L490.8-864.6L494.3-869.6L498.7-873.8L503.9-877L509.7-879.1L515.7-880L521.8-879.6L527.6-878L533.1-875.3L537.9-871.6L541.8-866.9ZM319.7-563.5L154-140L260.7-140L361.2-457.4ZM396-368.5L323.6-140L485.4-140ZM424.8-459.5L549.8-140L629.7-140L689-359.1L520.8-762.8ZM780.3-140L726.7-268.7L691.9-140Z",
}


def absolute_subpaths(path_data: str) -> list:
    """Split path data into subpaths of absolute (command, numbers) segments."""
    tokens = TOKEN.findall(path_data)
    subpaths = []
    x = y = start_x = start_y = 0.0
    index = 0
    command = ""
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        upper = command.upper()
        if upper not in ARGUMENT_COUNTS:
            raise ValueError(f"unsupported path command {command!r}")
        count = ARGUMENT_COUNTS[upper]
        numbers = [float(token) for token in tokens[index:index + count]]
        index += count
        relative = command.islower()
        if upper == "Z":
            subpaths[-1].append(("Z", []))
            x, y = start_x, start_y
            continue
        if upper == "H":
            x = numbers[0] + (x if relative else 0)
            subpaths[-1].append(("H", [x]))
            continue
        if upper == "V":
            y = numbers[0] + (y if relative else 0)
            subpaths[-1].append(("V", [y]))
            continue
        points = [
            value + ((x if position % 2 == 0 else y) if relative else 0)
            for position, value in enumerate(numbers)
        ]
        x, y = points[-2], points[-1]
        if upper == "M":
            subpaths.append([("M", points)])
            start_x, start_y = x, y
            command = "l" if relative else "L"
            continue
        subpaths[-1].append((upper, points))
    return subpaths


def transform(subpaths: list, scale: float, offset: tuple) -> list:
    offset_x, offset_y = offset

    def moved(command: str, numbers: list) -> list:
        if command == "H":
            return [numbers[0] * scale + offset_x]
        if command == "V":
            return [numbers[0] * scale + offset_y]
        return [value * scale + (offset_x if position % 2 == 0 else offset_y) for position, value in enumerate(numbers)]

    return [[(command, moved(command, numbers)) for command, numbers in subpath] for subpath in subpaths]


def format_number(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def path_data(subpaths: list) -> str:
    segments = (
        command + " ".join(format_number(value) for value in numbers)
        for subpath in subpaths
        for command, numbers in subpath
    )
    return "".join(segments).replace(" -", "-")


def avuz_glyph_path(name: str, glyph_path) -> str:
    base_name = name.removesuffix(FILL_SUFFIX)
    if base_name in DRAWN_GLYPHS:
        return DRAWN_GLYPHS[base_name]
    composition = COMPOSITIONS[base_name]
    frame = absolute_subpaths(glyph_path(composition.frame))[composition.frame_subpaths]
    inner = absolute_subpaths(glyph_path(composition.inner))[composition.inner_subpaths]
    return path_data(frame + transform(inner, composition.inner_scale, composition.inner_offset))


def is_avuz_glyph(name: str) -> bool:
    base_name = name.removesuffix(FILL_SUFFIX)
    return base_name in COMPOSITIONS or base_name in DRAWN_GLYPHS
