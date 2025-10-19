#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PLY Global → Local Coordinate Conversion Script (Command-line Supported)
- Default “CloudCompare-style” automatic Global Shift (rounded down to the nearest thousand)
- Supports three modes: auto / manual / first_point
- Automatically saves shift info to *_origin.json for easy restoration: global = local + shift

Dependencies: numpy, plyfile
Install: pip install numpy plyfile
Usage examples:
  python ply_to_local.py input.ply -o output/scene_local.ply
  python ply_to_local.py input.ply --mode manual --manual-shift -407000 -427000 0
  python ply_to_local.py input.ply --mode first_point
  python ply_to_local.py input.ply --auto-base 1000
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Iterable, Optional, Tuple

import numpy as np
from plyfile import PlyData, PlyElement


def convert_ply_to_local(
    input_ply: str,
    output_ply: str,
    shift_mode: str = "auto",
    manual_shift: Optional[Tuple[float, float, float]] = None,
    save_origin_json: bool = True,
    auto_base: float = 1000.0,
) -> np.ndarray:
    """
    High-precision point cloud localization tool (CloudCompare-style optimized)

    Args:
        input_ply (str): Input PLY file (.ply only)
        output_ply (str): Output PLY file path (binary)
        shift_mode (str): 'auto' | 'manual' | 'first_point'
        manual_shift (tuple): e.g. (-407000, -427000, 0), valid only when shift_mode='manual'
        save_origin_json (bool): Whether to save origin JSON info (default True)
        auto_base (float): Base value in auto mode (default 1000 → floor(mean/base)*base)
    Returns:
        shift (np.ndarray, shape=(3,)): Actual translation used (global - shift = local)
    """
    print("Reading PLY ...")
    plydata = PlyData.read(input_ply)
    vertex = plydata["vertex"]

    # Property names
    prop_names = [p.name for p in vertex.properties]

    # Check required fields
    required = {"x", "y", "z"}
    if not required.issubset(prop_names):
        missing = required - set(prop_names)
        raise ValueError(f"PLY is missing required coordinate fields: {missing}")

    # Coordinates (float64 to avoid precision loss)
    x = vertex["x"].astype(np.float64)
    y = vertex["y"].astype(np.float64)
    z = vertex["z"].astype(np.float64)
    points_global = np.vstack((x, y, z)).T  # (N,3)

    if len(points_global) == 0:
        raise ValueError("Input PLY contains no points.")

    # Other attribute names
    other_props = [name for name in prop_names if name not in ("x", "y", "z")]
    if not other_props:
        print("This PLY contains only coordinate attributes, no additional fields.")

    # Compute shift
    if shift_mode == "auto":
        # Based on mean, floor(mean/base)*base (default 1000 → thousand level)
        def _floor_base(arr: np.ndarray, base: float) -> float:
            if base <= 0:
                raise ValueError("--auto-base must be positive")
            return float(np.floor(np.mean(arr) / base) * base)

        shift_x = _floor_base(x, auto_base)
        shift_y = _floor_base(y, auto_base)
        shift_z = _floor_base(z, auto_base)
        shift = np.array([shift_x, shift_y, shift_z], dtype=np.float64)
        print(f"Automatic shift (base={auto_base:g}): X={shift_x}, Y={shift_y}, Z={shift_z}")

    elif shift_mode == "manual":
        if manual_shift is None or len(manual_shift) != 3:
            raise ValueError("manual_shift must contain 3 values, e.g.: --manual-shift -407000 -427000 0")
        shift = np.array(manual_shift, dtype=np.float64)
        print(f"Manual shift: X={shift[0]}, Y={shift[1]}, Z={shift[2]}")

    elif shift_mode == "first_point":
        shift = points_global[0].astype(np.float64)
        print(f"Using first point as origin: X={shift[0]:.6f}, Y={shift[1]:.6f}, Z={shift[2]:.6f}")
    else:
        raise ValueError("shift_mode must be 'auto', 'manual', or 'first_point'")

    # High-precision subtraction → output xyz as float32 (common rendering/storage trade-off)
    points_local = points_global - shift

    # Build new dtype: xyz -> float32, others keep original dtype
    new_dtype = []
    for name in prop_names:
        if name in ("x", "y", "z"):
            new_dtype.append((name, "f4"))
        else:
            new_dtype.append((name, vertex[name].dtype))

    vertex_array = np.empty(len(points_local), dtype=new_dtype)
    vertex_array["x"] = points_local[:, 0].astype(np.float32)
    vertex_array["y"] = points_local[:, 1].astype(np.float32)
    vertex_array["z"] = points_local[:, 2].astype(np.float32)
    for name in other_props:
        vertex_array[name] = vertex[name]

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_ply) or ".", exist_ok=True)

    # Write as binary PLY
    PlyData([PlyElement.describe(vertex_array, "vertex")], text=False).write(output_ply)
    print(f"Saved local-coordinate PLY (binary): {output_ply}")

    # Save shift info
    if save_origin_json:
        json_path = os.path.splitext(output_ply)[0] + "_origin.json"
        origin_dict = {
            "shift_global": {"x": float(shift[0]), "y": float(shift[1]), "z": float(shift[2])},
            "shift_mode": shift_mode,
            "manual_shift": list(manual_shift) if (shift_mode == "manual") else None,
            "auto_base": float(auto_base),
            "input_ply": os.path.abspath(input_ply),
            "output_ply": os.path.abspath(output_ply),
            "note": "Restoration formula: global = local + shift_global",
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(origin_dict, f, ensure_ascii=False, indent=2)
        print(f"Shift information saved: {json_path}")

    return shift


def _derive_default_output(input_path: str) -> str:
    # Get filename (without extension), generate *_local.ply
    base = os.path.splitext(os.path.basename(input_path))[0]
    return os.path.join(os.path.dirname(input_path) or ".", f"{base}_local.ply")


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="ply_to_local",
        description="Convert PLY from global to local coordinates (CloudCompare-style Global Shift)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("input", help="Input .ply file")
    p.add_argument("-o", "--output", help="Output .ply file (default: same folder, *_local.ply)")
    p.add_argument(
        "-m",
        "--mode",
        choices=["auto", "manual", "first_point"],
        default="auto",
        help="Shift mode",
    )
    p.add_argument(
        "-s",
        "--manual-shift",
        nargs=3,
        type=float,
        metavar=("SX", "SY", "SZ"),
        help="Manual shift, valid only when --mode manual",
    )
    p.add_argument("--auto-base", type=float, default=1000.0, help="Base for auto mode: floor(mean/base)*base")
    p.add_argument("--no-json", action="store_true", help="Do not save *_origin.json")
    p.add_argument("-f", "--force", action="store_true", help="Overwrite existing output file")
    return p.parse_args(argv)


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)

    input_ply = args.input
    output_ply = args.output or _derive_default_output(input_ply)

    if (not args.force) and os.path.exists(output_ply):
        print(f" X Output file already exists: {output_ply}\n    Use --force to overwrite", file=sys.stderr)
        return 2

    try:
        shift = convert_ply_to_local(
            input_ply=input_ply,
            output_ply=output_ply,
            shift_mode=args.mode,
            manual_shift=tuple(args.manual_shift) if args.manual_shift else None,
            save_origin_json=not args.no_json,
            auto_base=args.auto_base,
        )
        print("\nConversion completed")
        print(f"Local = Global - ({shift[0]:.6f}, {shift[1]:.6f}, {shift[2]:.6f})")
        print(f"Example: local origin (0,0,0) corresponds to global coordinate ({shift[0]:.6f}, {shift[1]:.6f}, {shift[2]:.6f})")
        return 0
    except Exception as e:
        print(f"Program error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

# Example:
# python ply_to_local.py input.ply -o output.ply
