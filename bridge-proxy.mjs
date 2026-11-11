import http from 'http';
import { WebSocketServer } from 'ws';
import { Bridge } from './server/bridge.js';

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

const wss = new WebSocketServer({ server: httpServer });
const bridge = new Bridge({ port: 3055 });
bridge._started = true;
bridge._wss = wss;
wss.on('connection', (ws) => bridge._onConnection(ws));

const HOST = process.env.FIGMA_BRIDGE_HOST || '127.0.0.1';
httpServer.listen(3055, HOST, () => {
  console.log(`HTTP+WS server on ${HOST}:3055`);
});
