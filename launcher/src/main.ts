import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { RpcHandler, RpcError } from "./rpc";

/**
 * 融合应用 HTTP 服务：
 * - GET  /       -> 融合 web UI
 * - GET  /app.js -> 前端脚本
 * - POST /rpc    -> JSON-RPC 2.0
 */

const WEB_DIR = path.join(__dirname, "..", "web");

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function serveStatic(res: http.ServerResponse, file: string, contentType: string): void {
  const full = path.join(WEB_DIR, file);
  if (!fs.existsSync(full)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fs.readFileSync(full));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startServer(port = 8787, host = "127.0.0.1"): Promise<http.Server> {
  const handler = new RpcHandler();

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = req.url ?? "/";
        if (req.method === "GET" && (url === "/" || url === "/index.html")) {
          serveStatic(res, "index.html", "text/html; charset=utf-8");
          return;
        }
        if (req.method === "GET" && url === "/app.js") {
          serveStatic(res, "app.js", "text/javascript; charset=utf-8");
          return;
        }
        if (req.method === "POST" && url === "/rpc") {
          const body = await readBody(req);
          const request = JSON.parse(body) as { id?: unknown; method?: string; params?: unknown };
          if (typeof request.method !== "string") {
            sendJson(res, 200, { jsonrpc: "2.0", id: request.id ?? null, error: { code: -32600, message: "invalid request" } });
            return;
          }
          try {
            const result = handler.dispatch(request.method, request.params);
            sendJson(res, 200, { jsonrpc: "2.0", id: request.id ?? null, result });
          } catch (err) {
            const e = err instanceof RpcError ? err : new RpcError(-32603, err instanceof Error ? err.message : String(err));
            sendJson(res, 200, { jsonrpc: "2.0", id: request.id ?? null, error: { code: e.code, message: e.message } });
          }
          return;
        }
        res.writeHead(404);
        res.end("not found");
      } catch (err) {
        sendJson(res, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
      }
    })();
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8787);
  void startServer(port).then((server) => {
    console.log(`reasonix-fused 融合应用已启动: http://127.0.0.1:${port}`);
    void server;
  });
}
