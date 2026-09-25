import { readFile } from "node:fs/promises";
import { parseCSV } from "../frontend/src/csv.js";
import { httpError } from "./storage.js";

export const MAX_CSV_BYTES = 50 * 1024 * 1024;

async function body(request, limit) {
  if (Number(request.headers["content-length"]) > limit)
    throw httpError(413, "文件或请求过大，单个 CSV 最大支持 50 MB。");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit)
      throw httpError(413, "文件或请求过大，单个 CSV 最大支持 50 MB。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request) {
  if (!request.headers["content-type"]?.includes("application/json"))
    throw httpError(415, "需要 application/json 请求。");
  const buffer = await body(request, 1024 * 1024);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw httpError(400, "JSON 格式无效。");
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export async function handleAPI(request, response, url, store) {
  if (!url.pathname.startsWith("/api/")) return false;
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        request.headers["sec-fetch-site"] === "cross-site" ||
        (origin && new URL(origin).host !== request.headers.host)
      )
        throw httpError(403, "请从当前网站执行文件管理操作。");
    }
    const route = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, store.snapshot());
    } else if (request.method === "POST" && url.pathname === "/api/folders") {
      const payload = await jsonBody(request);
      json(response, 201, await store.createFolder(payload?.name));
    } else if (
      request.method === "DELETE" &&
      route.length === 3 &&
      route[1] === "folders"
    ) {
      json(response, 200, await store.deleteFolder(route[2]));
    } else if (
      request.method === "POST" &&
      route.length === 4 &&
      route[1] === "folders" &&
      route[3] === "files"
    ) {
      const filename = url.searchParams.get("name");
      if (
        !filename ||
        filename.length > 240 ||
        !/\.csv$/i.test(filename) ||
        /[\u0000-\u001f/\\]/.test(filename)
      )
        throw httpError(400, "请选择有效的 .csv 文件名。");
      const buffer = await body(request, MAX_CSV_BYTES);
      let dataset;
      try {
        dataset = parseCSV(
          new TextDecoder("utf-8", { fatal: true }).decode(buffer),
          filename,
        );
      } catch (error) {
        throw httpError(400, `CSV 无法读取：${error.message}`);
      }
      json(
        response,
        201,
        await store.upload(route[2], filename, buffer, dataset.rows.length),
      );
    } else if (
      request.method === "GET" &&
      route.length === 3 &&
      route[1] === "files"
    ) {
      const file = store.file(route[2]);
      const buffer = await readFile(file.path);
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Length": buffer.length,
        "Cache-Control": "no-store",
      });
      response.end(buffer);
    } else if (
      request.method === "DELETE" &&
      route.length === 3 &&
      route[1] === "files"
    ) {
      json(response, 200, await store.deleteFile(route[2]));
    } else if (
      ["PUT", "POST"].includes(request.method) &&
      url.pathname === "/api/workspace"
    ) {
      json(
        response,
        200,
        await store.saveWorkspace((await jsonBody(request)) ?? {}),
      );
    } else {
      throw httpError(404, "接口不存在。");
    }
  } catch (error) {
    if (!error.status) console.error("API request failed:", error);
    json(response, error.status ?? 500, {
      error: error.status ? error.message : "服务器读写失败，请稍后重试。",
    });
  }
  return true;
}
