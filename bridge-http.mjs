// HTTP polling bridge — replaces WebSocket for Figma plugin compatibility
// Plugin polls GET /poll for commands, POSTs responses to /respond
import http from 'http';

const PORT = parseInt(process.env.FIGMA_WS_PORT || '3055', 10);

// Queues
let commandQueue = [];    // Commands from MCP server → plugin
let responseQueue = [];   // Responses from plugin → MCP server
let pendingPolls = [];    // Long-poll waiters from plugin
let helloData = null;     // Last hello from plugin

// MCP server-side interface (WebSocket replacement)
// The MCP bridge.js calls send() and expects onMessage callbacks
const subscribers = new Map(); // id -> { resolve, reject, timer }
let reqCounter = 0;
let pluginConnected = false;

export function sendCommand(cmd) {
  commandQueue.push(JSON.stringify(cmd));
  // Wake any long-polling request
  while (pendingPolls.length > 0) {
    const res = pendingPolls.shift();
    if (!res.writableEnded) {
      const batch = commandQueue.splice(0);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(batch));
      return;
    }
  }
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Plugin polls for commands
  if (req.method === 'GET' && req.url === '/poll') {
    if (commandQueue.length > 0) {
      const batch = commandQueue.splice(0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(batch));
    } else {
      // Long poll — hold for up to 25s
      pendingPolls.push(res);
      const timer = setTimeout(() => {
        const idx = pendingPolls.indexOf(res);
        if (idx >= 0) pendingPolls.splice(idx, 1);
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      }, 25000);
      res.on('close', () => {
        clearTimeout(timer);
        const idx = pendingPolls.indexOf(res);
        if (idx >= 0) pendingPolls.splice(idx, 1);
      });
    }
    return;
  }

  // Plugin sends responses/hello
  if (req.method === 'POST' && req.url === '/respond') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        if (msg.type === 'hello') {
          helloData = msg;
          pluginConnected = true;
          console.log(`[bridge-http] Plugin connected: ${msg.documentName} (${msg.editorType})`);
        }
        responseQueue.push(msg);
        // Notify any waiting MCP command
        if (msg.id && subscribers.has(msg.id)) {
          const { resolve, timer } = subscribers.get(msg.id);
          clearTimeout(timer);
          subscribers.delete(msg.id);
          resolve(msg);
        }
      } catch (e) {
        console.error('[bridge-http] Bad response:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  // Status
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: pluginConnected,
      hello: helloData,
      pendingCommands: commandQueue.length
    }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[bridge-http] HTTP polling bridge on 0.0.0.0:${PORT}`);
});

// Export for MCP server integration
export { subscribers, reqCounter, pluginConnected, helloData, responseQueue };
