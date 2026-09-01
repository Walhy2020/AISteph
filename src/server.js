import http from "node:http";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";
import { initializeWorkspace } from "./core/workspace.js";
import { addLink, addText, importFile } from "./core/intake.js";
import { getInboxStats, listInbox } from "./core/inbox.js";
import { getVersion } from "./version.js";

const HOST = "127.0.0.1";
const JSON_LIMIT = 1024 * 1024;
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "web");
const STATIC_FILES = new Map([
  ["/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

class ByteLimitTransform extends Transform {
  constructor(maxBytes) {
    super();
    this.maxBytes = maxBytes;
    this.bytes = 0;
  }

  _transform(chunk, encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(new HttpError(413, "上传文件超过大小限制"));
      return;
    }
    callback(null, chunk);
  }
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, securityHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, securityHeaders("text/plain; charset=utf-8"));
  response.end(message);
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim();
  if (contentType !== "application/json") {
    throw new HttpError(415, "请求必须使用 application/json");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > JSON_LIMIT) throw new HttpError(413, "请求内容过大");

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > JSON_LIMIT) throw new HttpError(413, "请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON格式无效");
  }
}

function requireToken(request, token) {
  if (request.headers["x-aisteph-token"] !== token) {
    throw new HttpError(403, "本地访问令牌无效");
  }
}

function requireSameOrigin(request, origin) {
  const suppliedOrigin = request.headers.origin;
  if (suppliedOrigin && suppliedOrigin !== origin) {
    throw new HttpError(403, "拒绝跨来源写入");
  }
}

function cleanText(value, fieldName, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, `${fieldName}不能为空`);
  if (text.length > maxLength) throw new HttpError(400, `${fieldName}过长`);
  return text;
}

async function saveUpload(request, config) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > config.maxUploadBytes) {
    throw new HttpError(413, "上传文件超过大小限制");
  }
  const uploadRoot = path.join(config.dataRootPath, ".uploads");
  await mkdir(uploadRoot, { recursive: true });
  const temporaryPath = path.join(uploadRoot, `${randomUUID()}.upload`);
  try {
    await pipeline(
      request,
      new ByteLimitTransform(config.maxUploadBytes),
      createWriteStream(temporaryPath, { flags: "wx" })
    );
    return temporaryPath;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function serveIndex(response, version, token) {
  const template = await readFile(path.join(WEB_ROOT, "index.html"), "utf8");
  const html = template
    .replaceAll("__AISTEPH_VERSION__", version)
    .replaceAll("__AISTEPH_TOKEN__", token)
    .replace('src="/assets/app.js" defer', 'src="/assets/app.js" type="module"');
  response.writeHead(200, securityHeaders("text/html; charset=utf-8"));
  response.end(html);
}

async function serveStatic(pathname, response) {
  const descriptor = STATIC_FILES.get(pathname);
  if (!descriptor) return false;
  const [fileName, contentType] = descriptor;
  const content = await readFile(path.join(WEB_ROOT, fileName));
  response.writeHead(200, securityHeaders(contentType));
  response.end(content);
  return true;
}

async function handleApi(context, request, response, requestUrl) {
  const { config, log, token, startedAt, origin } = context;
  requireToken(request, token);

  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    const stats = await getInboxStats(config);
    sendJson(response, 200, {
      ok: true,
      version: config.version,
      startedAt,
      uptimeSeconds: Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
      storage: {
        dataRoot: config.dataRoot,
        vaultRoot: config.vaultRoot,
        logsRoot: config.logsRoot
      },
      limits: {
        maxUploadBytes: config.maxUploadBytes
      },
      stats
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/inbox") {
    const items = await listInbox(config, {
      limit: requestUrl.searchParams.get("limit"),
      type: requestUrl.searchParams.get("type"),
      status: requestUrl.searchParams.get("status")
    });
    sendJson(response, 200, { items });
    return;
  }

  if (request.method !== "POST") {
    throw new HttpError(405, "请求方法不支持");
  }
  requireSameOrigin(request, origin);

  if (requestUrl.pathname === "/api/intake/text") {
    const input = await readJson(request);
    const record = await addText(config, log, {
      title: String(input.title ?? "").slice(0, 200),
      text: input.text
    });
    sendJson(response, 201, { record });
    return;
  }

  if (requestUrl.pathname === "/api/intake/link") {
    const input = await readJson(request);
    const record = await addLink(config, log, {
      title: String(input.title ?? "").slice(0, 200),
      url: input.url
    });
    sendJson(response, 201, { record });
    return;
  }

  if (requestUrl.pathname === "/api/intake/file") {
    const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim();
    if (contentType !== "application/octet-stream") {
      throw new HttpError(415, "文件上传必须使用 application/octet-stream");
    }
    const fileName = cleanText(requestUrl.searchParams.get("name"), "文件名", 255);
    const title = String(requestUrl.searchParams.get("title") ?? "").trim().slice(0, 200);
    const temporaryPath = await saveUpload(request, config);
    try {
      const record = await importFile(config, log, {
        title,
        inputPath: temporaryPath,
        originalName: fileName
      });
      sendJson(response, 201, { record });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
    return;
  }

  throw new HttpError(404, "接口不存在");
}

export async function createAIStephServer(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const version = await getVersion();
  const config = await loadConfig(workspaceRoot);
  config.version = version;
  await initializeWorkspace(config);

  const log = createLogger(config);
  const token = randomBytes(24).toString("base64url");
  const startedAt = new Date().toISOString();
  let origin = null;

  const server = http.createServer(async (request, response) => {
    const requestStarted = Date.now();
    try {
      const requestUrl = new URL(request.url ?? "/", origin ?? "http://127.0.0.1");
      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi({ config, log, token, startedAt, origin }, request, response, requestUrl);
      } else if (request.method === "GET" && requestUrl.pathname === "/") {
        await serveIndex(response, version, token);
      } else if (request.method === "GET" && await serveStatic(requestUrl.pathname, response)) {
        // Static response completed.
      } else {
        sendText(response, 404, "页面不存在");
      }
      await log("info", "http.request", {
        method: request.method,
        route: requestUrl.pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - requestStarted
      });
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      sendJson(response, statusCode, {
        error: statusCode >= 500 ? "本地服务发生错误" : error.message
      });
      await log("error", "http.request_failed", {
        method: request.method,
        route: String(request.url ?? "").split("?")[0],
        statusCode,
        durationMs: Date.now() - requestStarted,
        errorName: error.name,
        errorMessage: error.message
      }).catch(() => {});
    }
  });

  server.on("clientError", (error, socket) => {
    log("warn", "http.client_error", {
      errorName: error.name,
      errorMessage: error.message
    }).catch(() => {});
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return {
    config,
    token,
    server,
    get origin() {
      return origin;
    },
    async start() {
      if (origin) return origin;
      const port = options.port ?? config.serverPort;
      if (options.host && options.host !== HOST) {
        throw new Error("AISteph管理台只允许绑定127.0.0.1");
      }
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      origin = `http://${HOST}:${address.port}`;
      await log("info", "server.started", {
        host: HOST,
        port: address.port,
        pid: process.pid
      });
      return origin;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await log("info", "server.stopped", { pid: process.pid });
      origin = null;
    }
  };
}

async function runMain() {
  const app = await createAIStephServer();
  const origin = await app.start();
  console.log(`AISteph v${app.config.version} 管理台已启动`);
  console.log(origin);
  console.log("按 Ctrl+C 停止服务");

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await runMain();
}
