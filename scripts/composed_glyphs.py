"""Glyphs Material Symbols lacks, composed from pinned Material glyphs.

A composition keeps some subpaths of a frame glyph and places some subpaths of
an inner glyph in it (uniform scale, then offset, in the 960-unit viewBox).
Both come from the same package and weight, so strokes and corners match.
The filled variant is the regular shape: Material's filled frame would need
the inner shape cut out of it.

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


def compose(name: str, glyph_path) -> str:
    composition = COMPOSITIONS[name.removesuffix(FILL_SUFFIX)]
    frame = absolute_subpaths(glyph_path(composition.frame))[composition.frame_subpaths]
    inner = absolute_subpaths(glyph_path(composition.inner))[composition.inner_subpaths]
    return path_data(frame + transform(inner, composition.inner_scale, composition.inner_offset))


def is_composed(name: str) -> bool:
    return name.removesuffix(FILL_SUFFIX) in COMPOSITIONS
