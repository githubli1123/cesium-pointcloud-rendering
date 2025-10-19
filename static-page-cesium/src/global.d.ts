import * as Cesium from "cesium";
// global.d.ts
declare global {
  interface Window {
    
    CESIUM_BASE_URL?: string; // 可选，类型为 string
  }
}

// 如果你在模块文件中使用（即文件里有 import/export），需要导出空对象
export {};