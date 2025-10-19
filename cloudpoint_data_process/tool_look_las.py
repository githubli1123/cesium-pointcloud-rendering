#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import laspy
import numpy as np
import argparse

def main():
    parser = argparse.ArgumentParser(description="Print all attributes of points in a LAS/LAZ file")
    parser.add_argument("lasfile", help="Path to LAS/LAZ file")
    parser.add_argument("--limit", type=int, default=5, help="How many points to print (default: 5)")
    args = parser.parse_args()

    print(f"Reading LAS file: {args.lasfile}")
    las = laspy.read(args.lasfile)

    print(f"LAS Version: {las.header.version}")
    print(f"Point Format: {las.header.point_format}")
    print(f"Number of Points: {len(las):,}")

    # ✅ 关键修复：强制转为 list，避免 generator 报错
    dim_names = list(las.point_format.dimension_names)
    print(f"Available dimensions ({len(dim_names)}): {dim_names}")

    print(f"Scale: {las.header.scales}, Offset: {las.header.offsets}")

    # 转为结构化数组
    pts = las.points.array
    n = min(args.limit, len(pts))
    print(f"\nFirst {n} points (all attributes):\n")
    for i in range(n):
        point_dict = {
            name: pts[name][i].item()
            if np.ndim(pts[name][i]) == 0
            else pts[name][i].tolist()
            for name in pts.dtype.names
        }
        print(f"#{i}: {point_dict}")

    # 打印 CRS（可选）
    try:
        crs = las.header.parse_crs()
        if crs:
            print("\nCRS info:")
            epsg = crs.to_epsg()
            if epsg:
                print(f"  EPSG: {epsg}")
            wkt = crs.to_wkt()
            print(f"  WKT (truncated): {wkt[:200]}...")
    except Exception:
        pass

if __name__ == "__main__":
    main()


# python tool_look_las.py ./output_ecef.las