import { escapeHTML as esc, baseName } from "./utils.js";
import {
  summaryFields,
  normalizeSummaryConfig,
  buildSummary,
  methods,
} from "./summary-data.js";
import { exportSummary } from "./summary-export.js";

const options = (items, selected) =>
  items
    .map(
      ([value, label]) =>
        `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");

export function createSummary({
  element,
  state,
  loadDataset,
  onChange,
  notify,
}) {
  const $ = (selector) => element.querySelector(selector);
  const cache = new Map();
  let revision = 0,
    datasets = [],
    fields = [],
    config,
    model;
  let folderName = "",
    loading = false,
    failed = [],
    exporting = false;

  function update() {
    config = normalizeSummaryConfig(
      fields,
      state.summaryConfigs[state.activeFolderId],
    );
    if (!failed.length && !loading && state.activeFolderId) {
      state.summaryConfigs[state.activeFolderId] = config;
      onChange();
    }
    model = buildSummary(datasets, fields, config);
    const metrics = fields.filter((field) => field.numeric && !field.epoch);
    $("#summary-folder").textContent = folderName || "请选择目录";
    $("#summary-count").textContent = `${datasets.length} 个模型`;
    $("#summary-rank").innerHTML = metrics.length
      ? options(
          metrics.map((field) => [field.label, field.label]),
          config.rankMetric,
        )
      : '<option value="">暂无数值指标</option>';
    $("#summary-method").value = config.rankMethod;
    $("#summary-direction").value = config.direction;
    $("#summary-mode").value = config.mode;
    $("#summary-precision").value = config.precision;
    $("#summary-fields").innerHTML = config.columns
      .map((column) => {
        const field = fields.find((item) => item.label === column.field);
        const aggregate =
          config.mode === "independent" && field.numeric && !field.epoch;
        const ranked = column.field === config.rankMetric;
        return `<div class="summary-field">
        <label class="summary-field-name"><input type="checkbox" data-summary-field="${esc(column.field)}" ${column.selected ? "checked" : ""} /><span title="${esc(column.field)}">${esc(column.field)}</span></label>
        ${aggregate ? `<select data-summary-aggregate="${esc(column.field)}" aria-label="${esc(column.field)} 汇总方式" ${ranked ? 'disabled title="跟随上方排序取值设置"' : ""}>${options(Object.entries(methods), ranked ? config.rankMethod : column.method)}</select><label class="summary-epoch"><input type="checkbox" data-summary-epoch="${esc(column.field)}" ${column.showEpoch ? "checked" : ""} />Epoch</label>` : '<span class="summary-cell-source">排序指标所在行</span>'}
      </div>`;
      })
      .join("");
    $("#summary-description").textContent = model.description;
    $("#summary-head").innerHTML =
      `<tr>${model.columns.map((column) => `<th scope="col" ${column.ranked ? `aria-sort="${config.direction === "asc" ? "ascending" : "descending"}"` : ""}>${column.prefix ? `<small>${esc(column.prefix)}</small>` : ""}<span>${esc(column.label)}${column.ranked ? (config.direction === "asc" ? " ↑" : " ↓") : ""}</span></th>`).join("")}</tr>`;
    $("#summary-body").innerHTML = model.rows.length
      ? model.rows
          .map(
            (row, index) =>
              `<tr data-summary-model="${esc(row.id)}" ${index === 0 && row.rankValue != null ? 'class="summary-leading"' : ""}>${row.cells.map((cell, columnIndex) => `<td title="${esc(cell.raw)}" ${model.columns[columnIndex].ranked ? 'class="summary-ranked"' : ""}>${esc(cell.text)}</td>`).join("")}</tr>`,
          )
          .join("")
      : `<tr><td class="table-empty" colspan="${model.columns.length}">${loading ? "正在读取当前目录的 CSV…" : "当前目录暂无 CSV，上传后自动生成模型汇总。"}</td></tr>`;
    $("#summary-note").textContent =
      config.mode === "independent"
        ? "每列独立计算，可来自不同 Epoch；文本和单独的 epoch 字段取排序指标所在行。极值并列取最早 Epoch，Last 为最后有效 Epoch。"
        : "所有字段取同一原始行：排序指标的 Max / Min / Last 所在 Epoch。极值并列取最早 Epoch，不会把其他指标的极值混入该行。";
    $("#summary-loading").hidden = !loading;
    $("#summary-error").hidden = !failed.length;
    $("#summary-error-text").textContent = failed.length
      ? `有 ${failed.length} 个 CSV 读取失败，当前汇总不完整：${failed.join("；")}。请重试后导出。`
      : "";
    $("#summary-controls").disabled =
      loading || Boolean(failed.length) || !datasets.length;
    $("#summary-rank").disabled = !metrics.length;
    $("#summary-method").disabled = !metrics.length;
    $("#summary-direction").disabled = !metrics.length;
    element.querySelectorAll("[data-summary-export]").forEach((button) => {
      button.disabled =
        loading || exporting || Boolean(failed.length) || !model.rows.length;
    });
  }

  async function refresh() {
    if (!state.ready) return;
    element.hidden = false;
    const current = ++revision;
    const folderId = state.activeFolderId;
    const files = state.files.filter((file) => file.folderId === folderId);
    folderName =
      state.folders.find((folder) => folder.id === folderId)?.name || "";
    for (const id of cache.keys())
      if (!files.some((file) => file.id === id)) cache.delete(id);
    datasets = [];
    fields = [];
    failed = [];
    loading = true;
    update();
    const loaded = [],
      errors = [];
    for (const metadata of files) {
      try {
        let dataset = state.datasets.find((item) => item.id === metadata.id);
        if (!dataset) {
          if (!cache.has(metadata.id))
            cache.set(metadata.id, loadDataset(metadata));
          dataset = await cache.get(metadata.id);
        }
        if (current !== revision) return;
        loaded.push({
          ...dataset,
          id: metadata.id,
          name: dataset.name || baseName(metadata.filename),
        });
      } catch (error) {
        if (current !== revision) return;
        cache.delete(metadata.id);
        errors.push(`${metadata.filename}（${error.message}）`);
      }
    }
    if (current !== revision) return;
    datasets = loaded;
    failed = errors;
    fields = summaryFields(datasets);
    loading = false;
    update();
  }

  element.addEventListener("change", (event) => {
    if (loading || failed.length || !config) return;
    const target = event.target;
    const keys = {
      "summary-rank": "rankMetric",
      "summary-method": "rankMethod",
      "summary-direction": "direction",
      "summary-mode": "mode",
      "summary-precision": "precision",
    };
    if (keys[target.id]) {
      config[keys[target.id]] = target.value;
      if (target.id === "summary-method")
        config.direction = target.value === "min" ? "asc" : "desc";
      if (target.id === "summary-rank") {
        config.rankMethod =
          config.columns.find((column) => column.field === target.value)
            ?.method || "max";
        config.direction = config.rankMethod === "min" ? "asc" : "desc";
      }
    } else {
      const label =
        target.dataset.summaryField ??
        target.dataset.summaryAggregate ??
        target.dataset.summaryEpoch;
      const column = config.columns.find((item) => item.field === label);
      if (!column) return;
      if (target.dataset.summaryField !== undefined)
        column.selected = target.checked;
      else if (target.dataset.summaryEpoch !== undefined)
        column.showEpoch = target.checked;
      else column.method = target.value;
    }
    state.summaryConfigs[state.activeFolderId] = config;
    update();
  });

  element.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "summary-retry") return refresh();
    if (button.dataset.summarySelection) {
      config.columns.forEach((column) => {
        column.selected = button.dataset.summarySelection === "all";
      });
      state.summaryConfigs[state.activeFolderId] = config;
      update();
    }
    if (button.dataset.summaryExport) {
      exporting = true;
      element.querySelectorAll("[data-summary-export]").forEach((item) => {
        item.disabled = true;
      });
      try {
        await exportSummary(button.dataset.summaryExport, {
          ...model,
          title: `${folderName} · 模型汇总`,
          note: $("#summary-note").textContent,
        });
        notify("完整汇总表已生成，正在下载。");
      } catch (error) {
        notify(error.message);
      } finally {
        exporting = false;
        update();
      }
    }
  });
  return { refresh };
}
