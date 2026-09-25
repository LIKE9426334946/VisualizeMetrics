import "./styles.css";
import { icon } from "./icons.js";
import {
  escapeHTML as esc,
  displayNumber,
  baseName,
  palette,
} from "./utils.js";
import { metricList, buildSeries, sortRows } from "./data.js";
import { demoDatasets } from "./demo.js";
import { createChart } from "./chart.js";
import { exportChart } from "./export.js";

const $ = (selector) => document.querySelector(selector);
document.querySelectorAll("[data-icon]").forEach((element) => {
  element.innerHTML = icon(
    element.dataset.icon,
    Number(element.getAttribute("size")) || 18,
  );
});

const state = {
  datasets: [],
  selected: new Set(),
  seriesPrefs: {},
  nextColor: 0,
  series: [],
  statsId: "",
  tableId: "",
  sortColumn: null,
  sortDirection: "asc",
  tableQuery: "",
  precision: "6",
  page: 0,
  pageSize: 10,
  notices: [],
  openFiles: new Set(),
  busy: false,
  settings: {
    title: "训练指标",
    xLabel: "Epoch",
    yLabel: "Value",
    grid: true,
    points: false,
    legend: true,
    lineWidth: 2.5,
    exportWidth: 2400,
  },
};
let fileSequence = 0;
let toastTimer;
const chart = createChart($("#chart"), (selected) => {
  for (const series of state.series)
    state.seriesPrefs[series.id].visible = selected[series.name] !== false;
  refreshSeries();
});

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}

function options(items, selected) {
  return items
    .map(
      ([value, label]) =>
        `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
}

function renderFiles() {
  $("#file-count").textContent = String(state.datasets.length).padStart(2, "0");
  $("#file-list").innerHTML = state.datasets
    .map(
      (dataset, index) => `
    <div class="file-card ${dataset.enabled ? "" : "disabled-file"}" data-file="${esc(dataset.id)}">
      <div class="file-card-top">
        <input type="checkbox" data-file-enabled="${esc(dataset.id)}" ${dataset.enabled ? "checked" : ""} aria-label="显示 ${esc(dataset.name)} 文件的曲线" />
        <input class="model-name" data-file-name="${esc(dataset.id)}" aria-label="模型名称 ${esc(dataset.filename)}" value="${esc(dataset.name)}" maxlength="80" title="编辑模型名称" />
        <button class="icon-button remove-file" data-remove-file="${esc(dataset.id)}" type="button" aria-label="移除 ${esc(dataset.filename)}">${icon("close", 14)}</button>
      </div>
      <div class="file-meta"><span class="file-dot" style="background:${palette[index % palette.length]}"></span><span title="${esc(dataset.filename)}">${esc(dataset.filename)}</span><span>${dataset.rows.length} 行</span></div>
      <details data-file-details="${esc(dataset.id)}" ${state.openFiles.has(dataset.id) ? "open" : ""}><summary>配置 X 轴</summary><label>X 轴<select data-x-column="${esc(dataset.id)}" aria-label="${esc(dataset.name)} 的 X 轴">${options([["__row", "数据行号（从 1 开始）"], ...dataset.columns.filter((column) => column.numericCount || column.id === dataset.xColumn).map((column) => [column.id, column.label])], dataset.xColumn)}</select></label></details>
    </div>`,
    )
    .join("");
  $("#workspace-count").textContent =
    `${state.datasets.length} 个实验 · ${state.datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0).toLocaleString()} 行数据`;
  const demo = state.datasets.some((dataset) => dataset.demo);
  $("#demo-badge").hidden = !demo;
  $("#demo-badge").textContent = "模拟示例 · 非真实训练结果";
  $("#load-demo").hidden = state.datasets.length > 0;
}

function renderMetrics() {
  const metrics = metricList(state.datasets);
  $("#metric-count").textContent = `${metrics.length} 项`;
  $("#selected-count").textContent = `已选 ${state.selected.size}`;
  $("#metric-list").innerHTML = metrics.length
    ? metrics
        .map(
          (metric) => `
    <label class="metric-row ${state.selected.has(metric.label) ? "selected" : ""}">
      <input type="checkbox" data-metric="${esc(metric.label)}" ${state.selected.has(metric.label) ? "checked" : ""} />
      <span title="${esc(metric.label)}">${esc(metric.label)}</span><small>${metric.files} 文件</small>
    </label>`,
        )
        .join("")
    : '<p class="empty-help">导入 CSV 后自动识别数值指标。</p>';
}

function renderSeries() {
  $("#series-list").innerHTML = state.series.length
    ? state.series
        .map(
          (series) => `
    <div class="series-row">
      <label title="${esc(series.name)}"><input type="checkbox" data-series-visible="${esc(series.id)}" ${series.visible ? "checked" : ""} /><span class="series-swatch" style="background:${series.color}"></span><span>${esc(series.name)}</span></label>
      <select data-extreme="${esc(series.id)}" aria-label="${esc(series.name)} 极值标记">${options(
        [
          ["none", "不标记"],
          ["max", "最大值 Max"],
          ["min", "最小值 Min"],
          ["both", "最大值 + 最小值"],
        ],
        series.extreme,
      )}</select>
    </div>`,
        )
        .join("")
    : '<p class="empty-help">勾选指标后，可设置每条曲线。</p>';
}

function renderStats() {
  if (!state.series.some((series) => series.id === state.statsId))
    state.statsId = state.series[0]?.id ?? "";
  $("#stats-series").innerHTML = state.series.length
    ? options(
        state.series.map((series) => [series.id, series.name]),
        state.statsId,
      )
    : "<option>未选择指标</option>";
  $("#stats-series").disabled = !state.series.length;
  const selected = state.series.find((series) => series.id === state.statsId);
  if (!selected?.stats.count) {
    $("#stats-content").innerHTML =
      '<p class="empty-stats">选择包含有效数值的指标后，查看最大值、最小值及对应 Epoch。</p>';
    return;
  }
  const { max, min, last, count, missing, maxCount, minCount } = selected.stats;
  const card = (kind, point, count) =>
    `<div class="stat-card ${kind.toLowerCase()}"><div class="stat-label">${icon(kind === "Max" ? "arrowUp" : "arrowDown", 14)} ${kind === "Max" ? "最大值" : "最小值"} <span>${kind}</span></div><strong title="${esc(point.rawY)}">${esc(displayNumber(point.rawY, 6))}</strong><div class="stat-detail">Epoch <b>${esc(point.rawX)}</b>${count > 1 ? `<span class="tie-note">${count} 处并列</span>` : ""}</div></div>`;
  $("#stats-content").innerHTML = `<div class="stats-grid">
    ${card("Max", max, maxCount)}${card("Min", min, minCount)}
    <div class="stat-card"><div class="stat-label">最终有效值 <span>Last</span></div><strong title="${esc(last.rawY)}">${esc(displayNumber(last.rawY, 6))}</strong><div class="stat-detail">Epoch <b>${esc(last.rawX)}</b></div></div>
    <div class="stat-card count-stat"><div class="stat-label">有效数据点 <span>Points</span></div><strong>${count.toLocaleString()}<small> / ${selected.dataset.rows.length.toLocaleString()}</small></strong><div class="stat-detail">${missing ? `${missing} 处曲线断点` : "按 Epoch 升序绘制"}</div></div>
    </div>`;
}

function renderNotices() {
  const messages = [
    ...state.notices,
    ...state.datasets.flatMap((dataset) =>
      dataset.warnings.map((warning) => ({
        type: "info",
        message: `${dataset.filename}：${warning}`,
      })),
    ),
  ];
  if (!messages.length) {
    $("#notices").innerHTML = "";
    return;
  }
  $("#notices").innerHTML =
    `<details class="notice-panel" ${messages.some((item) => item.type === "error") ? "open" : ""}><summary>数据读取提示 <span class="count-badge">${messages.length}</span></summary><ul>${messages.map((item) => `<li class="${item.type === "error" ? "error-text" : ""}">${esc(item.message)}</li>`).join("")}</ul></details>`;
}

function renderTable() {
  if (!state.datasets.some((dataset) => dataset.id === state.tableId))
    state.tableId = state.datasets[0]?.id ?? "";
  $("#table-dataset").innerHTML = state.datasets.length
    ? options(
        state.datasets.map((dataset) => [dataset.id, dataset.filename]),
        state.tableId,
      )
    : "<option>尚无 CSV 文件</option>";
  $("#table-dataset").disabled = !state.datasets.length;
  const dataset = state.datasets.find((item) => item.id === state.tableId);
  const columns = dataset?.columns ?? [];
  const rows = dataset
    ? sortRows(
        dataset.rows,
        columns,
        state.sortColumn,
        state.sortDirection,
        state.tableQuery,
      )
    : [];
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  $("#table-head").innerHTML =
    `<tr><th class="row-number">#</th>${columns.map((column, index) => `<th aria-sort="${state.sortColumn === index ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none"}"><button data-sort="${index}" type="button">${esc(column.rawName || column.label)}<span>${state.sortColumn === index ? (state.sortDirection === "asc" ? "↑" : "↓") : "↕"}</span></button></th>`).join("")}</tr>`;
  const offset = state.page * state.pageSize;
  $("#table-body").innerHTML = rows.length
    ? rows
        .slice(offset, offset + state.pageSize)
        .map(
          (row, i) =>
            `<tr><td class="row-number">${offset + i + 1}</td>${row.map((cell, index) => `<td title="${esc(cell)}">${esc(cell.trim() ? displayNumber(cell, columns[index].id === dataset.xColumn ? "raw" : state.precision) : "—")}</td>`).join("")}</tr>`,
        )
        .join("")
    : `<tr><td colspan="${columns.length + 1}" class="table-empty">${dataset ? "没有匹配的数据" : "上传 CSV 后查看原始数据"}</td></tr>`;
  $("#table-row-count").textContent = `${dataset?.rows.length ?? 0} 行`;
  $("#table-summary").textContent = rows.length
    ? `显示 ${offset + 1}–${Math.min(offset + state.pageSize, rows.length)} 行，共 ${rows.length} 行 · ${columns.length} 列`
    : "0 行";
  $("#page-info").textContent = `${state.page + 1} / ${pages}`;
  $("#page-prev").disabled = state.page === 0;
  $("#page-next").disabled = state.page >= pages - 1;
}

function refreshSeries(resetZoom = false) {
  state.series = buildSeries(state);
  renderSeries();
  renderStats();
  const visible = state.series.filter((series) => series.visible);
  const hasData = visible.some((series) => series.stats.count > 0);
  $("#chart-empty").hidden = hasData;
  $("#chart").style.visibility = hasData ? "visible" : "hidden";
  $("#curve-count").textContent = `${visible.length} 条`;
  $("#export-toggle").disabled = !hasData;
  chart.update(state.settings, state.series, resetZoom);
}

function renderAll(resetZoom = false) {
  renderFiles();
  renderMetrics();
  refreshSeries(resetZoom);
  renderTable();
  renderNotices();
}

function loadDemo() {
  state.datasets = demoDatasets();
  state.selected = new Set(["val_iou"]);
  state.seriesPrefs = {};
  state.nextColor = 0;
  state.settings.title = "Validation IoU · Model comparison";
  state.settings.yLabel = "IoU";
  state.settings.xLabel = "Epoch";
  state.statsId = "demo2:c3";
  state.tableId = "demo0";
  state.notices = [];
  state.page = 0;
  state.sortColumn = null;
  state.tableQuery = "";
  $("#table-search").value = "";
  buildSeries(state);
  state.seriesPrefs["demo2:c3"].extreme = "max";
  renderAll(true);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./csv-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.dataset);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("CSV 解析失败，请检查文件是否为有效 UTF-8 文本。"));
    };
    worker.postMessage(file);
  });
}

async function importFiles(files) {
  if (state.busy) {
    toast("正在解析文件，请稍候。");
    return;
  }
  if (!files.length) return;
  state.busy = true;
  document.querySelectorAll(".upload-trigger").forEach((button) => {
    button.disabled = true;
  });
  state.notices = [];
  const added = [];
  toast("正在读取 CSV…");
  for (const file of files) {
    if (!/\.csv$/i.test(file.name)) {
      state.notices.push({
        type: "error",
        message: `${file.name}：请选择 .csv 文件。`,
      });
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      state.notices.push({
        type: "error",
        message: `${file.name}：单个文件最大支持 50 MB，请拆分后导入。`,
      });
      continue;
    }
    try {
      const dataset = await readFile(file);
      added.push({ ...dataset, id: `file${++fileSequence}` });
    } catch (error) {
      state.notices.push({
        type: "error",
        message: `${file.name}：${error.message}`,
      });
    }
  }
  if (added.length) {
    const replacing =
      !state.datasets.length || state.datasets.some((dataset) => dataset.demo);
    if (replacing) {
      state.datasets = [];
      state.seriesPrefs = {};
      state.nextColor = 0;
      state.statsId = "";
      state.selected = new Set();
      state.tableQuery = "";
      $("#table-search").value = "";
    }
    state.datasets.push(...added);
    if (replacing) {
      state.selected = new Set(
        metricList(state.datasets)
          .slice(0, 2)
          .map((metric) => metric.label),
      );
      state.settings.title = baseName(added[0].filename);
      state.settings.yLabel = "Value";
      state.settings.xLabel = "Epoch";
    }
    state.tableId = added[0].id;
    state.page = 0;
    state.sortColumn = null;
  }
  state.busy = false;
  document.querySelectorAll(".upload-trigger").forEach((button) => {
    button.disabled = false;
  });
  $("#file-input").value = "";
  renderAll(added.length > 0);
  toast(
    added.length
      ? `已导入 ${added.length} 个 CSV 文件${state.notices.length ? "，部分文件未能读取，请查看提示。" : ""}`
      : "未导入文件，请查看数据读取提示。",
  );
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.classList.contains("upload-trigger")) $("#file-input").click();
  if (target.dataset.removeFile) {
    const removed = target.dataset.removeFile;
    state.datasets = state.datasets.filter((dataset) => dataset.id !== removed);
    for (const id of Object.keys(state.seriesPrefs))
      if (id.startsWith(`${removed}:`)) delete state.seriesPrefs[id];
    const labels = new Set(
      metricList(state.datasets).map((metric) => metric.label),
    );
    state.selected = new Set(
      [...state.selected].filter((label) => labels.has(label)),
    );
    state.sortColumn = null;
    state.page = 0;
    renderAll(true);
  }
  if (target.dataset.sort != null) {
    const column = Number(target.dataset.sort);
    state.sortDirection =
      state.sortColumn === column && state.sortDirection === "asc"
        ? "desc"
        : "asc";
    state.sortColumn = column;
    state.page = 0;
    renderTable();
  }
  if (target.dataset.export) {
    target.disabled = true;
    try {
      await exportChart(
        target.dataset.export,
        state.settings,
        state.series,
        chart.getZoom(),
      );
      toast(`${target.dataset.export.toUpperCase()} 图表已生成，正在下载。`);
      $("#export-menu").hidden = true;
      $("#export-toggle").setAttribute("aria-expanded", "false");
    } catch (error) {
      toast(error.message);
    } finally {
      target.disabled = false;
    }
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.metric != null) {
    if (target.checked) state.selected.add(target.dataset.metric);
    else state.selected.delete(target.dataset.metric);
    renderMetrics();
    refreshSeries();
  }
  if (target.dataset.seriesVisible) {
    state.seriesPrefs[target.dataset.seriesVisible].visible = target.checked;
    refreshSeries();
  }
  if (target.dataset.extreme) {
    state.seriesPrefs[target.dataset.extreme].extreme = target.value;
    refreshSeries();
  }
  if (target.dataset.fileEnabled) {
    state.datasets.find(
      (item) => item.id === target.dataset.fileEnabled,
    ).enabled = target.checked;
    renderFiles();
    refreshSeries();
  }
  if (target.dataset.fileName) {
    const dataset = state.datasets.find(
      (item) => item.id === target.dataset.fileName,
    );
    dataset.name = target.value.trim() || baseName(dataset.filename);
    renderFiles();
    refreshSeries();
  }
  if (target.dataset.xColumn) {
    const dataset = state.datasets.find(
      (item) => item.id === target.dataset.xColumn,
    );
    dataset.xColumn = target.value;
    dataset.pointCache?.clear();
    const metrics = metricList(state.datasets);
    state.selected = new Set(
      [...state.selected].filter((label) =>
        metrics.some((metric) => metric.label === label),
      ),
    );
    renderMetrics();
    refreshSeries(true);
    renderTable();
  }
});

document.addEventListener(
  "toggle",
  (event) => {
    const id = event.target.dataset?.fileDetails;
    if (id) {
      if (event.target.open) state.openFiles.add(id);
      else state.openFiles.delete(id);
    }
  },
  true,
);
$("#file-input").addEventListener("change", (event) =>
  importFiles([...event.target.files]),
);
$("#select-all").addEventListener("click", () => {
  state.selected = new Set(
    metricList(state.datasets).map((metric) => metric.label),
  );
  renderMetrics();
  refreshSeries();
});
$("#select-none").addEventListener("click", () => {
  state.selected.clear();
  renderMetrics();
  refreshSeries();
});
$("#stats-series").addEventListener("change", (event) => {
  state.statsId = event.target.value;
  renderStats();
});
$("#table-dataset").addEventListener("change", (event) => {
  state.tableId = event.target.value;
  state.sortColumn = null;
  state.page = 0;
  renderTable();
});
$("#table-search").addEventListener("input", (event) => {
  state.tableQuery = event.target.value;
  state.page = 0;
  renderTable();
});
$("#table-precision").addEventListener("change", (event) => {
  state.precision = event.target.value;
  renderTable();
});
$("#page-prev").addEventListener("click", () => {
  state.page--;
  renderTable();
});
$("#page-next").addEventListener("click", () => {
  state.page++;
  renderTable();
});
$("#reset-zoom").addEventListener("click", () => chart.reset());
$("#load-demo").addEventListener("click", loadDemo);
$("#export-width").addEventListener("change", (event) => {
  state.settings.exportWidth = Number(event.target.value);
});
$("#export-toggle").addEventListener("click", () => {
  $("#export-menu").hidden = !$("#export-menu").hidden;
  $("#export-toggle").setAttribute(
    "aria-expanded",
    String(!$("#export-menu").hidden),
  );
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".export-wrap")) {
    $("#export-menu").hidden = true;
    $("#export-toggle").setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("#export-menu").hidden = true;
    $("#export-toggle").setAttribute("aria-expanded", "false");
  }
});
$("#open-settings").addEventListener("click", () => {
  document.querySelectorAll("[data-setting]").forEach((input) => {
    if (input.type === "checkbox")
      input.checked = state.settings[input.dataset.setting];
    else input.value = state.settings[input.dataset.setting];
  });
  $("#line-width-value").textContent = `${state.settings.lineWidth} px`;
  $("#settings-dialog").showModal();
});
for (const selector of ["#close-settings", "#done-settings"])
  $(selector).addEventListener("click", () => $("#settings-dialog").close());
$("#settings-dialog").addEventListener("click", (event) => {
  if (event.target === $("#settings-dialog")) $("#settings-dialog").close();
});
document.querySelectorAll("[data-setting]").forEach((input) =>
  input.addEventListener("input", () => {
    const key = input.dataset.setting;
    state.settings[key] =
      input.type === "checkbox"
        ? input.checked
        : input.type === "range"
          ? Number(input.value)
          : input.value;
    $("#line-width-value").textContent = `${state.settings.lineWidth} px`;
    chart.update(state.settings, state.series);
  }),
);

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    $("#drag-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("#drag-overlay").hidden = true;
  }
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("#drag-overlay").hidden = true;
  if (event.dataTransfer?.files.length)
    importFiles([...event.dataTransfer.files]);
});
window.addEventListener("blur", () => {
  dragDepth = 0;
  $("#drag-overlay").hidden = true;
});
loadDemo();
