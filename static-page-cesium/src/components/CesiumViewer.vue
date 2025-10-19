<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { mapDestroy, mapInit } from "../cesium/map";

onMounted(() => {
  mapInit();
});

onUnmounted(() => {
  mapDestroy();
});

</script>

<template>
  <div id="cesiumContainer"></div>
</template>

<style scoped>
#cesiumContainer {
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  display: block;
}
</style>
