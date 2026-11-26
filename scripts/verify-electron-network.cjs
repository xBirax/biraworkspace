// Synthetic local HTTP response; never reads the user's app profile or accounts.
const { app, net } = require("electron");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
app.setPath("userData",fs.mkdtempSync(path.join(os.tmpdir(),"bira-network-fixture-")));

const server = http.createServer((_request, response) => {
  response.writeHead(503, {
    "content-type": "text/plain",
    "content-length": String(128 * 1024),
    connection: "close",
  });
  response.end(Buffer.alloc(128 * 1024, 0x61));
});

const timeout = setTimeout(() => {
  server.closeAllConnections();
  server.close();
  app.exit(2);
}, 15_000);

app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await net.fetch(`http://127.0.0.1:${address.port}/filters`, {
      credentials: "omit",
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    console.log("Electron network error-response cancellation: passed");
    clearTimeout(timeout);
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    server.closeAllConnections();
    server.close();
    app.exit(1);
  }
});
