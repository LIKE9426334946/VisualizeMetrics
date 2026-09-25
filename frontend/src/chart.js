import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkPointComponent,
  DataZoomComponent,
  AriaComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { escapeHTML } from "./utils.js";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkPointComponent,
  DataZoomComponent,
  AriaComponent,
  CanvasRenderer,
  SVGRenderer,
]);
export { echarts };

function marks(series, index) {
  let kinds =
    series.extreme === "both"
      ? ["max", "min"]
      : series.extreme === "none"
        ? []
        : [series.extreme];
  if (
    series.extreme === "both" &&
    series.stats.max?.value[1] === series.stats.min?.value[1]
  )
    kinds = ["both"];
  return kinds.flatMap((kind) => {
    const point = series.stats[kind === "both" ? "max" : kind];
    if (!point) return [];
    const label =
      kind === "both" ? "Max / Min" : kind === "max" ? "Max" : "Min";
    const middle =
      (series.points[0].value[0] + series.points.at(-1).value[0]) / 2;
    return [
      {
        name: label,
        coord: point.value,
        value: point.value[1],
        rawX: point.rawX,
        rawY: point.rawY,
        label: {
          position: "top",
          align: point.value[0] > middle ? "right" : "left",
          offset: [0, -(index % 3) * 6],
          formatter: `${label}\nepoch = ${point.rawX}\nvalue = ${point.rawY.trim()}`,
          fontSize: 11,
          lineHeight: 16,
          color: series.color,
          backgroundColor: "rgba(255,255,255,0.96)",
          padding: [5, 7],
          borderRadius: 5,
          borderColor: "#e4e8f0",
          borderWidth: 1,
        },
      },
    ];
  });
}

function tooltip(params) {
  const list = Array.isArray(params) ? params : [params];
  const first = list.find((item) => item.data?.rawX != null);
  if (!first) return "";
  return (
    `<div style="font-size:12px;color:#68778f;margin-bottom:9px">epoch = ${escapeHTML(first.data.rawX)}</div>` +
    list
      .map((item) => {
        if (!item.data) return "";
        const value = item.data.rawY?.trim() || "—";
        return `<div style="display:flex;gap:20px;justify-content:space-between;margin:5px 0"><span>${item.marker ?? ""}${escapeHTML(item.seriesName)}</span><strong style="font-family:monospace">${escapeHTML(value)}</strong></div>`;
      })
      .join("")
  );
}

export function makeOptions(
  settings,
  series,
  { width = 1000, zoom = [0, 100], exporting = false } = {},
) {
  const mobile = width < 600;
  const selected = Object.fromEntries(
    series.map((item) => [item.name, item.visible]),
  );
  let legendRows = 1;
  if (exporting) {
    let remaining = 0;
    for (const item of series.filter((item) => item.visible)) {
      const length = item.name.length * 7 + 48;
      if (remaining && remaining + length > width - 100) {
        legendRows++;
        remaining = 0;
      }
      remaining += length;
    }
  }
  const plotted = exporting ? series.filter((item) => item.visible) : series;
  const hasMarks = plotted.some(
    (item) => item.visible && item.extreme !== "none",
  );
  return {
    animation: false,
    backgroundColor: "#ffffff",
    textStyle: {
      fontFamily:
        'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
    },
    aria: { enabled: true },
    title: {
      text: settings.title,
      left: mobile ? 14 : 26,
      top: 18,
      textStyle: {
        fontSize: mobile ? 16 : 19,
        fontWeight: 600,
        color: "#1b2943",
        width: width - 40,
        overflow: "truncate",
      },
    },
    grid: {
      left: mobile ? 59 : 83,
      right: mobile ? 27 : 52,
      top: settings.legend
        ? (hasMarks ? 170 : 106) + (legendRows - 1) * 24
        : hasMarks
          ? 150
          : 80,
      bottom: exporting ? 75 : 100,
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: tooltip,
      renderMode: "html",
      backgroundColor: "#fff",
      borderColor: "#e1e7f0",
      padding: [12, 16],
      textStyle: { color: "#2b3850", fontSize: 13 },
      extraCssText:
        "border-radius:9px;box-shadow:0 8px 30px #102b5120;max-width:calc(100% - 20px);white-space:normal;word-break:break-word",
      axisPointer: {
        type: "line",
        lineStyle: { type: "dashed", color: "#a8b6d0" },
      },
    },
    legend: {
      show: settings.legend,
      type: exporting ? "plain" : "scroll",
      top: 59,
      left: mobile ? 18 : 30,
      right: 25,
      icon: "roundRect",
      itemWidth: 17,
      itemHeight: 3,
      itemGap: 24,
      selected,
      textStyle: { color: "#52627b", fontSize: 12 },
      pageIconSize: 10,
    },
    xAxis: {
      type: "value",
      name: settings.xLabel,
      nameLocation: "middle",
      nameGap: 32,
      min: "dataMin",
      max: "dataMax",
      minInterval: 0,
      axisLine: { lineStyle: { color: "#d6dfeb" } },
      axisTick: { show: false },
      axisLabel: { color: "#7a879c", fontSize: 12, hideOverlap: true },
      nameTextStyle: { color: "#63708a", fontSize: 13 },
      splitLine: {
        show: settings.grid,
        lineStyle: { color: "#eff2f7", type: "dashed" },
      },
    },
    yAxis: {
      type: "value",
      name: settings.yLabel,
      nameLocation: "middle",
      nameGap: mobile ? 41 : 57,
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#7a879c", fontSize: 12, hideOverlap: true },
      nameTextStyle: { color: "#63708a", fontSize: 13 },
      splitNumber: 5,
      splitLine: {
        show: settings.grid,
        lineStyle: { color: "#e9edf4", type: "dashed" },
      },
    },
    dataZoom: [
      {
        id: "inside",
        type: "inside",
        xAxisIndex: 0,
        start: zoom[0],
        end: zoom[1],
        filterMode: "none",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
      },
      {
        id: "slider",
        type: "slider",
        show: !exporting,
        xAxisIndex: 0,
        start: zoom[0],
        end: zoom[1],
        filterMode: "none",
        bottom: 18,
        height: 21,
        left: mobile ? 60 : 84,
        right: mobile ? 27 : 52,
        showDetail: false,
        brushSelect: false,
        borderColor: "#e9edf4",
        backgroundColor: "#f7f9fc",
        fillerColor: "rgba(53,99,233,0.08)",
        dataBackground: {
          lineStyle: { color: "#c4d1ec" },
          areaStyle: { color: "#edf1fa" },
        },
        handleStyle: { color: "#fff", borderColor: "#aebfde" },
        moveHandleSize: 0,
      },
    ],
    series: plotted.map((item, index) => ({
      id: item.id,
      name: item.name,
      type: "line",
      data: item.points,
      encode: { x: 0, y: 1 },
      connectNulls: false,
      smooth: false,
      showSymbol:
        settings.points || item.points.some((point) => point.isolated),
      symbol: "circle",
      symbolSize: (_, params) =>
        settings.points || item.points[params.dataIndex]?.isolated
          ? Math.max(4, settings.lineWidth + 2)
          : 0,
      lineStyle: { width: settings.lineWidth, color: item.color },
      itemStyle: { color: item.color },
      emphasis: { focus: "series", scale: true },
      markPoint: {
        symbol: "circle",
        symbolSize: 9,
        itemStyle: { color: item.color, borderColor: "#fff", borderWidth: 2 },
        data: marks(item, index),
      },
    })),
  };
}

export function createChart(element, onLegend, onViewChange = () => {}) {
  const instance = echarts.init(element, null, { renderer: "canvas" });
  let zoom = [0, 100];
  let legendScroll = 0;
  let currentSettings,
    currentSeries = [];
  instance.on("legendselectchanged", (event) => onLegend(event.selected));
  instance.on("datazoom", () => {
    const options = instance.getOption().dataZoom[0];
    zoom = [options.start, options.end];
    onViewChange();
  });
  instance.on("legendscroll", (event) => {
    legendScroll = event.scrollDataIndex;
    onViewChange();
  });
  const update = (settings, series, reset = false) => {
    if (reset) zoom = [0, 100];
    currentSettings = settings;
    currentSeries = series;
    const option = makeOptions(settings, series, {
      width: element.clientWidth,
      zoom,
    });
    option.legend.scrollDataIndex = legendScroll;
    instance.setOption(option, { notMerge: true });
  };
  const observer = new ResizeObserver(() => {
    instance.resize();
    if (currentSettings) update(currentSettings, currentSeries);
  });
  observer.observe(element);
  return {
    instance,
    update,
    getZoom: () => [...zoom],
    getView: () => ({ zoom: [...zoom], legendScroll }),
    restoreView: (view) => {
      if (
        Array.isArray(view?.zoom) &&
        view.zoom.length === 2 &&
        view.zoom.every((n) => Number.isFinite(n) && n >= 0 && n <= 100) &&
        view.zoom[0] <= view.zoom[1]
      )
        zoom = [...view.zoom];
      legendScroll = Math.max(0, Number(view?.legendScroll) || 0);
    },
    reset: () => {
      update(currentSettings, currentSeries, true);
      onViewChange();
    },
    destroy: () => {
      observer.disconnect();
      instance.dispose();
    },
  };
}
