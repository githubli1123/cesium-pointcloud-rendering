// 加载基础底图 服务
import * as Cesium from "cesium";

// 天地图 KEY
const TDT_KEY = "YOU KEY";

// 加载天地图 影像底图
export const tiandituImageryProvider =
    new Cesium.WebMapTileServiceImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/img_w/wmts?tk=${TDT_KEY}`,
        layer: "img",
        style: "default",
        format: "tiles",
        tileMatrixSetID: "w",
        subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
        maximumLevel: 18,
    });

// 加载天地图 影像注记
export const tiandituAnnotationProvider =
    new Cesium.WebMapTileServiceImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/cia_w/wmts?tk=${TDT_KEY}`,
        layer: "cia",
        style: "default",
        format: "tiles",
        tileMatrixSetID: "w",
        subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
        maximumLevel: 18,
    });

// 加载天地图 矢量底图
export const tiandituVectorProvider =
    new Cesium.WebMapTileServiceImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/vec_w/wmts?tk=${TDT_KEY}`,
        layer: "vec",
        style: "default",
        format: "tiles",
        tileMatrixSetID: "w",
        subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
        maximumLevel: 18,
    });

// 加载天地图 矢量标记
export const tiandituVectorAnnotationProvider =
    new Cesium.WebMapTileServiceImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/cva_w/wmts?tk=${TDT_KEY}`,
        layer: "cva",
        style: "default",
        format: "tiles",
        tileMatrixSetID: "w",
        subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
        maximumLevel: 18,
    });
