import { echarts, makeOptions } from "./chart.js";

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Both formats use the same ECharts option builder as the live chart.
// A fixed 1200px layout keeps type and line weights consistent across PNG sizes.
export async function exportChart(format, settings, series, zoom) {
  if (!series.some((item) => item.visible && item.stats.count))
    throw new Error("请先选择至少一条包含有效数据的曲线。");
  const targetWidth = Number(settings.exportWidth);
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1200px;height:720px;pointer-events:none";
  document.body.append(host);
  const instance = echarts.init(host, null, {
    renderer: format === "svg" ? "svg" : "canvas",
    width: 1200,
    height: 720,
    devicePixelRatio: format === "png" ? targetWidth / 1200 : 1,
  });
  try {
    instance.setOption(
      makeOptions(settings, series, { width: 1200, zoom, exporting: true }),
    );
    const filename = (settings.title || "metrics")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .slice(0, 100);
    let blob;
    if (format === "svg") {
      blob = new Blob([instance.renderToSVGString()], {
        type: "image/svg+xml;charset=utf-8",
      });
    } else {
      const canvas = instance.renderToCanvas({
        pixelRatio: targetWidth / 1200,
        backgroundColor: "#fff",
      });
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG 导出失败，请尝试较小的图片尺寸。");
    }
    download(blob, `${filename}.${format}`);
  } finally {
    instance.dispose();
    host.remove();
  }
}
