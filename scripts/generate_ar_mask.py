#!/usr/bin/env python3
"""Generate an alpha occlusion mask for the AR preview demo.

Thresholds demo-assets/ar-preview/scene_depth.png (a grayscale depth map) to
decide which pixels count as "foreground" (near the camera), then combines
that alpha channel with the RGB colors of demo-assets/ar-preview/scene.png so
the output PNG shows the real foreground pixels wherever it's opaque, and is
fully transparent everywhere else.

The result (scene_mask.png) is layered on top of the 3D model in
frontend/src/components/ARPreview.tsx, so the foreground object in the photo
visually occludes the model. This is a one-off offline step, not something
the backend computes at request time — see demo_ar_preview_dir in
backend/app/config.py and backend/app/routers/demo_assets.py, which just
serve whatever PNG files already exist in demo-assets/ar-preview/.

NOTE on the current placeholder demo-assets/ar-preview/scene_depth.png (a
ParkLens test case, see its README.txt): it is a literal distance map (dark =
near, bright = far), the opposite of the common MiDaS-style inverse-depth
convention this script defaults to. Generating it currently requires
`--invert`. Check the convention again whenever scene.png/scene_depth.png
are replaced with the real demo scene — don't assume --invert still applies.

Usage:
    python scripts/generate_ar_mask.py --invert  # matches the current placeholder scene_depth.png
    python scripts/generate_ar_mask.py --threshold 160
    python scripts/generate_ar_mask.py --scene path/to/new_scene.png --depth path/to/new_depth.png

Requires Pillow, which is already a backend dependency (see
backend/requirements.txt) — no new dependency is introduced here. Re-run
this whenever scene.png / scene_depth.png are replaced with the real demo
scene, or whenever the threshold needs adjusting.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter

DEMO_ASSETS_DIR = Path(__file__).resolve().parents[1] / "demo-assets" / "ar-preview"
DEFAULT_SCENE_PATH = DEMO_ASSETS_DIR / "scene.png"
DEFAULT_DEPTH_PATH = DEMO_ASSETS_DIR / "scene_depth.png"
DEFAULT_OUTPUT_PATH = DEMO_ASSETS_DIR / "scene_mask.png"
DEFAULT_THRESHOLD = 128  # 0-255; depth values at/above this count as foreground.
DEFAULT_FEATHER = 2  # Gaussian blur radius (px) on the alpha edge; 0 disables.


def build_mask(
    scene_path: Path,
    depth_path: Path,
    output_path: Path,
    threshold: int,
    invert: bool,
    feather: int,
) -> None:
    scene = Image.open(scene_path).convert("RGB")
    depth = Image.open(depth_path).convert("L")

    if depth.size != scene.size:
        # Keep the mask pixel-aligned with the background photo even if the
        # depth map was exported at a different resolution.
        depth = depth.resize(scene.size, Image.BILINEAR)

    # Convention: brighter pixel = nearer to camera (standard for relative
    # depth-estimation output, e.g. MiDaS-style). Pass --invert if the depth
    # map you're using is the opposite convention (brighter = farther).
    is_foreground = depth.point(lambda value: 255 if (value >= threshold) != invert else 0)

    if feather > 0:
        is_foreground = is_foreground.filter(ImageFilter.GaussianBlur(feather))

    mask = scene.copy()
    mask.putalpha(is_foreground)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mask.save(output_path)
    print(
        f"Wrote {output_path} ({mask.size[0]}x{mask.size[1]}, "
        f"threshold={threshold}, invert={invert}, feather={feather})"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--scene", type=Path, default=DEFAULT_SCENE_PATH, help="Path to the background photo.")
    parser.add_argument("--depth", type=Path, default=DEFAULT_DEPTH_PATH, help="Path to the grayscale depth map.")
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Path to write the alpha mask PNG."
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=DEFAULT_THRESHOLD,
        help="Depth value (0-255) at/above which a pixel counts as foreground. Default: %(default)s.",
    )
    parser.add_argument(
        "--invert",
        action="store_true",
        help="Use if your depth map's convention is brighter = farther instead of brighter = nearer.",
    )
    parser.add_argument(
        "--feather",
        type=int,
        default=DEFAULT_FEATHER,
        help="Gaussian blur radius in px applied to the alpha edge, to soften the cutout. "
        "0 disables. Default: %(default)s.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    build_mask(args.scene, args.depth, args.output, args.threshold, args.invert, args.feather)


if __name__ == "__main__":
    main()
