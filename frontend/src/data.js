import { numeric, seriesKey, palette } from "./utils.js";

export function pointsFor(dataset, column) {
  const xColumn = dataset.columns.find((item) => item.id === dataset.xColumn);
  return dataset.rows
    .flatMap((row, rowIndex) => {
      const rawX = xColumn ? row[xColumn.index] : String(rowIndex + 1);
      const x = numeric(rawX);
      if (x == null) return [];
      const rawY = row[column.index];
      return [{ value: [x, numeric(rawY)], rawX, rawY, rowIndex }];
    })
    .sort((a, b) => a.value[0] - b.value[0] || a.rowIndex - b.rowIndex);
}

export function summarize(points) {
  let min = null,
    max = null,
    last = null,
    count = 0,
    maxCount = 0,
    minCount = 0;
  for (const point of points) {
    const y = point.value[1];
    if (y == null) continue;
    count++;
    if (!min || y < min.value[1]) {
      min = point;
      minCount = 1;
    } else if (y === min.value[1]) minCount++;
    if (!max || y > max.value[1]) {
      max = point;
      maxCount = 1;
    } else if (y === max.value[1]) maxCount++;
    last = point;
  }
  return {
    min,
    max,
    last,
    count,
    maxCount,
    minCount,
    missing: points.length - count,
  };
}

export function metricList(datasets) {
  const found = new Map();
  for (const dataset of datasets) {
    for (const column of dataset.columns) {
      if (column.numericCount && column.id !== dataset.xColumn) {
        if (!found.has(column.label))
          found.set(column.label, { label: column.label, files: 0 });
        found.get(column.label).files++;
      }
    }
  }
  return [...found.values()];
}

export function buildSeries(state) {
  const result = [];
  const multi = state.datasets.length > 1;
  for (const dataset of state.datasets) {
    if (!dataset.enabled) continue;
    for (const column of dataset.columns) {
      if (
        column.id === dataset.xColumn ||
        !column.numericCount ||
        !state.selected.has(column.label)
      )
        continue;
      const id = seriesKey(dataset.id, column.id);
      if (!state.seriesPrefs[id]) {
        state.seriesPrefs[id] = {
          visible: true,
          extreme: "none",
          color: palette[state.nextColor++ % palette.length],
        };
      }
      // Points are independent of display settings and table sorting.
      dataset.pointCache ??= new Map();
      const cacheKey = `${dataset.xColumn}:${column.id}`;
      if (!dataset.pointCache.has(cacheKey)) {
        const points = pointsFor(dataset, column);
        points.forEach((point, index) => {
          point.isolated =
            point.value[1] != null &&
            points[index - 1]?.value[1] == null &&
            points[index + 1]?.value[1] == null;
        });
        dataset.pointCache.set(cacheKey, { points, stats: summarize(points) });
      }
      const cached = dataset.pointCache.get(cacheKey);
      result.push({
        id,
        name: multi ? `${dataset.name} - ${column.label}` : column.label,
        metric: column.label,
        dataset,
        column,
        ...cached,
        ...state.seriesPrefs[id],
      });
    }
  }
  // Guarantee unique ECharts legend names even if files/aliases have the same name.
  const names = new Set();
  for (const series of result) {
    const original = series.name;
    let count = 1;
    while (names.has(series.name)) series.name = `${original} (${++count})`;
    names.add(series.name);
  }
  return result;
}

export function sortRows(
  rows,
  columns,
  columnIndex,
  direction = "asc",
  query = "",
) {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle
    ? rows.filter((row) =>
        row.some((cell) => cell.toLocaleLowerCase().includes(needle)),
      )
    : [...rows];
  if (columnIndex == null) return filtered;
  const isNumeric = columns[columnIndex]?.numericCount > 0;
  return filtered.sort((a, b) => {
    const av = a[columnIndex] ?? "",
      bv = b[columnIndex] ?? "";
    let delta;
    if (isNumeric) {
      const an = numeric(av),
        bn = numeric(bv);
      if (an == null && bn != null) return 1;
      if (an != null && bn == null) return -1;
      delta =
        an == null ? av.localeCompare(bv, "zh-CN", { numeric: true }) : an - bn;
    } else delta = av.localeCompare(bv, "zh-CN", { numeric: true });
    return direction === "asc" ? delta : -delta;
  });
}
