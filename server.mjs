import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

function writeJson(response, statusCode, body) {
  const responseBody = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(responseBody),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(responseBody);
}

function getRequestedPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://localhost:${port}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const requestedPath = path.resolve(root, relativePath);
  if (requestedPath !== root && !requestedPath.startsWith(`${root}${path.sep}`)) return null;
  return requestedPath;
}

async function resolveFile(requestUrl) {
  const requestedPath = getRequestedPath(requestUrl);
  if (!requestedPath) return null;
  try {
    const metadata = await stat(requestedPath);
    return metadata.isDirectory() ? path.join(requestedPath, "index.html") : requestedPath;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  try {
    const requestUrl = request.url || "/";
    const pathname = new URL(requestUrl, `http://localhost:${port}`).pathname;
    if (request.method === "GET" && pathname === "/api/config") {
      if (!supabaseUrl || !supabasePublishableKey) {
        writeJson(response, 503, { error: "Supabase configuration unavailable." });
        return;
      }
      writeJson(response, 200, {
        supabasePublishableKey,
        supabaseUrl
      });
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end();
      return;
    }
    const filePath = await resolveFile(requestUrl);
    if (!filePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const metadata = await stat(filePath);
    response.writeHead(200, {
      "Content-Length": metadata.size,
      "Content-Type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`FrancisWorks dashboard running at http://localhost:${port}`);
});
