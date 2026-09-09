#!/usr/bin/env python3
"""Create a multi-resolution macOS ICNS asset from a square PNG app icon."""
from pathlib import Path
import sys

from PIL import Image

ICON_SIZES = (16, 32, 64, 128, 256, 512, 1024)


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: scripts/create-macos-icon.py INPUT.png OUTPUT.icns", file=sys.stderr)
        return 2

    source = Path(sys.argv[1]).expanduser().resolve()
    output = Path(sys.argv[2]).expanduser().resolve()
    if not source.is_file():
        print(f"Source icon not found: {source}", file=sys.stderr)
        return 2

    with Image.open(source) as input_image:
        image = input_image.convert("RGBA")

    width, height = image.size
    if width != height:
        print(f"Source icon must be square, got {width}x{height}", file=sys.stderr)
        return 2

    images = [
        image.resize((size, size), Image.Resampling.LANCZOS)
        for size in ICON_SIZES
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    images[-1].save(output, format="ICNS", append_images=images[:-1])
    print(f"Created macOS icon: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
