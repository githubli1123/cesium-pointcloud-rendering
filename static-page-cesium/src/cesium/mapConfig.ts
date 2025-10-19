// map.config.js

// 设置 cesium 静态资源目录
(Window as any).CESIUM_BASE_URL = "/";

// 地图配置项
export const mapOptionsBase = async () => {
    return {
        infoBox: false, // 右侧信息框
        selectionIndicator: false, //选中状态
        // imageryProvider: tiandituImageryProvider , // 设置影像地图
        // terrainProvider: await Cesium.createWorldTerrainAsync({
        //   requestVertexNormals: true, //可以增加法线，用于提高光照效果
        //   requestWaterMask: true, // 水面特效
        // }), // 地形图层
        scene3DOnly: false, // 3D视图
        timeline: false, //时间轴控件
        animation: false, //动画控件
        geocoder: false, //搜索控件
        homeButton: false, //主页控件
        sceneModePicker: false, //投影控件
        baseLayerPicker: false, //图层控件
        navigationHelpButton: false, //帮助控件
        fullscreenButton: false, //全屏控件
        // 设置天空盒
        // skyBox: new Cesium.SkyBox({
        //     sources: {
        //         positiveX: "./texture/sky/px.jpg",
        //         negativeX: "./texture/sky/nx.jpg",
        //         positiveY: "./texture/sky/ny.jpg",
        //         negativeY: "./texture/sky/py.jpg",
        //         positiveZ: "./texture/sky/pz.jpg",
        //         negativeZ: "./texture/sky/nz.jpg",
        //     },
        // }),
    };
};

// 禁用 3D 地球模式
export const mapOptionsDisable3DEarth = async () => {
    return {
        // 1. 禁用地球表面
        globe: false,

        // 2. 禁用天空盒和大气效果
        skyBox: false,
        skyAtmosphere: false,

        // 3. 禁用基础图层
        imageryProvider: false,

        // 4. 禁用地形
        terrainProvider: false,

        infoBox: false, // 右侧信息框
        selectionIndicator: false, //选中状态

        scene3DOnly: false, // 3D视图
        timeline: false, //时间轴控件
        animation: false, //动画控件
        geocoder: false, //搜索控件
        homeButton: false, //主页控件
        sceneModePicker: false, //投影控件
        baseLayerPicker: false, //图层控件
        navigationHelpButton: false, //帮助控件
        fullscreenButton: false, //全屏控件
    };
};