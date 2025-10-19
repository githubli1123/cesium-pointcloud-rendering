import numpy as np
from plyfile import PlyData
import laspy
from pyproj import CRS
import os
import argparse

def local_ply_to_ecef_las(
    input_ply,
    output_dir,
    origin_lon,
    origin_lat,
    origin_height=0.0,
    preserve_rgb=True
):
    """
    Convert a local-coordinate PLY (ENU) to ECEF-coordinate LAS
    """

    print("🚀 Starting conversion: Local PLY → ECEF LAS")
    print(f"📍 Local origin: {origin_lon:.6f}°E, {origin_lat:.6f}°N, {origin_height:.3f}m")

    # 1️⃣ Read local PLY
    print("\n Reading local PLY file...")
    plydata = PlyData.read(input_ply)
    vertex = plydata['vertex']
    east = vertex['x'].astype(np.float64)
    north = vertex['y'].astype(np.float64)
    up = vertex['z'].astype(np.float64)
    N = len(east)
    print(f"   ✅ Loaded {N:,} points")

    # 2️⃣ Convert origin lon/lat to ECEF coordinates
    print("\n Computing ECEF coordinates of the origin...")

    a = 6378137.0                # WGS84 semi-major axis
    e2 = 6.69437999014e-3        # First eccentricity squared

    lat0 = np.radians(origin_lat)
    lon0 = np.radians(origin_lon)
    sin_lat = np.sin(lat0)
    cos_lat = np.cos(lat0)
    sin_lon = np.sin(lon0)
    cos_lon = np.cos(lon0)

    N0 = a / np.sqrt(1 - e2 * sin_lat ** 2)
    x0 = (N0 + origin_height) * cos_lat * cos_lon
    y0 = (N0 + origin_height) * cos_lat * sin_lon
    z0 = (N0 * (1 - e2) + origin_height) * sin_lat
    origin_ecef = np.array([x0, y0, z0])
    print(f"    Origin ECEF: ({x0:.3f}, {y0:.3f}, {z0:.3f}) m")

    # 3️⃣ Local ENU → ECEF
    print("\n Converting ENU → ECEF ...")

    # Rotation matrix (ECEF <- ENU)
    R = np.array([
        [-sin_lon,              cos_lon,               0],
        [-sin_lat * cos_lon,   -sin_lat * sin_lon,     cos_lat],
        [cos_lat * cos_lon,     cos_lat * sin_lon,     sin_lat]
    ])

    local_points = np.vstack((east, north, up))
    ecef_points = origin_ecef.reshape(3, 1) + R @ local_points

    x_ecef, y_ecef, z_ecef = ecef_points

    print(f"    Coordinate range (ECEF X): [{x_ecef.min():.3f}, {x_ecef.max():.3f}]")

    # 4️⃣ Write LAS file
    print("\n Writing ECEF LAS file...")
    os.makedirs(output_dir, exist_ok=True)
    las_path = os.path.join(output_dir, "output_ecef.las")

    header = laspy.LasHeader(point_format=3, version="1.4")
    # ECEF is not a standard EPSG system — store as custom
    header.system_identifier = "ECEF (Earth-Centered, Earth-Fixed)"
    las = laspy.LasData(header)

    las.x = x_ecef
    las.y = y_ecef
    las.z = z_ecef

    # RGB channels
    if preserve_rgb:
        for color in ["red", "green", "blue"]:
            if color in vertex:
                val = vertex[color]
                if np.issubdtype(val.dtype, np.floating):
                    val = np.clip(val * 255 if val.max() <= 1.01 else val, 0, 255).astype(np.uint8)
                else:
                    val = np.clip(val, 0, 255).astype(np.uint8)
                setattr(las, color, val)
                print(f"    RGB channel '{color}' written")

    las.write(las_path)
    print(f"    ECEF LAS saved: {las_path}")
    print("Conversion complete!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert a local-coordinate PLY (ENU) to an ECEF-coordinate LAS")
    parser.add_argument("--input", type=str, required=True, help="Input local PLY file path")
    parser.add_argument("--output", type=str, required=True, help="Output ECEF LAS file path")
    parser.add_argument("--lon", type=float, required=True, help="Longitude of local origin (°E)")
    parser.add_argument("--lat", type=float, required=True, help="Latitude of local origin (°N)")
    parser.add_argument("--height", type=float, default=0.0, help="Height of local origin (m)")
    parser.add_argument("--preserve_rgb", action="store_true", help="Preserve RGB channels if available")
    args = parser.parse_args()

    output_dir = os.path.dirname(args.output)
    if not output_dir:
        output_dir = "."

    local_ply_to_ecef_las(
        args.input,
        output_dir,
        args.lon,
        args.lat,
        args.height,
        args.preserve_rgb
    )
    print("Conversion complete!")
    print(f"Output file: {args.output}")
    print(f"Local origin: {args.lon:.6f}°E, {args.lat:.6f}°N, {args.height:.3f}m")
    print("Preserve RGB channels: " + ("Yes" if args.preserve_rgb else "No"))
    # Note: the 'las' variable is not visible outside the function; adjust if needed.

# Example:
# python local_ply_2_ecef_las.py --input output.ply --output ./ecef_pointcloud.las --lon 116.4075 --lat 39.9040 --height 1.0
