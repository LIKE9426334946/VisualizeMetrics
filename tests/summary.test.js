import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "../frontend/src/csv.js";
import {
  summaryFields,
  normalizeSummaryConfig,
  buildSummary,
} from "../frontend/src/summary-data.js";

const dataset = (id, text) => ({
  ...parseCSV(text, `${id}.csv`),
  id,
  name: id,
  enabled: false,
});
const a = dataset(
  "UNet",
  "epoch,val_iou,val_f1,val_loss,note\n3,0.8,0.7,0.1,third\n1,0.4,0.9,0.5,first\n2,0.8,0.6,0.3,second",
);
const b = dataset(
  "UNet++",
  "epoch,val_iou,val_f1,val_loss,note\n1,0.9,0.8,0.4,best\n2,0.7,0.9,0.2,last",
);
function make(datasets = [a, b], saved = {}) {
  const fields = summaryFields(datasets);
  const config = normalizeSummaryConfig(fields, saved);
  return { fields, config, model: buildSummary(datasets, fields, config) };
}
const cell = (model, rowId, key) =>
  model.rows.find((row) => row.id === rowId).cells[
    model.columns.findIndex((column) => column.key === key)
  ].text;

test("directory summary ranks each model's maximum IoU numerically, regardless of curve visibility", () => {
  const { model, config } = make();
  assert.equal(config.rankMetric, "val_iou");
  assert.deepEqual(
    model.rows.map((row) => row.name),
    ["UNet++", "UNet"],
  );
  assert.equal(cell(model, "UNet", "value:val_iou"), "0.8000");
  assert.equal(cell(model, "UNet", "epoch:val_iou"), "2");
  assert.equal(cell(model, "UNet", "value:val_f1"), "0.9000");
  assert.equal(cell(model, "UNet", "epoch:val_f1"), "1");
  assert.equal(cell(model, "UNet", "value:val_loss"), "0.1000");
});

test("aligned mode reads all values, epoch and text from the exact ranking row", () => {
  const { fields, config } = make([a, b], { mode: "aligned" });
  config.columns.forEach((column) => {
    column.selected = true;
  });
  const model = buildSummary([a, b], fields, config);
  assert.equal(cell(model, "UNet", "value:epoch"), "2");
  assert.equal(cell(model, "UNet", "value:val_f1"), "0.6000");
  assert.equal(cell(model, "UNet", "value:val_loss"), "0.3000");
  assert.equal(cell(model, "UNet", "value:note"), "second");
  assert.ok(!model.columns.some((column) => column.kind === "epoch"));
});

test("minimum/last ranking, ascending order, missing metrics and invalid values remain correct", () => {
  const missing = dataset("Missing", "epoch,other\n1,99");
  const invalid = dataset(
    "Invalid",
    "epoch,val_loss\ninvalid,-100\n1,NaN\n2,\n3,Infinity",
  );
  const datasets = [b, missing, a, invalid];
  const { model } = make(datasets, {
    rankMetric: "val_loss",
    rankMethod: "min",
    direction: "asc",
  });
  assert.deepEqual(
    model.rows.map((row) => row.id),
    ["UNet", "UNet++", "Missing", "Invalid"],
  );
  assert.equal(cell(model, "Missing", "value:val_loss"), "—");
  const { model: last } = make([a, b], {
    rankMethod: "last",
    direction: "asc",
  });
  assert.deepEqual(
    last.rows.map((row) => row.id),
    ["UNet++", "UNet"],
  );
  assert.equal(cell(last, "UNet", "epoch:val_iou"), "3");
});

test("custom and duplicate headers, no epoch fallback, and chart X changes do not corrupt summary Epoch", () => {
  const custom = dataset("Custom", "score,score,other\n-2,3,1\n1e-2,4,2\n,5,3");
  const { model, config } = make([custom]);
  assert.equal(config.rankMetric, "score [列 1]");
  assert.equal(cell(model, "Custom", "value:score [列 1]"), "0.0100");
  assert.equal(cell(model, "Custom", "epoch:score [列 1]"), "2");
  const changedAxis = { ...a, xColumn: "c3" };
  const rebuilt = make([changedAxis]).model;
  assert.equal(cell(rebuilt, "UNet", "epoch:val_iou"), "2");
});

test("column choices and precision are restored while sorting uses full, unrounded values", () => {
  const lower = dataset("Lower", "epoch,score\n1,0.900001");
  const higher = dataset("Higher", "epoch,score\n1,0.900002");
  const { config, fields } = make([lower, higher]);
  config.columns.forEach((column) => {
    column.selected = column.field === "score";
    column.showEpoch = false;
  });
  config.precision = "2";
  const restored = normalizeSummaryConfig(
    fields,
    JSON.parse(JSON.stringify(config)),
  );
  const model = buildSummary([lower, higher], fields, restored);
  assert.deepEqual(
    model.rows.map((row) => row.id),
    ["Higher", "Lower"],
  );
  assert.equal(model.columns.length, 2);
  assert.equal(cell(model, "Higher", "value:score"), "0.90");
  restored.columns.forEach((column) => {
    column.selected = false;
  });
  assert.equal(
    buildSummary(
      [lower, higher],
      fields,
      normalizeSummaryConfig(fields, restored),
    ).columns.length,
    1,
  );
});

test("tied extrema use the earliest valid epoch and duplicate epochs retain source row identity", () => {
  const duplicate = dataset(
    "Duplicate",
    "epoch,score,loss\n3,1,0.1\n1,1,0.7\n1,1,0.9",
  );
  const { model } = make([duplicate], { mode: "aligned" });
  assert.equal(cell(model, "Duplicate", "value:loss"), "0.7000");
});

test("aligned rows show invalid numeric cells as missing while retaining text fields", () => {
  const invalid = dataset(
    "Invalid cell",
    "epoch,score,loss,note\n1,1,NaN,best\n2,0.8,0.2,last",
  );
  const { config, fields } = make([invalid], { mode: "aligned" });
  config.columns.forEach((column) => {
    column.selected = true;
  });
  const model = buildSummary([invalid], fields, config);
  assert.equal(cell(model, invalid.id, "value:loss"), "—");
  assert.equal(cell(model, invalid.id, "value:note"), "best");
});
