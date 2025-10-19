import * as Cesium from "cesium";
import MeasureTool from "./tools/measureTool";
import ColorModeTool from "./tools/colorMode";
import ClippingTool from "./tools/clippingTool";
import { mapOptionsBase } from "./mapConfig";

const cesium_token = import.meta.env.VITE_CESIUM_TOKEN;

export let viewer: Cesium.Viewer;
let tileset: Cesium.Cesium3DTileset | undefined = undefined;
let clipper: ClippingTool | undefined = undefined;
let colorCtl: ColorModeTool | undefined = undefined;
// 高度配置
const FIXED_HEIGHT_OFFSET = -240;
let originalTilesetCenter: Cesium.Cartesian3 | null = null;
const tilesetURL = import.meta.env.VITE_3DTILES_BASE;


export const mapInit = async () => {
    Cesium.Ion.defaultAccessToken = cesium_token;
    viewer = new Cesium.Viewer("cesiumContainer", await mapOptionsBase());
    (window as any).viewer = viewer;

    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(116.3191, 40.109, 10000000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: Cesium.Math.toRadians(0),
        },
        duration: 3,
    });

    viewer.scene.debugShowFramesPerSecond = true;
    viewer.extend(Cesium.viewerCesium3DTilesInspectorMixin);
    // const inspectorViewModel = viewer.cesium3DTilesInspector.viewModel;
    changeCesiumDOMPosition(); // 辅助函数

    try {
        tileset = await loadPointCloud(tilesetURL);
        clipper = new ClippingTool(viewer, tileset);
        colorCtl = new ColorModeTool(tileset);
        new MeasureTool(viewer, tileset, {
            mode: "3d",
            clampToGround: false,
        });
    } catch (error) {
        console.error("Failed to load point cloud:", error);
    }
    reminder();
};

export const mapDestroy = () => {
    if (clipper) {
        clipper.destroy();
        clipper = undefined;
    }
    if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
    }
};

// ====== 加载点云 ======
async function loadPointCloud(url: string): Promise<Cesium.Cesium3DTileset> {
    if (!viewer) {
        throw new Error("Viewer not initialized");
    }

    try {
        const tileset = await Cesium.Cesium3DTileset.fromUrl(url);
        viewer.scene.primitives.add(tileset);

        // await tileset.readyPromise;
        originalTilesetCenter = Cesium.Cartesian3.clone(tileset.boundingSphere.center);
        setTilesetSimpleHeight(tileset, FIXED_HEIGHT_OFFSET);
        // 应用默认颜色模式
        // setPointCloudColorMode(currentColorMode);
        viewer.camera.flyToBoundingSphere(tileset.boundingSphere, { duration: 1.5 });
        return tileset;
    } catch (error) {
        console.error("❌ 点云加载失败:", error);
        throw new Error(`Point cloud load failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

function setTilesetSimpleHeight(tileset: Cesium.Cesium3DTileset, heightOffset: number) {
    if (!originalTilesetCenter) return;

    const cartographic = Cesium.Cartographic.fromCartesian(originalTilesetCenter);
    const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
    const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
}


function changeCesiumDOMPosition() {
    const inspector = document.querySelector('.cesium-viewer-cesium3DTilesInspectorContainer') as HTMLDivElement | null;
    if (inspector) {
        inspector.style.top = '120px';
        // inspector.style.left = '10px';
    }
    // const perf = document.querySelector('.cesium-performanceDisplay-defaultContainer') as HTMLDivElement | null;
    // if (perf) {
    //     perf.style.top = '10px';
    //     // perf.style.left = '10px';
    // }
}

function reminder() {
    // 清理旧的
    const old = document.getElementById("global-esc-hint");
    if (old) old.remove();

    // 容器
    const hint = document.createElement("div");
    hint.id = "global-esc-hint";
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");
    hint.style.cssText = `
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  max-width: 420px;
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  background: rgba(0,0,0,0.72);
  border-radius: 8px;
  padding: 10px 12px 10px 12px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.25);
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  border-left: 4px solid #2ecc71;
  backdrop-filter: blur(2px);
`;

    // 文案
    const text = document.createElement("div");
    text.textContent = "提示：正在进行的所有操作可以按 ESC 退出。";

    // 关闭按钮
    const close = document.createElement("button");
    close.setAttribute("aria-label", "关闭提示");
    close.textContent = "×";
    close.style.cssText = `
  appearance: none;
  border: none;
  outline: none;
  cursor: pointer;
  width: 26px;
  height: 26px;
  line-height: 26px;
  text-align: center;
  border-radius: 6px;
  background: #444;
  color: #fff;
  font-size: 16px;
  transition: transform .15s ease, background .15s ease, opacity .15s ease;
`;
    close.onmouseenter = () => (close.style.background = "#555");
    close.onmouseleave = () => (close.style.background = "#444");
    close.onclick = () => {
        hint.style.opacity = "0";
        hint.style.transform = "translateY(6px)";
        setTimeout(() => hint.remove(), 150);
    };

    // 装入
    hint.appendChild(text);
    hint.appendChild(close);
    document.body.appendChild(hint);

    // ESC 键按下时自动隐藏提示（不拦截你的业务 ESC 逻辑）
    const escHide = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" || ev.key === "Esc") {
            if (document.body.contains(hint)) {
                hint.style.opacity = "0";
                hint.style.transform = "translateY(6px)";
                setTimeout(() => hint.remove(), 150);
            }
            // 不阻止默认与冒泡，让你的其他 ESC 处理照常工作
        }
    };
    window.addEventListener("keydown", escHide);
}