// MeasureTool.ts
import * as Cesium from "cesium";

export type MeasureMode = "3d" | "surface" | "surface+height";

export interface MeasureToolOptions {
    mode?: MeasureMode;
    snapEnabled?: boolean;  // 是否开启吸附
    clickableTileset?: boolean;    // 可点击 3D Tiles
    clampToGround?: boolean;
    snapRadiusPx?: number;         // 吸附半径（像素）
    snapIndicatorSizePx?: number;  // （可选）吸附小黄点像素大小，默认 4，限制 2~12
}

type ResultPack = {
    line: Cesium.Entity;
    label: Cesium.Entity;
    start: Cesium.Entity;
    end: Cesium.Entity;
};

type SnapResult = {
    cart: Cesium.Cartesian3;
    screen: Cesium.Cartesian2;
};

export default class MeasureTool {
    // ====== 公共配置 ======
    public viewer: Cesium.Viewer;
    public tileset: Cesium.Cesium3DTileset;
    public mode: MeasureMode;
    public clampToGround: boolean;

    // ====== 交互状态 ======
    public _handler: Cesium.ScreenSpaceEventHandler;
    public _active = false;
    public _startPos: Cesium.Cartesian3 | undefined = undefined;
    public _movingPos: Cesium.Cartesian3 | undefined = undefined;

    // ====== 临时绘制（当前测量中的） ======
    private _polylineEntity: Cesium.Entity | undefined = undefined;
    private _labelEntity: Cesium.Entity | undefined = undefined;
    private _startPoint: Cesium.Entity | undefined = undefined;
    private _endPoint: Cesium.Entity | undefined = undefined;

    // ====== 历史结果 ======
    private _allResults: ResultPack[] = [];

    // ====== 事件解绑与监听 ======
    private _escListener?: (e: KeyboardEvent) => void;
    private _cleanupFns: Array<() => void> = [];

    // ====== 吸附配置 ======
    private _snapEnabled: boolean;
    private _snapRadiusPx: number;
    private _clickableTileset: boolean;
    private _snapIndicatorSizePx: number;

    // ====== 吸附预览小点（黑色） ======
    private _snapIndicator: Cesium.Entity | undefined = undefined;

    constructor(viewer: Cesium.Viewer, tileset: Cesium.Cesium3DTileset, options: MeasureToolOptions = {}) {
        this.viewer = viewer;
        this.tileset = tileset;
        this.mode = options.mode ?? "3d";
        this.clampToGround = options.clampToGround ?? false;

        this._snapEnabled = options.snapEnabled ?? true;
        this._snapRadiusPx = options.snapRadiusPx ?? 16;
        this._clickableTileset = options.clickableTileset ?? true;
        this._snapIndicatorSizePx = Math.max(2, Math.min(12, options.snapIndicatorSizePx ?? 4));

        this._handler = new Cesium.ScreenSpaceEventHandler(this.viewer.canvas);

        this.viewer.scene.globe.depthTestAgainstTerrain = false;

        this.createMeasureToolbar();
    }

    public EDL(flag: boolean) {
        if (flag) {
            this.tileset.pointCloudShading.attenuation = true;
            this.tileset.pointCloudShading.eyeDomeLighting = true;
            this.tileset.pointCloudShading.eyeDomeLightingStrength = 1.1;
            this.tileset.pointCloudShading.eyeDomeLightingRadius = 1.0;
        } else {
            this.tileset.pointCloudShading.attenuation = false;
            this.tileset.pointCloudShading.eyeDomeLighting = false;
        }
    }

    public activate() {
        this.EDL(true);
        if (this._active) return;
        this._active = true;
        this._bind();
        this._setToolbarActive(true);
        this._toast("测距：左键起点 → 左键终点；右键或 ESC 取消。");
        this._hintHowToExit();
    }

    public deactivate() {
        this.EDL(false);
        if (!this._active) return;
        this._active = false;
        this._unbind();
        this._clearCurrentDrawing();
        this._hideSnapIndicator();
        this._setToolbarActive(false);
    }

    public clearAllMeasurements() {
        this.EDL(false);
        this._clearCurrentDrawing();
        for (const r of this._allResults) {
            this.viewer.entities.remove(r.line);
            this.viewer.entities.remove(r.label);
            this.viewer.entities.remove(r.start);
            this.viewer.entities.remove(r.end);
        }
        this._allResults = [];
        this._hideSnapIndicator();
        this._toast("已清空所有测量结果。");
    }

    // ===================== 交互绑定/解绑 =====================
    private _bind() {
        // 左键：确定起点/终点（走吸附）
        this._handler.setInputAction((movement: any) => {
            const snap = this._pickWithSnap(movement.position);
            const pos = snap?.cart;
            if (!pos) {
                if (this._snapEnabled && this._clickableTileset) this._toast("未拾取到点");
                return;
            }
            if (!this._startPos) {
                this._clearCurrentDrawing();
                this._startPos = pos;
                this._startPoint = this.viewer.entities.add({
                    position: pos,
                    point: { pixelSize: 5, color: Cesium.Color.CYAN },
                });
                this._beginDynamicLine();
            } else {
                this._finalize(pos);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this._handler.setInputAction((movement: any) => {
            const snap = this._pickWithSnap(movement.endPosition);
            if (snap) {
                this._movingPos = snap.cart;
                this._updateSnapIndicator(snap.cart, snap.screen);
            } else {
                this._movingPos = undefined;
                // 保持上一个可见的黑点一小会儿更友好，也可立即隐藏
                this._hideSnapIndicator();
            }
            this._updateLabelAndLine();
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this._handler.setInputAction(() => {
            this._cancel();
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        this._escListener = (e: KeyboardEvent) => {
            if (e.key === "Escape") this._cancel();
        };
        window.addEventListener("keydown", this._escListener);
        this._cleanupFns.push(() => window.removeEventListener("keydown", this._escListener!));
    }

    private _unbind() {
        this._handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
        this._handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        this._handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        this._cleanupFns.forEach((fn) => fn());
        this._cleanupFns = [];
    }

    // ===================== 动态绘制 =====================
    private _beginDynamicLine() {
        const positionsCb = new Cesium.CallbackProperty(() => {
            if (!this._startPos) return [] as Cesium.Cartesian3[];
            if (this._movingPos) return [this._startPos, this._movingPos];
            return [this._startPos];
        }, false);

        this._polylineEntity = this.viewer.entities.add({
            polyline: {
                positions: positionsCb as any,
                width: 3,
                clampToGround: this.clampToGround,
                material: Cesium.Color.AQUA,
            },
        });

        const labelPosCb = new Cesium.CallbackProperty(() => {
            if (!this._startPos) return this._startPos as any;
            if (!this._movingPos) return this._startPos as any;
            return Cesium.Cartesian3.midpoint(
                this._startPos,
                this._movingPos,
                new Cesium.Cartesian3()
            );
        }, false);

        this._labelEntity = this.viewer.entities.add({
            position: labelPosCb as any,
            label: {
                text: "",
                font: "bold 14px sans-serif",
                fillColor: Cesium.Color.WHITE,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
    }

    private _updateLabelAndLine(finalize = false) {
        if (!this._startPos || !this._movingPos || !this._labelEntity) return;
        const dist = this._computeDistance(this._startPos, this._movingPos);
        const text = this._formatDistance(dist) + (finalize ? "（完成）" : "");
        const label = this._labelEntity.label!;
        if (!label) return;
        if (label.text instanceof Cesium.ConstantProperty) {
            label.text.setValue(text);
        } else {
            label.text = new Cesium.ConstantProperty(text);
        }
    }

    // ===================== 完成/取消 当前一次 =====================
    private _finalize(endPos: Cesium.Cartesian3) {
        if (!this._startPos) return;

        this._movingPos = endPos;

        // 固定终点
        this._endPoint = this.viewer.entities.add({
            position: endPos,
            point: { pixelSize: 10, color: Cesium.Color.RED },
        });

        // 固定线与标签（历史结果保留）
        const dist = this._computeDistance(this._startPos, endPos);
        const staticLine = this.viewer.entities.add({
            polyline: {
                positions: [this._startPos, endPos],
                width: 3,
                clampToGround: this.clampToGround,
                material: Cesium.Color.fromCssColorString("#efe3e5ff"),
            },
        });
        const mid = Cesium.Cartesian3.midpoint(this._startPos, endPos, new Cesium.Cartesian3());
        const staticLabel = this.viewer.entities.add({
            position: mid,
            label: {
                text: this._formatDistance(dist),
                font: "bold 14px sans-serif",
                fillColor: Cesium.Color.WHITE,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });

        // 记录历史
        this._allResults.push({
            line: staticLine,
            label: staticLabel,
            start: this._startPoint!,
            end: this._endPoint!,
        });

        // 移除临时动态
        if (this._polylineEntity) this.viewer.entities.remove(this._polylineEntity);
        if (this._labelEntity) this.viewer.entities.remove(this._labelEntity);
        this._polylineEntity = undefined;
        this._labelEntity = undefined;

        // 重置
        this._startPos = undefined;
        this._movingPos = undefined;
        this._startPoint = undefined;
        this._endPoint = undefined;

        // 结束本次交互
        this._unbind();
        this._active = false;
        this._hideSnapIndicator();
        this._setToolbarActive(false);
        this._toast("测距完成。");
    }

    private _cancel() {
        this._unbind();
        this._active = false;
        this._clearCurrentDrawing();
        this._hideSnapIndicator();
        this._setToolbarActive(false);
        this._toast("已取消测距。");
    }

    /** 清理“进行中的”绘制内容（不影响历史结果） */
    private _clearCurrentDrawing() {
        if (this._polylineEntity) this.viewer.entities.remove(this._polylineEntity);
        if (this._labelEntity) this.viewer.entities.remove(this._labelEntity);
        this._polylineEntity = undefined;
        this._labelEntity = undefined;

        if (this._startPoint) this.viewer.entities.remove(this._startPoint);
        if (this._endPoint) this.viewer.entities.remove(this._endPoint);
        this._startPoint = undefined;
        this._endPoint = undefined;

        this._startPos = undefined;
        this._movingPos = undefined;
    }

    // ===================== 计算 =====================
    private _computeDistance(c1: Cesium.Cartesian3, c2: Cesium.Cartesian3) {
        if (this.mode === "3d") return Cesium.Cartesian3.distance(c1, c2);
        const p1 = Cesium.Cartographic.fromCartesian(c1);
        const p2 = Cesium.Cartographic.fromCartesian(c2);
        const geodesic = new Cesium.EllipsoidGeodesic(p1, p2);
        const surface = geodesic.surfaceDistance;
        if (this.mode === "surface") return surface;
        const dh = (p2.height || 0) - (p1.height || 0);
        return Math.sqrt(surface * surface + dh * dh);
    }

    private _formatDistance(meters: number) {
        if (meters < 1000) return `${meters.toFixed(2)} m`;
        if (meters < 10000) return `${(meters / 1000).toFixed(3)} km`;
        return `${(meters / 1000).toFixed(2)} km`;
    }

    // ===================== 吸附拾取 =====================
    /** 是否是 tileset/点云命中 */
    private _isTilesetPick(picked: any): boolean {
        if (!picked) return false;
        // 兼容多种返回：Cesium3DTileFeature / Model features / primitive 指向 tileset
        if ((Cesium as any).Cesium3DTileFeature && picked instanceof (Cesium as any).Cesium3DTileFeature) return true;
        if (picked?.tileset) return true;
        if (picked?.content?.tileset) return true;
        if (picked?.primitive && picked.primitive instanceof Cesium.Cesium3DTileset) return true;
        return false;
    }

    /** 原始 pickPosition（不带吸附） */
    private _pickRaw(windowPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
        const scene = this.viewer.scene;
        if (scene.pickPositionSupported) {
            const c = scene.pickPosition(windowPosition);
            if (Cesium.defined(c)) return c as Cesium.Cartesian3;
        }
        const ray = this.viewer.camera.getPickRay(windowPosition);
        if (!ray || !scene.globe) return undefined;
        return scene.globe.pick(ray, scene) || undefined;
    }

    /** 单点 pick，按“仅 tileset”限制过滤 */
    private _pickFiltered(windowPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
        const scene = this.viewer.scene;
        const picked = scene.pick(windowPosition);
        if (this._clickableTileset) {
            if (!this._isTilesetPick(picked)) return undefined;
        } else {
            if (!picked) return undefined;
        }
        if (scene.pickPositionSupported) {
            const c = scene.pickPosition(windowPosition);
            if (Cesium.defined(c)) return c as Cesium.Cartesian3;
        }
        return undefined;
    }

    /** 生成吸附采样 offset：十字 + 环形 */
    private _genSampleOffsets(radius: number): Cesium.Cartesian2[] {
        const arr: Cesium.Cartesian2[] = [];
        for (let r = 0; r <= radius; r += 3) {
            arr.push(new Cesium.Cartesian2(+r, 0));
            arr.push(new Cesium.Cartesian2(-r, 0));
            arr.push(new Cesium.Cartesian2(0, +r));
            arr.push(new Cesium.Cartesian2(0, -r));
        }
        for (let r = 4; r <= radius; r += 4) {
            const step = Math.PI / 4;
            for (let a = 0; a < 2 * Math.PI; a += step) {
                arr.push(new Cesium.Cartesian2(Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))));
            }
        }
        arr.unshift(new Cesium.Cartesian2(0, 0));
        return arr;
    }

    /** 在像素半径内采样，返回最近命中的吸附点（含屏幕坐标） */
    private _pickWithSnap(windowPosition: Cesium.Cartesian2): SnapResult | undefined {
        if (!this._snapEnabled) {
            const raw = this._pickRaw(windowPosition);
            return raw ? { cart: raw, screen: windowPosition.clone() } : undefined;
        }

        const offsets = this._genSampleOffsets(this._snapRadiusPx);
        const canvas = this.viewer.canvas;
        const best: { cart: Cesium.Cartesian3; screen: Cesium.Cartesian2; dist2: number }[] = [];

        for (const off of offsets) {
            const sx = (windowPosition.x + off.x);
            const sy = (windowPosition.y + off.y);
            if (sx < 0 || sy < 0 || sx > canvas.clientWidth || sy > canvas.clientHeight) continue;

            const screen = new Cesium.Cartesian2(sx, sy);
            const cart = this._pickFiltered(screen);
            if (!cart) continue;

            const dx = off.x;
            const dy = off.y;
            const d2 = dx * dx + dy * dy;
            best.push({ cart, screen, dist2: d2 });

            // 若已是中心点命中，提前返回
            if (d2 === 0) return { cart, screen };
        }

        if (best.length === 0) {
            // 兜底：尝试不限制对象的原始 pick
            const raw = this._pickRaw(windowPosition);
            return raw ? { cart: raw, screen: windowPosition.clone() } : undefined;
        }

        // 取距离最小者
        best.sort((a, b) => a.dist2 - b.dist2);
        const top = best[0];
        return { cart: top.cart, screen: top.screen };
    }

    // ===== 吸附点（黑色）可见性控制 =====
    private _updateSnapIndicator(pos: Cesium.Cartesian3 | undefined, win?: Cesium.Cartesian2) {
        if (pos) {

            if (!this._snapIndicator) {
                this._snapIndicator = this.viewer.entities.add({
                    position: pos,
                    point: {
                        pixelSize: this._snapIndicatorSizePx,
                        color: Cesium.Color.BLACK,                 // 黑色主体
                        outlineColor: Cesium.Color.WHITE,          // 白色描边，便于看清
                        outlineWidth: 1,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                });
            } else {
                (this._snapIndicator.point as any).pixelSize = this._snapIndicatorSizePx;
                this._snapIndicator.position = pos as any;
            }
        } else {
            this._hideSnapIndicator();
        }
    }

    private _hideSnapIndicator() {
        if (this._snapIndicator) {
            this.viewer.entities.remove(this._snapIndicator);
            this._snapIndicator = undefined;
        }
    }

    // ===================== 工具栏 UI =====================
    private createMeasureToolbar() {
        const existing = document.getElementById("measure-toolbar");
        if (existing) existing.remove();

        const toolbar = document.createElement("div");
        toolbar.id = "measure-toolbar";
        toolbar.style.cssText = `
            position: absolute;
            top: 100px;
            left: 10px;
            z-index: 10;
            background: rgba(0, 0, 0, 0.6);
            padding: 8px;
            border-radius: 6px;
            color: white;
            font-size: 14px;
            display: grid;
            grid-auto-flow: row;
            gap: 8px;
            min-width: 300px;
        `;

        // 行1：模式、开始、清空
        const row1 = document.createElement("div");
        row1.style.cssText = `display:flex; align-items:center; gap:8px; flex-wrap: wrap;`;

        const label = document.createElement("span");
        label.textContent = "Distance Measurement Mode:";

        const select = document.createElement("select");
        select.style.cssText = `
            padding: 4px 8px;
            font-size: 14px;
            background: #333;
            color: white;
            border: 1px solid #555;
            border-radius: 4px;
        `;
        const modes = [
            { value: "3d", text: "3D Line" },
            { value: "surface", text: "Surface Line" },
            // { value: "surface+height", text: "地表+高程" },
        ];
        modes.forEach((opt) => {
            const el = document.createElement("option");
            el.value = opt.value;
            el.textContent = opt.text;
            select.appendChild(el);
        });
        select.value = this.mode;
        select.addEventListener("change", (e) => {
            this.mode = (e.target as HTMLSelectElement).value as MeasureMode;
            this._toast(`切换测距模式为：${this.mode}`);
        });

        const startBtn = document.createElement("button");
        startBtn.id = "measure-btn";
        startBtn.textContent = "Start";
        startBtn.style.cssText = `
            padding: 4px 10px;
            border: none;
            background: #2ecc71;
            color: white;
            border-radius: 4px;
            cursor: pointer;
            transition: all .2s;
        `;
        startBtn.addEventListener("click", () => this.activate());

        const clearBtn = document.createElement("button");
        clearBtn.textContent = "Clear";
        clearBtn.style.cssText = `
            padding: 4px 10px;
            border: none;
            background: #888;
            color: white;
            border-radius: 4px;
            cursor: pointer;
            transition: all .2s;
        `;
        clearBtn.addEventListener("click", () => this.clearAllMeasurements());

        row1.appendChild(label);
        row1.appendChild(select);
        row1.appendChild(startBtn);
        row1.appendChild(clearBtn);

        // 行2：吸附开关 & 仅 tileset
        const row2 = document.createElement("div");
        row2.style.cssText = `display:flex; align-items:center; gap:12px; flex-wrap: wrap;`;

        const snapWrap = document.createElement("label");
        snapWrap.style.cssText = `display:flex; align-items:center; tilesetChkgap:6px;`;
        const snapChk = document.createElement("input");
        snapChk.type = "checkbox";
        snapChk.checked = this._snapEnabled;
        const snapLbl = document.createElement("span");
        snapLbl.textContent = "Point Cloud Snapping";
        snapWrap.appendChild(snapChk);
        snapWrap.appendChild(snapLbl);
        snapChk.addEventListener("change", () => {
            this._snapEnabled = snapChk.checked;
            if (!this._snapEnabled) this._hideSnapIndicator();
        });

        const tilesetWrap = document.createElement("label");
        tilesetWrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
        const tilesetChk = document.createElement("input");
        tilesetChk.type = "checkbox";
        tilesetChk.checked = this._clickableTileset;
        const tilesetOnlyLbl = document.createElement("span");
        tilesetOnlyLbl.textContent = "Clickable 3D Tiles/CloudPoint";
        tilesetWrap.appendChild(tilesetChk);
        tilesetWrap.appendChild(tilesetOnlyLbl);
        tilesetChk.addEventListener("change", () => {
            this._clickableTileset = tilesetChk.checked;
        });

        row2.appendChild(snapWrap);
        row2.appendChild(tilesetWrap);

        // 行3：吸附半径滑块
        const row3 = document.createElement("div");
        row3.style.cssText = `display:flex; align-items:center; gap:8px;`;
        const radiusLbl = document.createElement("span");
        radiusLbl.textContent = "Snapping Radius(px):";
        const radiusVal = document.createElement("span");
        radiusVal.textContent = String(this._snapRadiusPx);
        radiusVal.style.minWidth = "24px";
        const radius = document.createElement("input");
        radius.type = "range";
        radius.min = "2";
        radius.max = "30";
        radius.value = String(this._snapRadiusPx);
        radius.style.width = "160px";
        radius.addEventListener("input", () => {
            this._snapRadiusPx = parseInt(radius.value, 10);
            radiusVal.textContent = radius.value;
        });

        row3.appendChild(radiusLbl);
        row3.appendChild(radius);
        row3.appendChild(radiusVal);

        toolbar.appendChild(row1);
        toolbar.appendChild(row2);
        toolbar.appendChild(row3);
        document.body.appendChild(toolbar);
    }

    /** 切换“开始测距”按钮的 Active 样式与状态 */
    private _setToolbarActive(active: boolean) {
        const btn = document.getElementById("measure-btn") as HTMLButtonElement | undefined;
        if (!btn) return;
        if (active) {
            btn.style.background = "#e67e22";
            btn.style.boxShadow = "0 0 8px #e67e22";
            btn.textContent = "Measuring…";
            btn.disabled = true;
            btn.style.cursor = "not-allowed";
        } else {
            btn.style.background = "#2ecc71";
            btn.style.boxShadow = "none";
            btn.textContent = "Start";
            btn.disabled = false;
            btn.style.cursor = "pointer";
        }
    }

    private _hintHowToExit() {
        const existing = document.getElementById("measure-hint");
        if (existing) existing.remove();

        const hint = document.createElement("div");
        hint.id = "measure-hint";
        hint.style.cssText = `
        position: absolute;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.75);
        color: #fff;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        pointer-events: none;
        z-index: 100;
        transition: opacity .3s ease;
    `;
        hint.textContent = "During measurement: Left-click to set the start point → Left-click to set the end point; Right-click or press ESC to cancel.";

        document.body.appendChild(hint);

        setTimeout(() => {
            hint.style.opacity = "0";
            setTimeout(() => hint.remove(), 300);
        }, 6000);
    }

    // ===================== 工具 =====================
    private _toast(msg: string) {
        console.log(`[MeasureTool] ${msg}`);
    }
}
