import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number.parseInt(process.env.PORT || "4173", 10);
const apiBaseUrl = process.env.INSIGHTA_API_BASE_URL || "http://localhost:3000";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[extension] || "application/octet-stream";
  const content = await fs.readFile(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/config.js") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.end(
        `window.__INSIGHTA_CONFIG__ = ${JSON.stringify({
          apiBaseUrl,
        })};`
      );
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const absolutePath = path.normalize(path.join(publicDir, requestedPath));

    if (!absolutePath.startsWith(publicDir)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    try {
      await serveFile(res, absolutePath);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    await serveFile(res, path.join(publicDir, "index.html"));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Internal server error");
  }
});

server.listen(port, () => {
  console.log(`Insighta web portal listening on http://localhost:${port}`);
});
