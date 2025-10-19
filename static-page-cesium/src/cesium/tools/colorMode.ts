import * as Cesium from 'cesium';

// 当前颜色模式
type ColorMode = 'rgb' | 'height';
const COLOR_MODE = {
  RGB: 'rgb',
  HEIGHT: 'height',
} as const;
type ColorModeKeys = keyof typeof COLOR_MODE;

export default class ColorModeController {
  tileset: Cesium.Cesium3DTileset;
  currentColorMode: ColorMode = COLOR_MODE.HEIGHT;
  constructor(tileset: Cesium.Cesium3DTileset) {
    this.createColorModeToolbar();
    this.tileset = tileset;
    this.currentColorMode = COLOR_MODE.HEIGHT;
    this.setPointCloudColorMode(this.currentColorMode);
  }
  setPointCloudColorMode(mode?: ColorMode) {
    mode = mode || this.currentColorMode;
    let tileset = this.tileset;
    if (!tileset) return;

    // 不同模式的样式定义
    let style;
    switch (mode) {
      case COLOR_MODE.RGB:
        // 若点云有 Red/Green/Blue 属性（0~255）
        style = new Cesium.Cesium3DTileStyle({
          color: "rgb(${Red}, ${Green}, ${Blue})",
        });
        break;

      case COLOR_MODE.HEIGHT:
        // 用 POSITION 的 Z 值着色（示例：低蓝，高红）
        // 使用 defines + conditions 提高性能
        style = new Cesium.Cesium3DTileStyle({
          defines: {
            height: "${POSITION}[2]",
          },
          color: {
            conditions:
              [
                ["${height} < -500", "rgba(0, 30, 80, 1)"],        // 深海蓝
                ["${height} < 0", "rgba(0, 60, 160, 0.9)"],     // 海蓝
                ["${height} < 2", "rgba(0, 120, 60, 1)"],       // 低地绿
                ["${height} < 4", "rgba(60, 180, 75, 0.9)"],    // 草地绿
                ["${height} < 6", "rgba(180, 210, 60, 1)"],     // 黄绿过渡
                ["${height} < 8", "rgba(240, 220, 60, 0.9)"],   // 沙黄
                ["${height} < 10", "rgba(255, 165, 0, 1)"],      // 橙色丘陵
                ["${height} < 12", "rgba(255, 110, 0, 0.9)"],    // 橙红
                ["${height} < 14", "rgba(255, 60, 60, 1)"],      // 红色山地
                ["${height} < 16", "rgba(200, 40, 120, 0.9)"],   // 红紫山脊
                ["${height} < 18", "rgba(160, 60, 200, 1)"],     // 紫色高原
                ["${height} < 20", "rgba(180, 100, 220, 0.9)"],  // 紫粉
                ["${height} < 22", "rgba(200, 160, 255, 1)"],    // 浅紫雪线
                ["${height} < 24", "rgba(230, 230, 255, 0.9)"],  // 淡蓝雪面
                ["${height} < 26", "rgba(255, 255, 255, 0.95)"], // 雪顶
                ["true", "rgba(255, 255, 255, 1)"]
              ],
          },
        });
        break;

      default:
        console.warn("未知模式:", mode);
        return;
    }

    tileset.style = style;
    console.log("已切换点云颜色模式:", mode);
  }

  setMode(mode: ColorModeKeys) {
    this.currentColorMode = COLOR_MODE[mode];
    this.setPointCloudColorMode(this.currentColorMode);
  }
  createColorModeToolbar() {
    const existing = document.getElementById('cesium-color-mode-toolbar');
    if (existing) {
      existing.remove();
    }

    const toolbar = document.createElement('div');
    toolbar.id = 'cesium-color-mode-toolbar';
    toolbar.style.cssText = `
        position: absolute;
        top: 60px;
        left: 10px;
        z-index: 10;
        background: rgba(0, 0, 0, 0.6);
        padding: 8px;
        border-radius: 6px;
        color: white;
        font-size: 14px;
    `;

    const label = document.createElement('span');
    label.textContent = 'Color Mode:';
    label.style.marginRight = '6px';

    const select = document.createElement('select');
    select.style.cssText = `
        padding: 4px 8px;
        font-size: 14px;
        background: #333;
        color: white;
        border: 1px solid #555;
        border-radius: 4px;
        cursor: pointer;
    `;

    const options = [
      { value: 'rgb', text: 'RGB' },
      { value: 'height', text: 'Height' }
    ];

    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.text;
      select.appendChild(el);
    });

    select.value = this.currentColorMode;
    select.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.currentColorMode = target.value as any;
      this.setPointCloudColorMode();
    });

    toolbar.appendChild(label);
    toolbar.appendChild(select);
    document.body.appendChild(toolbar);
    this.setPointCloudColorMode();
  }
}
