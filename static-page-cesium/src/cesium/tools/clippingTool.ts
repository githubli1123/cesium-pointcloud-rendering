// tools/clippingTool.ts
import * as Cesium from "cesium";

export type ClippingType = "rect" | "polygon" | undefined;

export interface ClippingToolOptions {
  /** 是否创建工具栏；默认 true（注意：工具栏样式与位置均已写死） */
  toolbar?: boolean;
  /** 初始是否反转裁剪（显示外部）；默认 false */
  defaultInverse?: boolean;
  /** 是否注册 ESC 退出/右键完成等快捷操作；默认 true */
  hotkeys?: boolean;
}

export default class ClippingTool {
  public viewer: Cesium.Viewer;
  public tileset: Cesium.Cesium3DTileset | undefined;

  static readonly MODE = {
    RECT: "rect" as const,
    POLYGON: "polygon" as const,
    NONE: undefined as undefined,
  };

  // —— 状态 —— //
  public currentClippingType: ClippingType | undefined = undefined;
  public isInverse = false;
  private isRectMode = false; // 仅矩形模式需要用到的标记
  private stopPolygon: (() => void) | undefined = undefined; // 多边形闭包的关闭器

  // —— 矩形相关 —— //
  public rectHandler: Cesium.ScreenSpaceEventHandler | undefined = undefined;
  public rectStart: Cesium.Cartesian2 | undefined = undefined;
  public rectOverlay: HTMLDivElement | undefined = undefined;

  // —— 结果可视化（可选保留，便于被 clear 清理） —— //
  public polyResultEntity: Cesium.Entity | undefined = undefined;

  // —— 工具栏 —— //
  public toolbarEl: HTMLDivElement | undefined = undefined;

  // —— 固定写死的样式/ID —— //
  private readonly TB_ID = "cesium-clipping-toolbar";
  private readonly TB_STYLE_ID = "cesium-clipping-toolbar-style";

  // —— 事件回调绑定引用（用于 removeEventListener） —— //
  private onEscKeyDownBound: (e: KeyboardEvent) => void;

  constructor(
    viewer: Cesium.Viewer,
    tileset: Cesium.Cesium3DTileset | undefined = undefined,
    options: ClippingToolOptions = {}
  ) {
    this.viewer = viewer;
    this.tileset = tileset;

    const { toolbar = true, defaultInverse = false, hotkeys = true } = options;
    this.isInverse = defaultInverse;

    // 绑定同一引用，便于注销
    this.onEscKeyDownBound = this.onEscKeyDown.bind(this);

    if (toolbar) this.createToolbar();
    if (hotkeys) document.addEventListener("keydown", this.onEscKeyDownBound);

    // 与 Sandcastle 一致：禁用双击默认飞行，避免绘制时误触
    this.viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
  }

  /** 创建工具栏（已写死：挂载 document.body；固定位置/样式/文案） */
  public createToolbar(): void {
    const existing = document.getElementById(this.TB_ID) as HTMLDivElement | undefined;
    if (existing) existing.remove();

    const mountEl: HTMLElement = document.body;

    const toolbar = document.createElement("div");
    toolbar.id = this.TB_ID;
    toolbar.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 10;
      background: rgba(0,0,0,0.6);
      padding: 8px;
      border-radius: 6px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    `;

    function mkBtn(text: string, bg: string): HTMLButtonElement {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.style.cssText = `
        padding: 6px 12px;
        font-size: 14px;
        cursor: pointer;
        border: none;
        border-radius: 4px;
        background: ${bg};
        color: #fff;
      `;
      return btn;
    }

    const rectBtn = mkBtn("Start Rectangular Clipping", "#76b1f0");
    rectBtn.dataset.role = "rect";
    rectBtn.addEventListener("click", this.startRectMode.bind(this));

    const polyBtn = mkBtn("Start Polygon Clipping", "#81bc83");
    polyBtn.dataset.role = "polygon";
    polyBtn.addEventListener("click", this.startPolygonMode.bind(this));

    const inverseBtn = mkBtn(
      this.isInverse ? "Reverse Clipping (External)" : "Reverse Clipping (Internal)",
      "#d7b481"
    );
    inverseBtn.dataset.role = "inverse";
    inverseBtn.addEventListener("click", this.toggleInverse.bind(this));

    const clearBtn = mkBtn("Clear Clipping", "#818b94");
    clearBtn.dataset.role = "clear";
    clearBtn.addEventListener("click", this.clearAll.bind(this));

    toolbar.append(rectBtn, polyBtn, inverseBtn, clearBtn);
    mountEl.appendChild(toolbar);

    if (!document.getElementById(this.TB_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = this.TB_STYLE_ID;
      style.textContent = `
        #${this.TB_ID} button.active {
          background: #4fc3f7 !important;
          font-weight: bold;
          box-shadow: 0 0 0 2px white;
        }
      `;
      document.head.appendChild(style);
    }

    this.toolbarEl = toolbar;
    this.updateToolbar();
  }

  /** —— UI 状态同步（固定选择器） —— */
  public updateToolbar(): void {
    if (!this.toolbarEl) return;
    const rectBtn = this.toolbarEl.querySelector('button[data-role="rect"]');
    const polyBtn = this.toolbarEl.querySelector('button[data-role="polygon"]');
    const inverseBtn = this.toolbarEl.querySelector('button[data-role="inverse"]') as
      | HTMLButtonElement
      | undefined;

    rectBtn?.classList.toggle("active", this.currentClippingType === ClippingTool.MODE.RECT);
    polyBtn?.classList.toggle("active", this.currentClippingType === ClippingTool.MODE.POLYGON);

    if (inverseBtn) {
      inverseBtn.textContent = this.isInverse
        ? "Reverse Clipping (External)"
        : "Reverse Clipping (Internal)";
    }
  }

  // ====================================== 矩形模式 ======================================== //
  public startRectMode(): void {
    if (!this.tileset) {
      console.warn("请先绑定 tileset 再进入矩形裁剪模式");
      return;
    }
    if (this.currentClippingType) {
      console.warn("已有裁剪模式进行中，请先完成或清理后再开始矩形裁剪");
      return;
    }

    // 关闭正在进行的多边形流程
    if (this.stopPolygon) this.stopPolygon();

    this.resetOnlyClipping(); // 清掉已有 clipping，但不动 tileset 引用
    this.isRectMode = true;
    this.currentClippingType = ClippingTool.MODE.RECT;
    this.isInverse = false;
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;

    this.rectHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.canvas);
    this.rectHandler.setInputAction(
      this.onRectLeftDown.bind(this),
      Cesium.ScreenSpaceEventType.LEFT_DOWN
    );
    this.updateToolbar();
  }

  public onRectLeftDown(ev: Cesium.ScreenSpaceEventHandler.PositionedEvent): void {
    this.rectStart = ev.position.clone();

    if (!this.rectOverlay) {
      const div = document.createElement("div");
      div.style.cssText = `
        position: absolute;
        border: 2px dashed #00ffff;
        background-color: rgba(0,255,255,0.1);
        pointer-events: none;
        z-index: 999;
      `;
      document.body.appendChild(div);
      this.rectOverlay = div;
    }

    const move = (mv: Cesium.ScreenSpaceEventHandler.MotionEvent) =>
      this.onRectMouseMove(mv);
    const up = (upEv: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      this.onRectLeftUp(upEv);
      this.rectHandler?.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      this.rectHandler?.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_UP);
    };

    this.rectHandler?.setInputAction(move, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.rectHandler?.setInputAction(up, Cesium.ScreenSpaceEventType.LEFT_UP);
  }

  public onRectMouseMove(mv: Cesium.ScreenSpaceEventHandler.MotionEvent): void {
    if (!this.rectStart || !this.rectOverlay) return;
    const end = mv.endPosition;
    const x1 = Math.min(this.rectStart.x, end.x);
    const y1 = Math.min(this.rectStart.y, end.y);
    const width = Math.abs(end.x - this.rectStart.x);
    const height = Math.abs(end.y - this.rectStart.y);
    Object.assign(this.rectOverlay.style, {
      left: `${x1}px`,
      top: `${y1}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  public async onRectLeftUp(
    upEv: Cesium.ScreenSpaceEventHandler.PositionedEvent
  ): Promise<void> {
    if (!this.rectStart || !this.tileset) {
      this.resetRectState();
      return;
    }
    try {
      await this.applyRectAsClippingPolygon(this.rectStart, upEv.position);
      console.log("✅ 矩形裁剪（作为多边形）已应用");
    } catch (e) {
      console.error("矩形裁剪失败：", e);
    } finally {
      this.resetRectState();
    }
  }

  public async applyRectAsClippingPolygon(
    start: Cesium.Cartesian2,
    end: Cesium.Cartesian2
  ): Promise<void> {
    if (!this.tileset) return;

    const { scene, camera } = this.viewer;
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);

    const screenCorners = [
      new Cesium.Cartesian2(x1, y1),
      new Cesium.Cartesian2(x2, y1),
      new Cesium.Cartesian2(x2, y2),
      new Cesium.Cartesian2(x1, y2),
    ];

    const worldPoints: Cesium.Cartesian3[] = [];
    for (const sp of screenCorners) {
      // 优先 pickPosition（需要深度缓冲支持），退化到射线方向的“半径比例点”
      let world = scene.pickPosition(sp);
      if (!world) {
        const ray = camera.getPickRay(sp);
        if (ray) world = Cesium.Ray.getPoint(ray, this.tileset.boundingSphere.radius * 0.5);
      }
      if (world) worldPoints.push(world);
    }

    if (worldPoints.length < 4) {
      console.warn("⚠️ 无法确定裁剪矩形四角世界坐标，请确保模型在视野中。");
      return;
    }

    this.applyClippingPolygons([worldPoints]);
    this.drawPolygonResult(worldPoints);
  }

  public resetRectState(): void {
    this.isRectMode = false;
    this.currentClippingType = ClippingTool.MODE.NONE;
    this.rectStart = undefined;
    if (this.rectOverlay) {
      this.rectOverlay.remove();
      this.rectOverlay = undefined;
    }
    if (this.rectHandler) {
      this.rectHandler.destroy();
      this.rectHandler = undefined;
    }
    this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    this.updateToolbar();
  }

  // ========================================= 多边形模式 ===================================== //
  public startPolygonMode(): void {
    if (!this.tileset) {
      console.warn("请先绑定 tileset 再进入多边形裁剪模式");
      return;
    }
    if (this.currentClippingType) {
      console.warn("已有裁剪模式进行中，请先完成或清理后再开始多边形裁剪");
      return;
    }

    // 若已有绘制流程在跑，先关掉
    if (this.stopPolygon) this.stopPolygon();

    this.currentClippingType = ClippingTool.MODE.POLYGON;
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    this.updateToolbar();

    // —— 局部状态（全部闭包内）—— //
    const viewer = this.viewer;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    const points: Cesium.Cartesian3[] = []; // 固定顶点
    const vertices: Cesium.Entity[] = []; // 白色顶点点实体
    let floating: Cesium.Entity | undefined; // 鼠标跟随点
    let preview: Cesium.Entity | undefined; // 预览（填充+边框）
    let hover: Cesium.Cartesian3 | undefined; // 当前鼠标位置（占位点）
    const self = this;

    function ensurePreview(): void {
      if (preview) return;

      const dynamicHierarchy = new Cesium.CallbackProperty(() => {
        if (points.length === 0) return undefined;
        const arr = hover ? [...points, hover] : points;
        return new Cesium.PolygonHierarchy(arr);
      }, false);

      const dynamicLine = new Cesium.CallbackProperty(() => {
        if (points.length === 0) return [];
        const arr = hover ? [...points, hover] : points;
        return arr;
      }, false);

      preview = viewer.entities.add({
        polygon: {
          hierarchy: dynamicHierarchy,
          material: Cesium.Color.CYAN.withAlpha(0.18),
        },
        polyline: {
          positions: dynamicLine,
          width: 2,
          material: Cesium.Color.CYAN,
          clampToGround: true,
        },
      });
    }

    function finish(apply: boolean): void {
      if (apply && points.length >= 3) {
        const fixed = [...points]; // 不含 hover，占位不入列
        // 结果可视化（静态）
        if (self.polyResultEntity) {
          viewer.entities.remove(self.polyResultEntity);
          self.polyResultEntity = undefined;
        }
        self.polyResultEntity = viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(fixed),
            material: Cesium.Color.CYAN.withAlpha(0.28),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
          },
        });
        try {
          self.applyClippingPolygons([fixed]);
          console.log("✅ ClippingPolygon 裁剪已应用，并显示区域");
        } catch (err) {
          console.error("ClippingPolygon 应用失败:", err);
        }
      }

      // 事件 & 实体清理
      handler.destroy();
      window.removeEventListener("keydown", keydown);
      if (floating) viewer.entities.remove(floating);
      if (preview) viewer.entities.remove(preview);
      vertices.forEach((v) => viewer.entities.remove(v));

      // 复位 UI
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      self.currentClippingType = ClippingTool.MODE.NONE;
      self.stopPolygon = undefined;
      self.updateToolbar();
    }

    function keydown(e: KeyboardEvent): void {
      if (e.key === "Escape") finish(false);
    }

    handler.setInputAction(function (
      ev: Cesium.ScreenSpaceEventHandler.PositionedEvent
    ) {
      const pos = self.getWorldPositionFromScreen(ev.position);
      if (!pos) return;

      if (!floating) {
        floating = viewer.entities.add({
          position: pos,
          point: { color: Cesium.Color.CYAN, pixelSize: 8 },
        });
        ensurePreview();
      }

      points.push(pos);
      vertices.push(
        viewer.entities.add({
          position: pos,
          point: { color: Cesium.Color.WHITE, pixelSize: 5 },
        })
      );
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(function (
      mv: Cesium.ScreenSpaceEventHandler.MotionEvent
    ) {
      if (!floating) return;
      const pos = self.getWorldPositionFromScreen(mv.endPosition);
      if (!pos) return;
      floating.position.setValue(pos);
      hover = pos; // 只更新占位点，不修改 points
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function () {
      finish(true);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    window.addEventListener("keydown", keydown);

    // 暴露单一关闭器给 ESC/clearAll 调用
    this.stopPolygon = function () {
      finish(false);
    };

    this.updateToolbar();
  }

  // ====================== 反转裁剪 / 清理 / 销毁 ======================
  public toggleInverse(): void {
    if (!this.tileset) {
      console.warn("请先绑定 tileset");
      return;
    }
    // 允许随时切换 inverse（即便 currentClippingType 已复位）
    this.isInverse = !this.isInverse;
    const polys = this.tileset.clippingPolygons;
    if (polys) polys.inverse = this.isInverse;
    console.log(`✅ 裁剪已${this.isInverse ? "反转（显示外部）" : "恢复正常（显示内部）"}`);
    this.updateToolbar();
  }

  public clearAll(): void {
    // 先结束多边形流程（否则内部 handler 悬挂）
    const stop = this.stopPolygon;
    if (stop) stop();

    // 再清空裁剪 & 可视化
    this.resetOnlyClipping();

    // 最后复位矩形流程
    this.resetRectState();

    console.log("✅ 所有裁剪及绘制图形已清除");
  }

  public destroy(): void {
    this.clearAll();
    document.removeEventListener("keydown", this.onEscKeyDownBound);
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = undefined;
    }
  }

  // ====================== 内部工具函数 ======================
  public onEscKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (this.isRectMode) this.resetRectState();
    if (this.stopPolygon) this.stopPolygon(); // 统一关闭多边形
  }

  public resetOnlyClipping(): void {
    this.currentClippingType = ClippingTool.MODE.NONE;
    this.isInverse = false;

    if (this.tileset) {
      // 兼容：清空 clippingPlanes
      this.tileset.clippingPlanes = new Cesium.ClippingPlaneCollection({
        planes: [],
        enabled: false,
      });
      // 清空 polygon 版裁剪
      this.tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
        polygons: [],
        enabled: false,
        inverse: false,
      });
    }

    if (this.polyResultEntity) {
      this.viewer.entities.remove(this.polyResultEntity);
      this.polyResultEntity = undefined;
    }

    if (this.rectOverlay) {
      this.rectOverlay.remove();
      this.rectOverlay = undefined;
    }

    this.updateToolbar();
  }

  public applyClippingPolygons(polygonsPositions: Cesium.Cartesian3[][]): void {
    if (!this.tileset) return;
    const polygons = polygonsPositions.map(
      (positions) => new Cesium.ClippingPolygon({ positions })
    );
    this.tileset.clippingPolygons = new Cesium.ClippingPolygonCollection({
      polygons,
      enabled: true,
      inverse: this.isInverse,
    });
  }

  public drawPolygonResult(positions: Cesium.Cartesian3[]): void {
    if (this.polyResultEntity) {
      this.viewer.entities.remove(this.polyResultEntity);
      this.polyResultEntity = undefined;
    }
    this.polyResultEntity = this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.CYAN.withAlpha(0.3),
        outline: true,
        outlineColor: Cesium.Color.CYAN,
      },
    });
    this.updateToolbar();
  }

  /** 屏幕坐标 -> 世界坐标（优先地形/深度，退化到椭球/包围球高度） */
  public getWorldPositionFromScreen(
    screenPos: Cesium.Cartesian2
  ): Cesium.Cartesian3 | undefined {
    const { camera, scene } = this.viewer;
    const ray = camera.getPickRay(screenPos);
    if (!ray) return undefined;

    // 先尝试与地表/3D Tiles 的精确拾取
    let position = scene.globe.pick(ray, scene);
    if (!position) {
      // 退化：椭球拾取
      position = camera.pickEllipsoid(screenPos, scene.globe.ellipsoid);
    }
    if (!position && this.tileset) {
      // 仍失败：对准椭球点但改用 tileset 中心的高度作为回退
      const centerCarto = Cesium.Cartographic.fromCartesian(this.tileset.boundingSphere.center);
      const ellipsoidPos = camera.pickEllipsoid(screenPos, scene.globe.ellipsoid);
      if (ellipsoidPos) {
        const c = Cesium.Cartographic.fromCartesian(ellipsoidPos);
        position = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, centerCarto.height);
      } else {
        position = Cesium.Cartesian3.clone(this.tileset.boundingSphere.center);
      }
    }

    if (
      position &&
      !isNaN(position.x) &&
      !isNaN(position.y) &&
      !isNaN(position.z) &&
      Cesium.Cartesian3.magnitude(position) > 0
    ) {
      return position;
    }
    return undefined;
  }
}
