export function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

export function numeric(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function displayNumber(value, precision = 6) {
  if (value == null) return "—";
  if (precision === "raw") return String(value);
  const n = numeric(value);
  return n == null ? String(value) : n.toFixed(Number(precision));
}

export const palette = [
  "#3563e9",
  "#11a58b",
  "#8b5bd6",
  "#e88937",
  "#db5982",
  "#188db5",
  "#71832e",
  "#9b6752",
  "#4c607d",
  "#b443ba",
];
export const baseName = (name) => name.replace(/\.csv$/i, "");
export const seriesKey = (datasetId, columnId) => `${datasetId}:${columnId}`;
