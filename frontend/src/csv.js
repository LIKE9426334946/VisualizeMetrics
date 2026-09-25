import Papa from "papaparse";
import { numeric, baseName } from "./utils.js";

// Papa Parse owns CSV syntax, quoting, delimiters, BOM and newline handling.
// Arrays preserve duplicate headers and avoid treating user input as object keys.
export function parseCSV(text, filename = "metrics.csv") {
  if (!String(text).trim())
    throw new Error("CSV 文件为空，请选择包含表头和数据的文件。");
  const parsed = Papa.parse(String(text).replace(/^\uFEFF/, ""), {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });
  const quoteError = parsed.errors.find((error) => error.type === "Quotes");
  if (quoteError) throw new Error(`CSV 引号格式有误：${quoteError.message}`);
  if (parsed.data.length < 2)
    throw new Error("CSV 需要一行表头和至少一行数据。");

  const [headers, ...inputRows] = parsed.data;
  const warnings = [];
  let width = headers.length;
  for (const row of inputRows) width = Math.max(width, row.length);
  const mismatch = inputRows.filter(
    (row) => row.length !== headers.length,
  ).length;
  if (mismatch)
    warnings.push(
      `${mismatch} 行的列数与表头不同；缺少的值留空，额外值保留在新增列中。`,
    );
  const counts = new Map();
  const columns = Array.from({ length: width }, (_, index) => {
    const rawName = headers[index] ?? "";
    const name = rawName.trim() ? rawName : `未命名列 ${index + 1}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    return {
      id: `c${index}`,
      index,
      rawName,
      name,
      label: name,
      numericCount: 0,
      invalidCount: 0,
      missingCount: 0,
    };
  });
  for (const column of columns) {
    if (counts.get(column.name) > 1)
      column.label = `${column.name} [列 ${column.index + 1}]`;
  }
  if ([...counts.values()].some((count) => count > 1))
    warnings.push("存在重复表头，指标使用列号区分；原始表格保留表头。");
  if (columns.some((column) => !column.rawName.trim()))
    warnings.push("空白或缺失表头已使用列号命名。");

  const rows = inputRows.map((row) =>
    columns.map((column) => row[column.index] ?? ""),
  );
  for (const row of rows) {
    for (const column of columns) {
      const cell = row[column.index];
      if (!cell.trim()) column.missingCount++;
      else if (numeric(cell) == null) column.invalidCount++;
      else column.numericCount++;
    }
  }
  const epoch = columns.find(
    (column) => column.name.trim().toLowerCase() === "epoch",
  );
  if (!epoch)
    warnings.push(
      "未找到 epoch 列，默认以数据行号（从 1 开始）作为 X 轴；可在文件设置中更换。",
    );
  if (epoch && epoch.numericCount < rows.length)
    warnings.push(
      `${rows.length - epoch.numericCount} 行 epoch 为空或无效，使用该列绘图时跳过；原始数据仍保留。`,
    );
  const numericColumns = columns.filter(
    (column) => column.numericCount > 0 && column.id !== epoch?.id,
  );
  if (
    numericColumns.some((column) => column.invalidCount || column.missingCount)
  )
    warnings.push(
      "部分指标含空值或非数值，曲线在这些位置断开，统计忽略这些值。",
    );
  if (!numericColumns.length)
    warnings.push("尚无可绘制的数值指标，可查看原始数据或更换 X 轴。");
  if (epoch) {
    const seen = new Set();
    let duplicates = 0;
    for (const row of rows) {
      const x = numeric(row[epoch.index]);
      if (x == null) continue;
      if (seen.has(x)) duplicates++;
      seen.add(x);
    }
    if (duplicates)
      warnings.push(
        `${duplicates} 行使用重复 epoch；全部保留，相同 epoch 按原始行序排列。`,
      );
  }
  return {
    filename,
    name: baseName(filename),
    columns,
    rows,
    warnings,
    xColumn: epoch?.id ?? "__row",
    enabled: true,
  };
}
