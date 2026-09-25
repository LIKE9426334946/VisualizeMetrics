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
import { createSummary } from "./summary.js";
import { apiJSON, uploadCSV, storedCSV, createPersistence } from "./server.js";

const $ = (selector) => document.querySelector(selector);
document.querySelectorAll("[data-icon]").forEach((element) => {
  element.innerHTML = icon(
    element.dataset.icon,
    Number(element.getAttribute("size")) || 18,
  );
});

const state = {
  folders: [],
  files: [],
  activeFolderId: "",
  mode: "files",
  ready: false,
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
  summaryConfigs: {},
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
let toastTimer;
const chart = createChart(
  $("#chart"),
  (selected) => {
    for (const series of state.series)
      state.seriesPrefs[series.id].visible = selected[series.name] !== false;
    refreshSeries();
  },
  () => persistence.schedule(),
);
const persistence = createPersistence(workspaceSnapshot, (status, message) => {
  const button = $("#save-status");
  button.dataset.status = status;
  button.textContent = {
    saving: "正在保存…",
    saved: "已保存到服务器",
    error: "保存失败 · 点击重试",
  }[status];
  button.disabled = status !== "error";
  button.title = message || "CSV 和当前图表状态已保存到服务器";
});
const summary = createSummary({
  element: $("#summary-surface"),
  state,
  loadDataset: async (metadata) => readFile(await storedCSV(metadata)),
  onChange: () => persistence.schedule(),
  notify: toast,
});

function workspaceSnapshot() {
  return {
    schema: 1,
    mode: state.mode,
    activeFolderId: state.activeFolderId,
    datasets: state.datasets.map(({ id, name, enabled, xColumn }) => ({
      id,
      name,
      enabled,
      xColumn,
    })),
    selected: [...state.selected],
    seriesPrefs: state.seriesPrefs,
    nextColor: state.nextColor,
    settings: state.settings,
    summaryConfigs: state.summaryConfigs,
    statsId: state.statsId,
    tableId: state.tableId,
    sortColumn: state.sortColumn,
    sortDirection: state.sortDirection,
    tableQuery: state.tableQuery,
    precision: state.precision,
    page: state.page,
    openFiles: [...state.openFiles],
    view: chart.getView(),
    scrollY: window.scrollY,
    tableScroll: $("#table-scroll").scrollLeft,
  };
}

function updateUploadButtons() {
  document.querySelectorAll(".upload-trigger").forEach((button) => {
    button.disabled = !state.ready || state.busy || !state.activeFolderId;
  });
}

function renderFolders() {
  $("#folder-list").innerHTML = state.folders.length
    ? state.folders
        .map((folder) => {
          const count = state.files.filter(
            (file) => file.folderId === folder.id,
          ).length;
          return `<div class="folder-row ${folder.id === state.activeFolderId ? "active" : ""}"><button class="folder-select" type="button" data-folder="${esc(folder.id)}" aria-pressed="${folder.id === state.activeFolderId}">${icon("folder", 16)}<span>${esc(folder.name)}</span><small>${count}</small></button><button class="icon-button delete-folder" type="button" data-delete-folder="${esc(folder.id)}" aria-label="删除目录 ${esc(folder.name)}" title="删除目录">${icon("trash", 14)}</button></div>`;
        })
        .join("")
    : '<p class="empty-help">暂无目录，点击 + 创建。</p>';
  updateUploadButtons();
}

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
  const folder = state.folders.find((item) => item.id === state.activeFolderId);
  const files = state.files.filter(
    (file) => file.folderId === state.activeFolderId,
  );
  const demos = state.datasets.filter((dataset) => dataset.demo);
  $("#file-count").textContent = String(files.length).padStart(2, "0");
  $("#current-folder").textContent = folder
    ? `${folder.name} · ${files.length} 个已保存文件`
    : "请先创建目录";
  const card = (metadata, index) => {
    const dataset = state.datasets.find((item) => item.id === metadata.id);
    const name = dataset?.name || baseName(metadata.filename);
    return `<div class="file-card ${dataset?.enabled ? "" : "disabled-file"}" data-file="${esc(metadata.id)}">
      <div class="file-card-top">
        <input type="checkbox" data-file-enabled="${esc(metadata.id)}" ${dataset?.enabled ? "checked" : ""} aria-label="显示 ${esc(name)} 文件的曲线" />
        <input class="model-name" data-file-name="${esc(metadata.id)}" aria-label="模型名称 ${esc(metadata.filename)}" value="${esc(name)}" maxlength="80" ${dataset ? "" : "disabled"} title="勾选文件后可编辑模型名称" />
        <button class="icon-button remove-file" data-remove-file="${esc(metadata.id)}" type="button" aria-label="删除 ${esc(metadata.filename)}" title="${metadata.demo ? "移除示例" : "删除服务器上的 CSV"}">${icon(metadata.demo ? "close" : "trash", 14)}</button>
      </div>
      <div class="file-meta"><span class="file-dot" style="background:${palette[index % palette.length]}"></span><span title="${esc(metadata.filename)}">${esc(metadata.filename)}</span><span>${dataset?.rows.length ?? metadata.rowCount} 行</span></div>
      ${dataset ? `<details data-file-details="${esc(dataset.id)}" ${state.openFiles.has(dataset.id) ? "open" : ""}><summary>配置 X 轴</summary><label>X 轴<select data-x-column="${esc(dataset.id)}" aria-label="${esc(name)} 的 X 轴">${options([["__row", "数据行号（从 1 开始）"], ...dataset.columns.filter((column) => column.numericCount || column.id === dataset.xColumn).map((column) => [column.id, column.label])], dataset.xColumn)}</select></label></details>` : ""}
    </div>`;
  };
  $("#file-list").innerHTML =
    (demos.length
      ? `<p class="demo-file-note">模拟示例 · 未上传到目录</p>${demos.map(card).join("")}`
      : "") +
    files.map(card).join("") +
    (!files.length
      ? '<p class="empty-help">当前目录暂无 CSV，上传后会保存到服务器。</p>'
      : "");
  $("#workspace-count").textContent =
    `${state.datasets.filter((dataset) => dataset.enabled).length} 个显示中的实验 · ${state.files.length} 个已保存文件`;
  $("#demo-badge").hidden = !demos.length;
  $("#demo-badge").textContent = "模拟示例 · 非真实训练结果";
  $("#load-demo").hidden = state.datasets.length > 0;
  persistence.schedule();
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
  persistence.schedule();
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
  persistence.schedule();
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
  persistence.schedule();
}

function renderAll(resetZoom = false) {
  renderFolders();
  renderFiles();
  renderMetrics();
  refreshSeries(resetZoom);
  renderTable();
  renderNotices();
  summary.refresh();
}

function loadDemo() {
  state.mode = "demo";
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

function addDatasets(added) {
  if (!added.length) return;
  const replacing = !state.datasets.length || state.mode === "demo";
  if (replacing) {
    state.datasets = [];
    state.seriesPrefs = {};
    state.nextColor = 0;
    state.statsId = "";
    state.selected = new Set();
    state.tableQuery = "";
    $("#table-search").value = "";
  }
  state.mode = "files";
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

function forgetFiles(ids) {
  state.datasets = state.datasets.filter((dataset) => !ids.has(dataset.id));
  state.files = state.files.filter((file) => !ids.has(file.id));
  for (const id of Object.keys(state.seriesPrefs))
    if (ids.has(id.split(":")[0])) delete state.seriesPrefs[id];
  const labels = new Set(
    metricList(state.datasets).map((metric) => metric.label),
  );
  state.selected = new Set(
    [...state.selected].filter((label) => labels.has(label)),
  );
  state.sortColumn = null;
  state.page = 0;
}

async function importFiles(files) {
  if (!state.ready || state.busy) {
    toast("正在读取文件，请稍候。");
    return;
  }
  if (!state.activeFolderId) {
    toast("请先创建并选择一个目录。");
    return;
  }
  if (!files.length) return;
  const folderId = state.activeFolderId;
  state.busy = true;
  updateUploadButtons();
  state.notices = [];
  const added = [];
  toast("正在读取并上传 CSV…");
  for (const file of files) {
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("请选择 .csv 文件。");
      if (file.size > 50 * 1024 * 1024)
        throw new Error("单个文件最大支持 50 MB，请拆分后上传。");
      const dataset = await readFile(file);
      const metadata = await uploadCSV(folderId, file);
      state.files.push(metadata);
      added.push({ ...dataset, id: metadata.id, folderId });
    } catch (error) {
      state.notices.push({
        type: "error",
        message: `${file.name}：${error.message}`,
      });
    }
  }
  addDatasets(added);
  state.busy = false;
  updateUploadButtons();
  $("#file-input").value = "";
  renderAll(added.length > 0);
  await persistence.flush();
  toast(
    added.length
      ? `已将 ${added.length} 个 CSV 保存到服务器${state.notices.length ? "，部分文件失败，请查看提示。" : "。"}`
      : "未上传文件，请查看数据读取提示。",
  );
}

async function initialize() {
  try {
    const saved = await apiJSON("/api/state");
    state.folders = saved.folders;
    state.files = saved.files;
    const value = persistence.restore(saved.workspace);
    state.activeFolderId = state.folders.some(
      (folder) => folder.id === value?.activeFolderId,
    )
      ? value.activeFolderId
      : (state.folders[0]?.id ?? "");
    if (value) {
      const datasets = [];
      const demos = value.mode === "demo" ? demoDatasets() : [];
      for (const view of value.datasets) {
        let dataset = demos.find((item) => item.id === view.id);
        if (!dataset) {
          const metadata = state.files.find((file) => file.id === view.id);
          if (!metadata) continue;
          dataset = {
            ...(await readFile(await storedCSV(metadata))),
            id: metadata.id,
            folderId: metadata.folderId,
          };
        }
        dataset.name = typeof view.name === "string" ? view.name : dataset.name;
        dataset.enabled = view.enabled !== false;
        if (
          view.xColumn === "__row" ||
          dataset.columns.some((column) => column.id === view.xColumn)
        )
          dataset.xColumn = view.xColumn;
        datasets.push(dataset);
      }
      state.datasets = datasets;
      state.mode = value.mode;
      const metrics = new Set(
        metricList(datasets).map((metric) => metric.label),
      );
      state.selected = new Set(
        value.selected.filter((label) => metrics.has(label)),
      );
      state.seriesPrefs = value.seriesPrefs || {};
      state.nextColor = value.nextColor || 0;
      state.settings = { ...state.settings, ...value.settings };
      state.summaryConfigs = value.summaryConfigs || {};
      for (const key of [
        "statsId",
        "tableId",
        "sortColumn",
        "sortDirection",
        "tableQuery",
        "precision",
        "page",
      ])
        if (value[key] !== undefined) state[key] = value[key];
      state.openFiles = new Set(value.openFiles || []);
      chart.restoreView(value.view);
      $("#table-search").value = state.tableQuery;
      $("#table-precision").value = state.precision;
      $("#export-width").value = state.settings.exportWidth;
    } else if (!state.files.length) {
      loadDemo();
    }
    state.ready = true;
    $("#workspace-loading").hidden = true;
    $("#workspace-surface").hidden = false;
    $("#data-surface").hidden = false;
    renderAll();
    if (value) {
      $("#table-scroll").scrollLeft = value.tableScroll || 0;
      window.scrollTo(0, value.scrollY || 0);
    }
    persistence.enable();
  } catch (error) {
    $("#workspace-loading").innerHTML =
      `<p>工作区恢复失败：${esc(error.message)}</p><button id="retry-load" class="button" type="button">重新读取</button>`;
    $("#retry-load").onclick = initialize;
    $("#save-status").textContent = "服务器暂不可用";
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.classList.contains("upload-trigger")) $("#file-input").click();
  if (target.dataset.folder) {
    state.activeFolderId = target.dataset.folder;
    renderFolders();
    renderFiles();
    summary.refresh();
  }
  if (target.dataset.deleteFolder) {
    if (state.busy) {
      toast("请等待文件上传完成后再删除目录。");
      return;
    }
    const folder = state.folders.find(
      (item) => item.id === target.dataset.deleteFolder,
    );
    const count = state.files.filter(
      (file) => file.folderId === folder.id,
    ).length;
    if (
      !window.confirm(
        `删除目录“${folder.name}”及其中的 ${count} 个 CSV 文件？此操作会从服务器删除文件。`,
      )
    )
      return;
    target.disabled = true;
    try {
      const result = await apiJSON(`/api/folders/${folder.id}`, "DELETE");
      forgetFiles(new Set(result.deletedFileIds));
      state.folders = state.folders.filter((item) => item.id !== folder.id);
      delete state.summaryConfigs[folder.id];
      if (state.activeFolderId === folder.id)
        state.activeFolderId = state.folders[0]?.id ?? "";
      renderAll(true);
      await persistence.flush();
      toast("目录及其中的 CSV 文件已删除。");
    } catch (error) {
      target.disabled = false;
      toast(error.message);
    }
  }
  if (target.dataset.removeFile) {
    if (state.busy) {
      toast("请等待文件上传完成后再删除文件。");
      return;
    }
    const id = target.dataset.removeFile;
    const demo = state.datasets.find((dataset) => dataset.id === id)?.demo;
    const filename = state.files.find((file) => file.id === id)?.filename;
    if (!demo && !window.confirm(`从服务器删除“${filename}”？此操作无法撤销。`))
      return;
    target.disabled = true;
    try {
      if (!demo) await apiJSON(`/api/files/${id}`, "DELETE");
      forgetFiles(new Set([id]));
      renderAll(true);
      await persistence.flush();
      toast(demo ? "示例已移除。" : "CSV 文件已从服务器删除。");
    } catch (error) {
      target.disabled = false;
      toast(error.message);
    }
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

document.addEventListener("change", async (event) => {
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
    const id = target.dataset.fileEnabled;
    const dataset = state.datasets.find((item) => item.id === id);
    if (dataset) dataset.enabled = target.checked;
    else if (target.checked) {
      target.disabled = true;
      try {
        const metadata = state.files.find((file) => file.id === id);
        const parsed = await readFile(await storedCSV(metadata));
        if (!state.files.some((file) => file.id === id)) return;
        if (!state.datasets.some((item) => item.id === id))
          addDatasets([{ ...parsed, id, folderId: metadata.folderId }]);
      } catch (error) {
        target.checked = false;
        target.disabled = false;
        toast(error.message);
        return;
      }
    }
    renderFiles();
    renderMetrics();
    refreshSeries();
    renderTable();
    summary.refresh();
  }
  if (target.dataset.fileName) {
    const dataset = state.datasets.find(
      (item) => item.id === target.dataset.fileName,
    );
    dataset.name = target.value.trim() || baseName(dataset.filename);
    renderFiles();
    refreshSeries();
    summary.refresh();
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
    if (id && event.target.isConnected) {
      if (event.target.open) state.openFiles.add(id);
      else state.openFiles.delete(id);
      persistence.schedule();
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
  persistence.schedule();
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
    persistence.schedule();
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
$("#save-status").addEventListener("click", () => persistence.flush());
$("#new-folder").addEventListener("click", () => {
  $("#folder-name").value = "";
  $("#folder-error").textContent = "";
  $("#folder-dialog").showModal();
  $("#folder-name").focus();
});
$("#close-folder").addEventListener("click", () => $("#folder-dialog").close());
$("#folder-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#create-folder").disabled = true;
  try {
    const folder = await apiJSON("/api/folders", "POST", {
      name: $("#folder-name").value,
    });
    state.folders.push(folder);
    state.activeFolderId = folder.id;
    $("#folder-dialog").close();
    renderFolders();
    renderFiles();
    summary.refresh();
    await persistence.flush();
    toast("目录已创建。");
  } catch (error) {
    $("#folder-error").textContent = error.message;
  } finally {
    $("#create-folder").disabled = false;
  }
});
window.addEventListener("scroll", () => persistence.schedule(), {
  passive: true,
});
$("#table-scroll").addEventListener("scroll", () => persistence.schedule(), {
  passive: true,
});
initialize();
