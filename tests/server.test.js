import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "../backend/storage.js";

const entry = fileURLToPath(new URL("../backend/server.js", import.meta.url));
let directory, server, base;
async function start() {
  server = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: "0", DATA_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  server.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => {
      if (code) reject(new Error(errors));
    });
    server.stdout.once("data", (chunk) => {
      base = String(chunk).match(/http:\/\/[^\s]+/)[0];
      resolve();
    });
  });
}
async function stop() {
  if (!server || server.exitCode != null) return;
  await new Promise((resolve) => {
    server.once("exit", resolve);
    server.kill();
  });
}
async function request(route, method = "GET", value, headers = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { status: response.status, value: await response.json() };
}
async function upload(folder, filename, text) {
  const response = await fetch(
    `${base}/api/folders/${folder}/files?name=${encodeURIComponent(filename)}`,
    { method: "POST", headers: { "Content-Type": "text/csv" }, body: text },
  );
  return { status: response.status, value: await response.json() };
}
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "metrics-api-test-"));
  await start();
});
after(async () => {
  await stop();
  await rm(directory, { recursive: true, force: true });
});

test("directory and CSV storage preserve UTF-8/BOM bytes and never overwrite equal filenames", async () => {
  const folder = (await request("/api/folders", "POST", { name: "水体分割" }))
    .value;
  const csv = "\uFEFFepoch,score,备注\r\n1,0.25,训练\r\n2,0.625,验证\r\n";
  const a = await upload(folder.id, "metrics.csv", csv);
  const b = await upload(folder.id, "metrics.csv", csv);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.value.id, b.value.id);
  const bytes = Buffer.from(
    await (await fetch(`${base}/api/files/${a.value.id}`)).arrayBuffer(),
  );
  assert.deepEqual(bytes, Buffer.from(csv));
  assert.deepEqual(
    await readFile(
      path.join(directory, "uploads", folder.id, `${a.value.id}.csv`),
    ),
    Buffer.from(csv),
  );
  const snapshot = (await request("/api/state")).value;
  assert.equal(
    snapshot.files.filter((file) => file.folderId === folder.id).length,
    2,
  );
});

test("invalid CSV, duplicate folders, traversal-like names and cross-origin writes are rejected", async () => {
  const { folders, files } = (await request("/api/state")).value;
  assert.equal(
    (await request("/api/folders", "POST", { name: folders[0].name })).status,
    409,
  );
  assert.equal(
    (await request("/api/folders", "POST", { name: "../outside" })).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/folders",
        "POST",
        { name: "x" },
        { Origin: "https://other.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await upload(folders[0].id, "broken.csv", 'epoch,score\n1,"open')).status,
    400,
  );
  assert.equal(
    (await upload(folders[0].id, "../../secret.csv", "epoch,a\n1,2")).status,
    400,
  );
  assert.equal(
    (await upload("not-a-folder", "metrics.csv", "epoch,a\n1,2")).status,
    404,
  );
  assert.equal((await request("/api/state")).value.files.length, files.length);
  assert.equal((await fetch(`${base}/data/index.json`)).status, 404);
});

test("concurrent uploads and folder creation do not lose metadata updates", async () => {
  const folder = (await request("/api/folders", "POST", { name: "并发写入" }))
    .value;
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      upload(folder.id, `${i}.csv`, `epoch,score\n1,${i}`),
    ),
  );
  assert.ok(results.every((result) => result.status === 201));
  const snapshot = (await request("/api/state")).value;
  assert.equal(
    snapshot.files.filter((file) => file.folderId === folder.id).length,
    4,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"))
      .files,
    snapshot.files,
  );
});

test("workspace and files survive service restart; late pagehide saves cannot revert newer edits", async () => {
  const { folders, files } = (await request("/api/state")).value;
  const value = {
    schema: 1,
    mode: "files",
    activeFolderId: folders[1].id,
    datasets: [{ id: files[0].id, name: "UNet", enabled: true, xColumn: "c0" }],
    selected: ["score"],
    seriesPrefs: {
      [`${files[0].id}:c1`]: {
        visible: true,
        extreme: "both",
        color: "#3563e9",
      },
    },
    settings: {
      title: "持久化验证",
      xLabel: "Epoch",
      yLabel: "Score",
      lineWidth: 3,
    },
    view: { zoom: [20, 78], legendScroll: 1 },
    tableId: files[0].id,
    precision: "8",
    openFiles: [files[0].id],
  };
  assert.equal(
    (
      await request("/api/workspace", "PUT", {
        clientId: "test",
        sequence: 2,
        value,
      })
    ).status,
    200,
  );
  const late = await request("/api/workspace", "POST", {
    clientId: "test",
    sequence: 1,
    value: { ...value, settings: { title: "stale" } },
  });
  assert.equal(late.value.saved, false);
  await stop();
  await start();
  const snapshot = (await request("/api/state")).value;
  assert.deepEqual(snapshot.workspace.value, value);
  assert.equal(snapshot.files.length, files.length);
  assert.equal((await fetch(`${base}/api/files/${files[0].id}`)).status, 200);
});

test("deleting a file or populated directory removes bytes and prunes saved chart references", async () => {
  const { files } = (await request("/api/state")).value;
  const file = files[0];
  assert.equal((await request(`/api/files/${file.id}`, "DELETE")).status, 200);
  await assert.rejects(
    access(path.join(directory, "uploads", file.folderId, `${file.id}.csv`)),
  );
  let snapshot = (await request("/api/state")).value;
  assert.deepEqual(snapshot.workspace.value.datasets, []);
  assert.deepEqual(snapshot.workspace.value.seriesPrefs, {});
  const deleted = await request(`/api/folders/${file.folderId}`, "DELETE");
  assert.equal(deleted.status, 200);
  assert.equal(deleted.value.deletedFileIds.length, 1);
  snapshot = (await request("/api/state")).value;
  assert.ok(!snapshot.folders.some((folder) => folder.id === file.folderId));
  assert.ok(!snapshot.files.some((item) => item.folderId === file.folderId));
  await assert.rejects(access(path.join(directory, "uploads", file.folderId)));
  assert.equal((await request(`/api/files/${file.id}`, "DELETE")).status, 404);
});

test("an unreadable or malformed index is never silently replaced with empty data", async () => {
  const broken = await mkdtemp(path.join(tmpdir(), "metrics-index-test-"));
  try {
    await writeFile(path.join(broken, "index.json"), "broken json");
    await assert.rejects(new FileStore(broken).init());
    assert.equal(
      await readFile(path.join(broken, "index.json"), "utf8"),
      "broken json",
    );
  } finally {
    await rm(broken, { recursive: true, force: true });
  }
});
