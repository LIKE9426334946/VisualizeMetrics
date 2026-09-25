import { pointsFor, summarize } from "./data.js";
import { displayNumber, numeric } from "./utils.js";

export const methods = {
  max: "最大值 Max",
  min: "最小值 Min",
  last: "末次有效值 Last",
};
const methodNames = { max: "Max", min: "Min", last: "Last" };
const statistics = new WeakMap();
const isEpoch = (column) => column.name.trim().toLowerCase() === "epoch";

export function summaryFields(datasets) {
  const fields = new Map();
  for (const dataset of datasets) {
    for (const column of dataset.columns) {
      const previous = fields.get(column.label);
      fields.set(column.label, {
        label: column.label,
        numeric: Boolean(previous?.numeric || column.numericCount),
        epoch: isEpoch(column),
      });
    }
  }
  return [...fields.values()];
}

export function normalizeSummaryConfig(fields, saved = {}) {
  const metrics = fields.filter((field) => field.numeric && !field.epoch);
  const preferred = ["val_iou", "val_f1", "val_loss"]
    .map(
      (name) =>
        metrics.find((field) => field.label.trim().toLowerCase() === name)
          ?.label,
    )
    .filter(Boolean);
  const rankMetric = metrics.some((field) => field.label === saved.rankMetric)
    ? saved.rankMetric
    : preferred[0] || metrics[0]?.label || "";
  const rankMethod = Object.hasOwn(methods, saved.rankMethod)
    ? saved.rankMethod
    : /loss/i.test(rankMetric)
      ? "min"
      : "max";
  const defaults = preferred.length
    ? preferred
    : metrics.slice(0, 3).map((field) => field.label);
  const existing = Array.isArray(saved.columns) ? saved.columns : [];
  // Keep existing column order, then append any fields discovered in a new CSV.
  const order = [
    ...new Set([
      ...existing.map((column) => column.field),
      ...defaults,
      ...fields.map((field) => field.label),
    ]),
  ];
  return {
    rankMetric,
    rankMethod,
    direction: ["asc", "desc"].includes(saved.direction)
      ? saved.direction
      : rankMethod === "min"
        ? "asc"
        : "desc",
    mode: saved.mode === "aligned" ? "aligned" : "independent",
    precision: ["raw", "2", "4", "6", "8"].includes(saved.precision)
      ? saved.precision
      : "4",
    columns: order
      .filter((label) => fields.some((field) => field.label === label))
      .map((label) => {
        const previous = existing.find((column) => column.field === label);
        const loss = /loss/i.test(label);
        return {
          field: label,
          selected: previous
            ? previous.selected === true
            : defaults.includes(label),
          method: Object.hasOwn(methods, previous?.method)
            ? previous.method
            : loss
              ? "min"
              : "max",
          showEpoch: previous ? previous.showEpoch === true : !loss,
        };
      }),
  };
}

function statsFor(dataset, column) {
  let cache = statistics.get(dataset);
  if (!cache) {
    cache = new Map();
    statistics.set(dataset, cache);
  }
  if (!cache.has(column.id)) {
    const epoch = dataset.columns.find(isEpoch);
    // Summary Epoch always means the CSV epoch, independently of the chart X axis.
    cache.set(
      column.id,
      summarize(
        pointsFor({ ...dataset, xColumn: epoch?.id ?? "__row" }, column),
      ),
    );
  }
  return cache.get(column.id);
}

function pointFor(dataset, label, method) {
  const column = dataset.columns.find((item) => item.label === label);
  return column ? statsFor(dataset, column)[method] : null;
}

export function summaryDescription(config) {
  const ranking = config.rankMetric
    ? `按 ${methodNames[config.rankMethod]} ${config.rankMetric} ${config.direction === "asc" ? "升序" : "降序"}`
    : "暂无可排序的数值指标";
  return `${ranking} · ${config.mode === "aligned" ? "排序指标所在 Epoch 的原始行" : "各指标独立统计"}`;
}

export function buildSummary(datasets, fields, config) {
  const columns = [{ key: "model", label: "Model", kind: "model" }];
  for (const selected of config.columns.filter((column) => column.selected)) {
    const field = fields.find((item) => item.label === selected.field);
    if (!field) continue;
    const aggregate =
      config.mode === "independent" && field.numeric && !field.epoch;
    const method =
      field.label === config.rankMetric ? config.rankMethod : selected.method;
    columns.push({
      key: `value:${field.label}`,
      label: field.label,
      prefix: aggregate ? methodNames[method] : "",
      kind: "value",
      field: field.label,
      aggregate,
      method,
      epoch: field.epoch,
      numeric: field.numeric,
      ranked: field.label === config.rankMetric,
    });
    if (aggregate && selected.showEpoch)
      columns.push({
        key: `epoch:${field.label}`,
        label: "Epoch",
        prefix: field.label,
        kind: "epoch",
        field: field.label,
        method,
      });
  }
  const rows = datasets.map((dataset, order) => {
    const rankPoint = pointFor(dataset, config.rankMetric, config.rankMethod);
    const cells = columns.map((column) => {
      if (column.kind === "model")
        return { text: dataset.name, raw: dataset.filename };
      let raw = null;
      if (column.aggregate || column.kind === "epoch") {
        const point = pointFor(dataset, column.field, column.method);
        raw = column.kind === "epoch" ? point?.rawX : point?.rawY;
      } else if (rankPoint) {
        const field = dataset.columns.find(
          (item) => item.label === column.field,
        );
        raw = field ? dataset.rows[rankPoint.rowIndex][field.index] : null;
      }
      if (
        raw == null ||
        !String(raw).trim() ||
        (column.numeric && numeric(raw) == null)
      )
        return { text: "—", raw: raw == null ? "" : String(raw) };
      return {
        text: displayNumber(
          raw,
          column.kind === "epoch" || column.epoch ? "raw" : config.precision,
        ),
        raw: String(raw),
      };
    });
    return {
      id: dataset.id,
      name: dataset.name,
      order,
      rankValue: rankPoint?.value[1] ?? null,
      cells,
    };
  });
  rows.sort((a, b) => {
    if (a.rankValue == null && b.rankValue != null) return 1;
    if (a.rankValue != null && b.rankValue == null) return -1;
    const delta = a.rankValue == null ? 0 : a.rankValue - b.rankValue;
    return (config.direction === "asc" ? delta : -delta) || a.order - b.order;
  });
  return { columns, rows, description: summaryDescription(config) };
}
