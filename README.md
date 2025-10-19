# Point Cloud Rendering Technical Task

This project implements a complete pipeline from raw point cloud data (PLY) to 3D Tiles for processing, tiling, and visualization. It supports both local and cloud deployment and includes modules for measurement, clipping, and coloring.  
The project is based on Cesium, and data conversion and tiling are fully automated via scripts.

## ⏱️ Development Time Breakdown

| Phase                                               | Time    |
| -------------------------------------------------- | ------- |
| MVP basic version (data preprocessing, local run)  | 10h     |
| Cloud deployment, bug fixes, feature polish, README| 10h     |
| Code review (about 35% simple code AI-assisted)    | 2h      |
| **Total**                                          | **22h** |

AI-generated code includes: related DOM structure code, TypeScript type completions and corrections, and naming fixes, etc.



## 🧩 Data Preprocessing & Tiling Method

The entire process requires no GUI software and is fully scriptable and reproducible.

### 1) PLY → Local-coordinate LAS

```bash
python ply_to_local.py input.ply -o local.las
```

> Note: RGB values need to be mapped to the **0 ~ 256** range (typical implementation is 0–255 uint8).

### 2) LAS (local) → ECEF coordinate system

```bash
python local_ply_2_ecef_las.py   --input local.las   --output ecef.las   --lon 116.4075 --lat 39.9040 --height 1.0
```

### 3) LAS/LAZ → 3D Tiles tiling

Install dependency:

```bash
pip install py3dtiles
```

Run tiling (either LAS or LAZ):

```bash
# If you have ecef.las:
py3dtiles convert ecef.las --out tiles --jobs 12

# If you already have LAZ (example name):
py3dtiles convert pointcloud_wgs84.laz --out tiles --jobs 12
```

> Note: py3dtiles supports API usage for custom tiling strategies.

#### Validate Tiles

```bash
npx 3d-tiles-validator --tilesetFile tiles/tileset.json
```

> ⚠️ In practice: after tiling, copy all **.json** files inside the `points` folder to the same directory as `tileset.json`; otherwise the browser will report path errors:
>
> ```bash
> cp tiles/points/*.json tiles/
> ```

---



## 🚀 Quick Start

### Requirements

- Node.js 18+
- npm, yarn, or pnpm

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create a `.env` file:

```env
VITE_CESIUM_TOKEN=your_cesium_ion_token
VITE_3DTILES_BASE=your_3dtiles_url
```

### Start dev server

```bash
npm run dev
```

### Build production bundle

```bash
npm run build
```



## 🛠️ Technical Architecture

### Core tech stack

- **Vue 3** – Front-end framework  
- **Cesium 1.134.1** – 3D globe and visualization engine  
- **TypeScript** – Type-safe JavaScript  
- **Vite** – Modern build tool

### Project structure

```
src/
├── components/           # Vue components
│   └── CesiumViewer.vue # Main view component
├── cesium/              # Cesium logic
│   ├── map.ts          # Map initialization
│   ├── mapConfig.ts    # Map configuration
│   └── tools/          # Utilities
│       ├── measureTool.ts    # Measurement tool
│       ├── colorMode.ts      # Color mode control
│       └── clippingTool.ts   # Clipping tool
├── assets/             # Static assets
├── App.vue            # Root component
└── main.ts            # App entry
```



# Cloud Deployment Guide

## 🌐 Deployment Architecture

**Tencent Cloud combo**: COS + CDN + Domain

## 💰 Cost Overview

- **Total cost**: USD $5  
- **Includes**: COS storage + CDN acceleration + DNS

## 🚀 Deployment Steps

### 1. Purchase services
Buy Tencent Cloud services:
- COS (Object Storage)
- CDN (Content Delivery Network)
- Domain

### 2. Create a bucket
Create a COS bucket; set permissions to private-read/private-write.

### 3. Upload 3D Tiles data
Upload the compressed 3D Tiles package to COS; decompress in the COS console; obtain the public URL for `tileset.json`.

### 4. Configure CORS
Configure CORS in COS to allow only your own domain.

### 5. Deploy front-end app
Build the project: after `npm run build`, upload the `dist` folder to CDN Page; it will autodeploy and give you an access URL.

### 6. Domain configuration
In your domain settings, point the `@` CNAME to the CDN address.

### 7. CDN configuration
- Cache static assets for 30 days, 3D Tiles for 7 days, and HTML for 1 hour
- Enable Gzip and HTTP/2

## 📈 Monitoring & Maintenance

### Traffic/health metrics
- COS access log analysis
- CDN traffic monitoring
- Error-rate statistics

### Cost control
- Monitor storage usage
- Track CDN bandwidth consumption

## 🚨 Troubleshooting

### Common issues
1. **CORS errors**: verify domain configuration
2. **3D Tiles fail to load**: validate `tileset.json` path
3. **CDN cache issues**: purge CDN cache

## 📝 Deployment Checklist

- [ ] COS bucket created
- [ ] 3D Tiles data uploaded
- [ ] CORS configured
- [ ] Front-end built
- [ ] CDN Page deployed
- [ ] DNS configured
- [ ] Functional testing done
- [ ] Performance monitoring set up

---

**After deployment, your 3D point-cloud app will be globally accelerated via CDN, delivering a fast and stable experience.**



## 🚀 Feature Overview

### 1. Measurement (point-to-point distance)

Supports multiple measurement modes and precise point-cloud snapping:

#### Measurement modes
- **3D straight-line distance**: Euclidean distance between two points in 3D space  
- **Surface geodesic distance**: shortest path along the Earth’s surface

#### Point-cloud snapping system

🪲**Limitation:** The implementation remains partially incomplete, with occasional failures under certain scenarios. We are actively addressing these issues. Until then, experiments can start from the undocumented `pickFromRayMostDetailed`.

Provides four interaction modes:

1. **Just 3D Tiles/CloudPoint OFF + Point Cloud Snapping OFF**
   - Selects points only on the terrain
   - Good for surface measurements
2. **Just 3D Tiles/CloudPoint OFF + Point Cloud Snapping ON**
   - Preview of snapped point-cloud points
   - Mixed surface + point-cloud measurement
3. **Just 3D Tiles/CloudPoint ON + Point Cloud Snapping OFF**
4. **Just 3D Tiles/CloudPoint ON + Point Cloud Snapping ON**
   - Smart point-cloud snapping
   - Snapping preview (small yellow dot)
   - Crosshair + ring sampling within pixel radius

To resolve the bug, we apply the following workflow: **when measurement starts, enable attenuation and EDL; when the session ends or is cancelled, revert all changes to their prior state**.

#### Snapping technical details
- **Error control**: multi-point sampling within a pixel radius to ensure precise snapping  
- **Preview**: shows a snap preview point on hover  
- **Performance**: avoid per-frame calculations when snap fails to reduce stutter. **There is still room for optimization in the current code.**

### 2. Rectangular/Polygon Clipping

Two clipping methods to fit different display needs:

#### Rectangular selection
- Draw a rectangle in the browser viewport
- Auto-map to the globe to form a spherical rectangle
- Supports frustum projection and automatically handles back-side intersections

#### Polygon clipping
- Draw arbitrary polygons on the globe
- Supports precise clipping of complex shapes
- Real-time preview of the clipped area

### 3. Color Mode Switching

Two coloring modes for point clouds:

#### RGB mode
- Uses the original RGB color in the point cloud
- Faithfully reproduces the appearance

#### Height mode
- Color mapping based on elevation
- 16-level elevation palette:  
  - Deep-sea blue → Aqua → Lowland green → Grass green  
  - Yellow-green transition → Sand yellow → Orange hills → Orange-red  
  - Red mountains → Red-purple ridges → Purple plateau → Purple-pink  
  - Light-violet snowline → Pale-blue snowfield → Snowcap

### 4. 3D Tiles Debug Panel

Integrated Cesium debugging tools:

- **Octree visualization**: shows bounding volume structures  
- **Freeze Frame**: freeze the current frame for analysis  
- **Performance monitor**: real-time FPS and render stats  
- **LOD inspection**: view loading across levels of detail



## 📖 Usage Guide

### Measurement

1. **Start measuring**
   - Click “Start” in the toolbar
   - Choose a mode (3D Line / Surface Line)

2. **Configure snapping**
   - **Point Cloud Snapping**: enable snap preview
   - **Just 3D Tiles/CloudPoint**: restrict picks to point-cloud points
   - **Snapping Radius**: set radius (2–30 px)

3. **Take a measurement**
   - Left-click to set start
   - Left-click to set end
   - Right-click or press ESC to cancel

4. **Manage results**
   - Click “Clear” to remove all results
   - Measurements persist on the map

### Clipping

1. **Rectangular clipping**
   - Click “Start Rectangular Clipping”
   - Drag to draw a rectangle
   - Release to apply

2. **Polygon clipping**
   - Click “Start Polygon Clipping”
   - Left-click to add vertices
   - Right-click to finish

3. **Clipping controls**
   - “Reverse Clipping”: invert region (outside/inside)
   - “Clear Clipping”: remove all clipping

### Color modes

1. Use the color-mode dropdown at the top-left  
2. Choose “RGB” or “Height”  
3. Observe changes in real time



## 🔮 Roadmap

### 3D Tiles tiling optimization

- Size optimization: **LAZ input, Draco on demand**. Use LAZ at source to cut IO; enable Draco for stable published data (big gains on mobile/worse networks). Mind Web Worker decoding.  
- Performance: **Octree/Quadtree + Implicit Tiling**. For large point clouds, implicit indexing (subtree) reduces `tileset.json` size and parse cost.  
- Upstream optimization: **Voxel grid stratification**. Larger voxels at root, smaller at leaves; density equalization per level to reduce “speckles.” Optionally use **blue-noise/Poisson-disk** for visual uniformity.  
- Visuals: **Normals/curvature** estimation for EDL, adaptive point size, or layered coloring.

### Picking/snapping & interaction

- **Two-stage snapping: screen candidates → 3D nearest-neighbor**. First filter by pixel radius (4–8 px), then 3D nearest neighbor; configurable hit thresholds/fallbacks.  
- **ID buffer / selection buffer**. Offline render point IDs for O(1) picking; greatly reduces move-event cost.  
- **Throttling & degraded preview**. Throttle mousemove at 30–50 ms; when not snapping, don’t update distance text, draw a light guide line only.  
- **Editing & history**. Structured storage of `start/end/line/label`; support per-segment deletion, endpoint dragging, session save/restore.

### Feature enhancements

- **Multi-point measurement**: polyline measurements  
- **Measurement export**: export measured data

### Visualization enhancements
- **Custom color schemes**: user-defined elevation palettes  
- **Animation**: animated measuring process  
- **Label styles**: customizable measurement labels

---

**Note**: This project requires a valid Cesium Ion token and a 3D Tiles data source. Ensure related parameters are correctly configured in environment variables.



## Technical Development Practices

### 🎯 Core design principle

**“The best rendering strategy is not to render.”**

Use multi-layer optimizations for high-performance point-cloud rendering: render only the “minimum necessary set visible to the camera.”

### Spatial layer
- **Frustum culling**: drop tiles outside the view frustum  
- **Occlusion culling**: drop occluded objects  
- **LOD strategy**: lower precision with increasing distance

### Perceptual layer
- **Perceptible difference control**: refine only within human-visible error bounds  
- **Dynamic LOD**: adjust detail based on distance and screen coverage

## 🛠️ 3D Tiles chunking strategy

```typescript
const tileset = new Cesium.Cesium3DTileset({
  maximumScreenSpaceError: 16,  // Screen-space error threshold
  skipLevelOfDetail: true,      // Skip intermediate LODs
  immediatelyLoadDesiredLevelOfDetail: false, // Deferred loading
  cullWithChildrenBounds: true  // Culling with children bounds
});
```

## 🔧 Error Handling & Logging

### Parameter validation
```typescript
constructor(viewer: Cesium.Viewer, options: MeasureToolOptions = {}) {
  if (!viewer || !(viewer instanceof Cesium.Viewer)) {
    throw new Error('Invalid viewer parameter');
  }
  this._snapRadiusPx = Math.max(2, Math.min(30, options.snapRadiusPx ?? 16));
}
```

### Exception handling
```typescript
try {
  const tileset = await Cesium.Cesium3DTileset.fromUrl(url);
  return tileset;
} catch (error) {
  console.error("❌ 点云加载失败:", error);
  throw new Error(`Point cloud load failed: ${error.message}`);
}
```

## 🌍 Environment Configuration

### Development
```typescript
// .env.development
VITE_3DTILES_BASE=http://localhost:8080/tiles
VITE_DEBUG_MODE=true
```

### Production
```typescript
// .env.production
VITE_3DTILES_BASE=https://cdn.example.com/tiles
VITE_DEBUG_MODE=false
```

## 💡 Best Practices

### 1. Avoid hard-coding
```typescript
// ✅ Use constants
export const MEASURE_CONFIG = {
  DEFAULT_SNAP_RADIUS: 16,
  MAX_SNAP_RADIUS: 30,
  MIN_SNAP_RADIUS: 2
} as const;
```

### 2. Reuse logic
```typescript
// Shared by rectangle & polygon
public applyClippingPolygons(polygonsPositions: Cesium.Cartesian3[][]): void {
  // Common clipping logic
}
```

### 3. Edge-case handling
```typescript
// Multi-fallback strategy
let position = scene.globe.pick(ray, scene);
if (!position) {
  position = camera.pickEllipsoid(screenPos, scene.globe.ellipsoid);
}
// Validity checks
if (position && !isNaN(position.x) && Cesium.Cartesian3.magnitude(position) > 0) {
  return position;
}
```

### 4. TypeScript type safety
```typescript
export type MeasureMode = "3d" | "surface" | "surface+height";
export interface MeasureToolOptions {
  mode?: MeasureMode;
  snapRadiusPx?: number;
}
```

---

These practices deliver a high-performance, maintainable 3D point-cloud processing application.



## 🔧 Utility Scripts

View point data in LAS format

```
python tool_look_las.py ./your_file.las
```

View point data in PLY format

```
python tool_look_ply.py  ./your_file.ply
```



## 🤔 Takeaways

Along the way I also explored other tools and projects:

CloudCompare, Entwine, PDAL, CesiumLab, 3DTiles Tools, etc., to name a few.
