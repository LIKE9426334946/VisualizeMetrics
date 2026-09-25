import { escapeHTML } from "./utils.js";
import { download } from "./export.js";

const font =
  '"Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif';
const xml = (text) =>
  escapeHTML(
    String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""),
  );

// Create a complete vector table from the same cells shown in the page, including
// rows and columns outside its scrolling viewport. PNG rasterizes this same SVG.
function tableSVG(model) {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("浏览器无法创建图片，请换一个浏览器重试。");
  measure.font = `14px ${font}`;
  const wrap = (text, width) =>
    String(text)
      .split(/\r?\n/)
      .flatMap((paragraph) => {
        const lines = [];
        let line = "";
        for (const character of paragraph) {
          if (line && measure.measureText(line + character).width > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
        lines.push(line);
        return lines;
      });
  const widths = model.columns.map((column, i) => {
    let width = Math.max(
      measure.measureText(column.label).width,
      measure.measureText(column.prefix || "").width,
    );
    for (const row of model.rows)
      width = Math.max(width, measure.measureText(row.cells[i].text).width);
    return Math.min(
      i === 0 ? 300 : 240,
      Math.max(i === 0 ? 180 : 110, Math.ceil(width) + 40),
    );
  });
  const width = Math.max(
    760,
    widths.reduce((sum, value) => sum + value, 0) + 64,
  );
  widths[0] += width - 64 - widths.reduce((sum, value) => sum + value, 0);
  const cells = model.rows.map((row) =>
    row.cells.map((cell, index) => wrap(cell.text, widths[index] - 32)),
  );
  const headers = model.columns.map((column, index) =>
    wrap(
      [column.prefix, column.label].filter(Boolean).join("\n"),
      widths[index] - 32,
    ),
  );
  const heights = cells.map((row) =>
    Math.max(48, Math.max(...row.map((lines) => lines.length)) * 21 + 24),
  );
  const headerHeight =
    Math.max(...headers.map((lines) => lines.length)) * 21 + 28;
  const titleLines = wrap(model.title, ((width - 64) * 14) / 24);
  const descriptionLines = wrap(
    `${model.rows.length} 个模型 · ${model.description}`,
    width - 64,
  );
  const tableTop =
    32 + titleLines.length * 32 + descriptionLines.length * 21 + 24;
  const noteLines = wrap(
    `${model.note} 缺失值显示 —，缺失排序指标的模型排在末尾；缺少 epoch 时使用数据行号。`,
    width - 64,
  );
  const footerTop =
    tableTop +
    headerHeight +
    heights.reduce((sum, value) => sum + value, 0) +
    24;
  const height = footerTop + noteLines.length * 21 + 32;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${xml(model.title)}</title><rect width="100%" height="100%" fill="#ffffff"/><g font-family="${xml(font)}">`,
  ];
  const text = (
    lines,
    x,
    y,
    color = "#33435e",
    size = 14,
    weight = 400,
    anchor = "start",
  ) => {
    parts.push(
      `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? (size === 24 ? 32 : 21) : 0}">${xml(line)}</tspan>`).join("")}</text>`,
    );
  };
  text(titleLines, 32, 54, "#21304a", 24, 600);
  text(descriptionLines, 32, 32 + titleLines.length * 32 + 20, "#73829b");
  parts.push(
    `<rect x="32" y="${tableTop}" width="${width - 64}" height="${headerHeight}" fill="#f1f5fc"/>`,
  );
  let x = 32;
  headers.forEach((lines, i) => {
    text(
      lines,
      x + (i ? widths[i] / 2 : 16),
      tableTop + (headerHeight - lines.length * 21) / 2 + 16,
      "#4d6081",
      14,
      600,
      i ? "middle" : "start",
    );
    x += widths[i];
  });
  let y = tableTop + headerHeight;
  cells.forEach((row, index) => {
    const leading = index === 0 && model.rows[index].rankValue != null;
    parts.push(
      `<rect x="32" y="${y}" width="${width - 64}" height="${heights[index]}" fill="${leading ? "#eef3ff" : index % 2 ? "#fafbfd" : "#fff"}"/>`,
    );
    let left = 32;
    row.forEach((lines, i) => {
      text(
        lines,
        left + (i ? widths[i] / 2 : 16),
        y + (heights[index] - lines.length * 21) / 2 + 16,
        leading ? "#305bb3" : "#33435e",
        14,
        leading || !i ? 600 : 400,
        i ? "middle" : "start",
      );
      left += widths[i];
    });
    y += heights[index];
    parts.push(`<path d="M32 ${y} H${width - 32}" stroke="#e7ecf3"/>`);
  });
  text(noteLines, 32, footerTop + 14, "#73829b", 13);
  parts.push("</g></svg>");
  return { svg: parts.join(""), width, height };
}

export async function exportSummary(format, model) {
  if (!model.rows.length) throw new Error("当前目录暂无可导出的模型。");
  await document.fonts.ready;
  const { svg, width, height } = tableSVG(model);
  let blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  if (format === "png") {
    const scale = 2;
    if (
      width * scale > 16000 ||
      height * scale > 16000 ||
      width * height * scale ** 2 > 64_000_000
    )
      throw new Error(
        "表格过大，请下载 SVG 完整矢量图片，或减少显示字段后下载 PNG。",
      );
    const source = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG 生成失败，请尝试下载 SVG。");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG 生成失败，请尝试下载 SVG。");
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  const filename = model.title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 100);
  download(blob, `${filename}.${format}`);
}
