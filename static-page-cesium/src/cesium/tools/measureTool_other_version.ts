// MeasureTool.ts
import * as Cesium from "cesium";

export type MeasureMode = "3d" | "surface" | "surface+height";

export interface MeasureToolOptions {
    mode?: MeasureMode;
    clampToGround?: boolean;
    snapEnabled?: boolean;         // 是否开启吸附
    snapRadiusPx?: number;         // 吸附半径（像素）
    snapTilesetsOnly?: boolean;    // 仅对 3D Tiles/点云吸附（避免吸到地表）
    snapPreview?: boolean;         // 显示吸附预览小黄点
    snapIndicatorSizePx?: number;  // （可选）吸附小黄点像素大小，默认 4，限制 2~12
    snapStrict?: boolean;
}

type ResultPack = {
    line: Cesium.Entity;
    label: Cesium.Entity;
    start: Cesium.Entity;
    end: Cesium.Entity;
};

export default class MeasureTool {
    // ====== 公共配置 ======
    public viewer: Cesium.Viewer;
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
    private _snapTilesetsOnly: boolean;
    private _snapIndicatorSizePx: number;
    private _snapStrict: boolean;

    // ====== 吸附预览小黄点 ======
    // 吸附预览小黄点
    private _snapIndicator: Cesium.Entity | undefined = undefined;
    private _lastSnapCart?: Cesium.Cartesian3;
    private _lastSnapScreen?: Cesium.Cartesian2;

    constructor(viewer: Cesium.Viewer, options: MeasureToolOptions = {}) {
        this.viewer = viewer;
        this.mode = options.mode ?? "3d";
        this.clampToGround = options.clampToGround ?? false;

        this._snapEnabled = options.snapEnabled ?? true;
        this._snapRadiusPx = options.snapRadiusPx ?? 16;
        this._snapTilesetsOnly = options.snapTilesetsOnly ?? true;
        this._snapIndicatorSizePx = Math.max(2, Math.min(12, options.snapIndicatorSizePx ?? 4)); // 默认更小 4px
        this._snapStrict = options.snapStrict ?? true; // 默认 true，严格模式

        this._handler = new Cesium.ScreenSpaceEventHandler(this.viewer.canvas);

        // 提升拾取精度：允许地形深度检测
        this.viewer.scene.globe.depthTestAgainstTerrain = false;

        // 创建工具栏
        this.createMeasureToolbar();
    }

    /** 开始一次测量交互 */
    public activate() {
        if (this._active) return;
        this._active = true;
        this._bind();
        this._setToolbarActive(true);
        this._toast("测距：左键起点 → 左键终点；右键或 ESC 取消。");
        this._hintHowToExit();
    }

    /** 结束测量交互（不清空历史结果） */
    public deactivate() {
        if (!this._active) return;
        this._active = false;
        this._unbind();
        this._clearCurrentDrawing();
        this._hideSnapIndicator();
        this._setToolbarActive(false);
    }

    /** 清空所有历史测量结果 */
    public clearAllMeasurements() {
        // 清当前
        this._clearCurrentDrawing();
        // 清历史
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
        // 左键：确定起点/终点
        this._handler.setInputAction((movement: any) => {
            const pick = this._pickPosition(movement.position, true); // ★
            console.log('click pick:', pick.pos)
            this._lastSnapCart;
            console.log('click snap:', this._lastSnapCart)
            debugger;
            if (!pick.pos) {
                if (this._snapEnabled && this._snapStrict) {
                    this._toast("未拾取到点");
                }
                return;
            }
            if (!this._startPos) {
                this._clearCurrentDrawing();
                this._startPos = pick.pos;
                this._startPoint = this.viewer.entities.add({
                    position: pick.pos,
                    point: { pixelSize: 5, color: Cesium.Color.CYAN },
                });
                this._beginDynamicLine();
            } else {
                console.info(pick.pos, this._startPos);
                this._finalize(pick.pos);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);


        // 鼠标移动：更新吸附预览 + 动态线
        this._handler.setInputAction((movement: any) => {
            // 1、关闭 Just 3D Tiles/CloudPoint ，关闭 Point Cloud Snapping 
            if (!this._snapTilesetsOnly && !this._snapEnabled) {
                const pos = this._pickPosition(movement.endPosition);
                if (!pos) return;
                this._movingPos = pos.pos;
                this._updateLabelAndLine();
            }
            // 2. 关闭 Just 3D Tiles/CloudPoint ，开启 Point Cloud Snapping 
            else if (!this._snapTilesetsOnly && this._snapEnabled) {
                let snap = this._snapPick(movement.endPosition);
                if (snap) {
                    this._lastSnapCart = snap;
                    this._updateSnapIndicator(snap, movement.endPosition);
                    if (!this._startPos) return; // 起点未定：只做预览
                    this._movingPos = snap;
                    this._updateLabelAndLine();
                }

                // --------------- 后面是回退到常规拾取 ---------------//
                // ⚡ 此处可以优化，优化为只拾取一次
                else {
                    const pos = this._pickPosition(movement.endPosition);
                    if (!pos) {
                        this._updateSnapIndicator(this._lastSnapCart, movement.endPosition);
                        this._movingPos = snap;
                        this._updateLabelAndLine();
                        return;
                    }
                }

            }
            // 3. 开启 Just 3D Tiles/CloudPoint ，关闭 Point Cloud Snapping 
            else if (this._snapTilesetsOnly && !this._snapEnabled) {
                let snap = this._snapPick(movement.endPosition);
                if (snap) {
                    this._lastSnapCart = snap;
                    // this._updateSnapIndicator(snap, movement.endPosition);
                    // if (!this._startPos) return; // 起点未定：只做预览
                    this._movingPos = snap;
                    this._updateLabelAndLine();
                    return;
                }
            }
            // 4. 开启 Just 3D Tiles/CloudPoint ，开启 Point Cloud Snapping 
            else {
                let snap = this._snapPick(movement.endPosition);
                if (snap) {
                    console.log('move snap:', snap);
                    this._lastSnapCart = snap;
                    this._updateSnapIndicator(snap, movement.endPosition);
                    if (!this._startPos) return; // 起点未定：只做预览
                    this._movingPos = snap;
                    this._updateLabelAndLine();
                }
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);


        // 右键：取消本次测量
        this._handler.setInputAction(() => {
            this._cancel();
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        // ESC：取消
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

    private _withinSnapPixel(win: Cesium.Cartesian2): boolean {
        if (!this._lastSnapScreen) return false;
        const dx = win.x - this._lastSnapScreen.x;
        const dy = win.y - this._lastSnapScreen.y;
        return Math.hypot(dx, dy) <= (this._snapRadiusPx + 1);
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
                material: Cesium.Color.YELLOW,
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
                material: Cesium.Color.fromCssColorString("#f1c40f"),
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

        // 重置（修复二次测量沿用旧起点的 bug）
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

    // ===================== 吸附拾取（含预览小黄点） =====================
    /** 命中是否算 3D Tiles/点云等可吸附对象 */
    private _isTilesetPick(picked: any): boolean {
        if (!picked) return false;
        const p: any = picked.primitive || picked.content || picked.tileset || picked.owner || picked;
        return !!(p && (p.tileset || p._tileset || p._model || p instanceof Cesium.Cesium3DTileset));
    }

    /** 从屏幕点拾取三维点 （优先仅吸附 tileset/点云） */
    private _pickFromScreen(windowPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
        const scene = this.viewer.scene;
        const picked = scene.pick(windowPosition);

        if (this._snapTilesetsOnly) {
            if (!picked || !this._isTilesetPick(picked)) return undefined;
        } else {
            if (!picked) return undefined; // 若允许任意对象，至少要命中物体
        }

        if (scene.pickPositionSupported) {
            const c = scene.pickPosition(windowPosition);
            if (Cesium.defined(c)) return c as Cesium.Cartesian3;
        }
        // 不回落地表，避免“吸到地面”
        return undefined;
    }

    /** 吸附采样： 在像素半径内十字+圆环采样，命中则返回最近点 */
    private _snapPick(windowPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
        const radius = Math.max(1, Math.floor(this._snapRadiusPx));
        const center = windowPosition;

        // 中心优先
        const c0 = this._pickFromScreen(center);
        if (c0) return c0;

        const angles = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => (a * Math.PI) / 180);

        for (let r = 1; r <= radius; r++) {
            // 十字
            const cross = [
                new Cesium.Cartesian2(center.x + r, center.y),
                new Cesium.Cartesian2(center.x - r, center.y),
                new Cesium.Cartesian2(center.x, center.y + r),
                new Cesium.Cartesian2(center.x, center.y - r),
            ];
            for (const p of cross) {
                const cc = this._pickFromScreen(p);
                if (cc) return cc;
            }
            // 圆环
            for (const ang of angles) {
                const p = new Cesium.Cartesian2(center.x + r * Math.cos(ang), center.y + r * Math.sin(ang));
                const cc = this._pickFromScreen(p);
                if (cc) return cc;
            }
        }
        return undefined;
    }

    /** 主拾取入口 */
    private _pickPosition(windowPosition: Cesium.Cartesian2, forClick = false, isSnaping = false) {
        if (forClick) {
            const pick = this._pickPositionForClick(windowPosition);
            return {
                pos: pick.pos,
                interaction: 'click',
                isSnapping: pick.isSnapping
            }
        };
        return {
            pos: this._pickPositionForMove(windowPosition).pos,
            interaction: 'move',
            isSnapping: this._pickPositionForMove(windowPosition).isSnapping
        };
    }
    private _pickPositionForClick(windowPosition: Cesium.Cartesian2) {
        debugger;
        const cart = this._snapPick(windowPosition);
        debugger;
        if (cart) {console.log('_pickPositionForClick cart', cart); return { pos: cart, isSnapping: true } };
        // 1. 关闭 Just 3D Tiles/CloudPoint ，关闭 Point Cloud Snapping 
        if (this._snapEnabled && !this._snapTilesetsOnly) {
            return { pos: this._pickPositionCommon(windowPosition), isSnapping: false }; // 回退到常规拾取
        }
        // 2. 关闭 Just 3D Tiles/CloudPoint ，开启 Point Cloud Snapping
        else if(!this._snapStrict && this._snapEnabled) {
            if(this._lastSnapCart) return { pos: this._lastSnapCart, isSnapping: true };
            return { pos: this._pickPositionCommon(windowPosition), isSnapping: false };
        }
        // 3. 开启 Just 3D Tiles/CloudPoint ，关闭 Point Cloud Snapping 
        else if (this._snapStrict && !this._snapEnabled) {
            return { pos: undefined, isSnapping: false };
        }
        // 4. 开启 Just 3D Tiles/CloudPoint ，开启 Point Cloud Snapping
        else {
            return { pos: this._lastSnapCart, isSnapping: true };
        }
    }
    private _pickPositionForMove(windowPosition: Cesium.Cartesian2) {
        const cart = this._snapPick(windowPosition);
        if (cart) {
            this._lastSnapCart = cart;
            return {
                pos: cart,
                isSnapping: true,
            };
        };
        if (this._snapEnabled && !this._snapTilesetsOnly) {
            return { pos: this._pickPositionCommon(windowPosition), isSnapping: false }; // 回退到常规拾取
        }
        else if (this._snapStrict && !this._snapEnabled) {
            return { pos: undefined, isSnapping: false };
        }
        else {
            return { pos: this._lastSnapCart, isSnapping: true };
        }
    }
    private _pickPositionCommon(windowPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
        // 常规拾取 （允许回落地表）
        const scene = this.viewer.scene;
        if (scene.pickPositionSupported) {
            const c = scene.pickPosition(windowPosition);
            if (Cesium.defined(c)) return c as Cesium.Cartesian3;
        }
        const ray = this.viewer.camera.getPickRay(windowPosition);
        if (!ray || !scene.globe) return undefined;
        return scene.globe.pick(ray, scene);
    }

    // 吸附点 （小黄点）
    private _updateSnapIndicator(pos: Cesium.Cartesian3 | undefined, win?: Cesium.Cartesian2) {
        if (pos) {
            this._lastSnapCart = pos;
            if (win) this._lastSnapScreen = win.clone();
            this._lastSnapTs = performance.now();

            if (!this._snapIndicator) {
                this._snapIndicator = this.viewer.entities.add({
                    position: pos,
                    point: {
                        pixelSize: this._snapIndicatorSizePx,
                        color: Cesium.Color.fromCssColorString("#ffda3a"),
                        outlineColor: Cesium.Color.BLACK,
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
        snapWrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
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
        const tilesetOnlyChk = document.createElement("input");
        tilesetOnlyChk.type = "checkbox";
        tilesetOnlyChk.checked = this._snapTilesetsOnly;
        const tilesetOnlyLbl = document.createElement("span");
        tilesetOnlyLbl.textContent = "Just 3D Tiles/CloudPoint";
        tilesetWrap.appendChild(tilesetOnlyChk);
        tilesetWrap.appendChild(tilesetOnlyLbl);
        tilesetOnlyChk.addEventListener("change", () => {
            this._snapTilesetsOnly = tilesetOnlyChk.checked;
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
        // 如果已有提示框，先移除旧的
        const existing = document.getElementById("measure-hint");
        if (existing) existing.remove();

        // 创建提示框
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

        // 3 秒后淡出消失
        setTimeout(() => {
            hint.style.opacity = "0";
            setTimeout(() => hint.remove(), 300);
        }, 6 * 1000);
    }

    // ===================== 工具 =====================
    private _toast(msg: string) {
        console.log(`[MeasureTool] ${msg}`);
    }

}
