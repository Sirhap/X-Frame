#!/usr/bin/env python3
"""Convert flat-background PNG frames into transparent sprite frames.

The script estimates each frame's background from its border, flood-fills only
background-connected pixels, and keeps detached foreground details intact.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from statistics import median

from PIL import Image, ImageFilter


def parse_args() -> argparse.Namespace:
    """Parse command-line options."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="Directory of source PNG frames")
    parser.add_argument("output_dir", type=Path, help="Directory for transparent PNG frames")
    parser.add_argument(
        "--threshold",
        type=int,
        default=32,
        help="Maximum RGB distance treated as connected background",
    )
    parser.add_argument(
        "--softness",
        type=int,
        default=16,
        help="Distance range used for a soft antialiased edge",
    )
    return parser.parse_args()


def estimate_background(image: Image.Image) -> tuple[int, int, int]:
    """Estimate the background RGB color from evenly sampled border pixels."""
    rgb_image = image.convert("RGB")
    pixels = rgb_image.load()
    width, height = rgb_image.size
    samples: list[tuple[int, int, int]] = []
    step = max(1, min(width, height) // 80)

    for x in range(0, width, step):
        samples.extend((pixels[x, 0], pixels[x, height - 1]))
    for y in range(0, height, step):
        samples.extend((pixels[0, y], pixels[width - 1, y]))

    return tuple(int(median(channel)) for channel in zip(*samples))


def create_alpha_mask(
    image: Image.Image,
    background: tuple[int, int, int],
    threshold: int,
    softness: int,
) -> Image.Image:
    """Create an alpha mask by flood-filling pixels connected to the frame edge."""
    threshold = max(0, int(threshold))
    softness = max(0, int(softness))
    rgb_image = image.convert("RGB")
    pixels = rgb_image.load()
    width, height = rgb_image.size
    visited = bytearray(width * height)
    alpha = Image.new("L", (width, height), 255)
    alpha_pixels = alpha.load()
    queue: list[int] = []
    queue_head = 0
    maximum_distance_squared = threshold**2
    opaque_distance = max(1, threshold - softness)
    opaque_distance_squared = opaque_distance**2
    soft_distance = max(1, threshold - opaque_distance)
    background_red, background_green, background_blue = background

    def enqueue_if_background(x: int, y: int) -> None:
        """Queue an unvisited pixel when it is sufficiently close to background."""
        index = y * width + x
        if visited[index]:
            return
        visited[index] = 1
        red, green, blue = pixels[x, y]
        red_delta = red - background_red
        green_delta = green - background_green
        blue_delta = blue - background_blue
        distance_squared = (
            red_delta * red_delta
            + green_delta * green_delta
            + blue_delta * blue_delta
        )
        if distance_squared <= maximum_distance_squared:
            queue.append(index)

    for x in range(width):
        enqueue_if_background(x, 0)
        enqueue_if_background(x, height - 1)
    for y in range(height):
        enqueue_if_background(0, y)
        enqueue_if_background(width - 1, y)

    while queue_head < len(queue):
        index = queue[queue_head]
        queue_head += 1
        x = index % width
        y = index // width
        red, green, blue = pixels[x, y]
        red_delta = red - background_red
        green_delta = green - background_green
        blue_delta = blue - background_blue
        distance_squared = (
            red_delta * red_delta
            + green_delta * green_delta
            + blue_delta * blue_delta
        )
        if distance_squared <= opaque_distance_squared:
            alpha_pixels[x, y] = 0
        else:
            distance = distance_squared**0.5
            alpha_pixels[x, y] = round(
                255 * (distance - opaque_distance) / soft_distance
            )

        if x > 0:
            enqueue_if_background(x - 1, y)
        if x + 1 < width:
            enqueue_if_background(x + 1, y)
        if y > 0:
            enqueue_if_background(x, y - 1)
        if y + 1 < height:
            enqueue_if_background(x, y + 1)

    return alpha.filter(ImageFilter.GaussianBlur(radius=0.45))


def process_frames(
    input_dir: Path, output_dir: Path, threshold: int, softness: int
) -> int:
    """Process all PNG frames and return the number written."""
    input_paths = sorted(input_dir.glob("*.png"))
    if not input_paths:
        raise FileNotFoundError(f"No PNG frames found in {input_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    for input_path in input_paths:
        with Image.open(input_path) as source_image:
            background = estimate_background(source_image)
            alpha = create_alpha_mask(source_image, background, threshold, softness)
            result = source_image.convert("RGBA")
            result.putalpha(alpha)
            result.save(output_dir / input_path.name, optimize=True)

    return len(input_paths)


def main() -> None:
    """Run the frame conversion and report a concise result."""
    args = parse_args()
    try:
        count = process_frames(
            args.input_dir, args.output_dir, args.threshold, args.softness
        )
    except (FileNotFoundError, OSError, ValueError) as error:
        raise SystemExit(f"Frame extraction failed: {error}") from error
    print(f"Wrote {count} transparent frames to {args.output_dir}")


if __name__ == "__main__":
    main()
