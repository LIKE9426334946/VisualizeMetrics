import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "../frontend/src/csv.js";
import {
  pointsFor,
  summarize,
  sortRows,
  metricList,
  buildSeries,
} from "../frontend/src/data.js";
import { numeric } from "../frontend/src/utils.js";

test("BOM, CRLF, quoted commas and newlines preserve original fields", () => {
  const dataset = parseCSV(
    '\uFEFFepoch,"custom,score",note\r\n1,0.123456789012,"hello, world"\r\n2,0.5,"two\nlines"\r\n',
  );
  assert.equal(dataset.columns[1].label, "custom,score");
  assert.equal(dataset.rows[0][1], "0.123456789012");
  assert.equal(dataset.rows[1][2], "two\nlines");
  assert.deepEqual(
    metricList([dataset]).map((column) => column.label),
    ["custom,score"],
  );
});

test("invalid values are gaps, invalid epoch is skipped, extrema use sorted valid data", () => {
  const dataset = parseCSV(
    "epoch,score\n3,0.6\n1,0.2\n2,\n4,NaN\n5,0.6\n6,Infinity\ninvalid,99\n7,text",
  );
  const points = pointsFor(dataset, dataset.columns[1]);
  assert.deepEqual(
    points.map((point) => point.value),
    [
      [1, 0.2],
      [2, null],
      [3, 0.6],
      [4, null],
      [5, 0.6],
      [6, null],
      [7, null],
    ],
  );
  const stats = summarize(points);
  assert.equal(stats.min.rawX, "1");
  assert.equal(stats.max.rawX, "3");
  assert.equal(stats.maxCount, 2);
  assert.equal(stats.last.rawX, "5");
  assert.equal(stats.count, 3);
  assert.equal(stats.missing, 4);
});

test("arbitrary headers, duplicates, uneven columns and row-index fallback remain usable", () => {
  const dataset = parseCSV("score,score,description\n1,2,first\n3\n4,5,last,9");
  assert.equal(dataset.xColumn, "__row");
  assert.equal(dataset.columns.length, 4);
  assert.equal(dataset.columns[0].label, "score [列 1]");
  assert.equal(dataset.columns[1].label, "score [列 2]");
  assert.deepEqual(dataset.rows[1], ["3", "", "", ""]);
  assert.equal(pointsFor(dataset, dataset.columns[0])[2].value[0], 3);
  assert.ok(dataset.warnings.length >= 3);
});

test("negative/scientific/zero values work; whitespace, booleans and partial numbers do not become zero", () => {
  assert.equal(numeric("-1.25e-3"), -0.00125);
  assert.equal(numeric("0"), 0);
  assert.equal(numeric(".5"), 0.5);
  for (const value of ["", " ", "true", "1a", "Infinity", "0x10"])
    assert.equal(numeric(value), null);
});

test("numeric sorting keeps blanks last and never changes the source row order", () => {
  const dataset = parseCSV("epoch,score\n1,10\n2,2\n3,\n4,-1");
  const sorted = sortRows(dataset.rows, dataset.columns, 1, "asc");
  assert.deepEqual(
    sorted.map((row) => row[1]),
    ["-1", "2", "10", ""],
  );
  assert.deepEqual(
    dataset.rows.map((row) => row[0]),
    ["1", "2", "3", "4"],
  );
  assert.equal(
    sortRows(dataset.rows, dataset.columns, null, "asc", "-1").length,
    1,
  );
});

test("different files retain their own epochs and missing metrics are not fabricated", () => {
  const a = { ...parseCSV("epoch,score\n1,0.2\n4,0.9"), id: "a" };
  const b = {
    ...parseCSV("epoch,score,other\n2,0.3,8\n3,0.4,9\n8,0.7,10"),
    id: "b",
  };
  const state = {
    datasets: [a, b],
    selected: new Set(["score", "other"]),
    seriesPrefs: {},
    nextColor: 0,
  };
  const series = buildSeries(state);
  assert.equal(series.length, 3);
  assert.deepEqual(
    series[0].points.map((point) => point.value[0]),
    [1, 4],
  );
  assert.deepEqual(
    series[1].points.map((point) => point.value[0]),
    [2, 3, 8],
  );
  assert.notEqual(series[0].name, series[1].name);
});

test("empty/header-only/malformed CSV reports actionable errors", () => {
  assert.throws(() => parseCSV(""), /为空/);
  assert.throws(() => parseCSV("epoch,score"), /至少一行数据/);
  assert.throws(() => parseCSV('epoch,score\n1,"unclosed'), /引号/);
});
