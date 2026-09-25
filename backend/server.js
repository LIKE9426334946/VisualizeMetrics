import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "./storage.js";
import { handleAPI } from "./api.js";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3045);
const store = await new FileStore(
  process.env.DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url)),
).init();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  let url;
  try {
    url = new URL(request.url, "http://localhost");
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (await handleAPI(request, response, url, store)) return;
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname === "/health") {
      response.writeHead(200, {
        "Content-Type": mimeTypes[".json"],
        "Cache-Control": "no-store",
      });
      response.end(
        request.method === "HEAD"
          ? undefined
          : JSON.stringify({ status: "ok", app: "VisualizeMetrics" }),
      );
      return;
    }
    const file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(root) || pathname.includes("\0")) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const extension = path.extname(file);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else
      createReadStream(file)
        .on("error", () => response.destroy())
        .pipe(response);
  } catch (error) {
    response.writeHead(
      error instanceof URIError ? 400 : error.code === "ENOENT" ? 404 : 500,
    );
    response.end(
      error instanceof URIError
        ? "Bad request"
        : error.code === "ENOENT"
          ? "Not found"
          : "Server error",
    );
  }
});
server.listen(port, host, () =>
  console.log(
    `VisualizeMetrics running at http://${host}:${server.address().port}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
