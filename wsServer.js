/**
 * wsServer.js — y-websocket Server
 *
 * This is the WebSocket sync server for Yjs documents.
 * It uses the y-websocket utility to handle:
 * - Document sync (Yjs binary protocol)
 * - Awareness protocol (cursor positions, user presence)
 * - Room management (each roomId = a separate document)
 *
 * Runs on port 1234 by default.
 * Deploy to Render as a separate service.
 */
const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
require('dotenv').config();


const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 1234;

// Create a plain HTTP server (required by ws)
const server = http.createServer((req, res) => {
  // Health check endpoint for Render / load balancers
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'collabdocs-ws' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('CollabDocs WebSocket Server');
});

// Create WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({ server });

wss.on('connection', (conn, req) => {
  // setupWSConnection handles the full Yjs sync protocol:
  // 1. Reads the room name from the URL path (e.g., /my-room-id)
  // 2. Creates or retrieves the Y.Doc for that room (in-memory)
  // 3. Syncs the document state to the new client
  // 4. Forwards updates from this client to all others in the room
  // 5. Manages awareness states (cursor positions, user info)
  setupWSConnection(conn, req);
});

server.listen(PORT, HOST, () => {
  console.log(` y-websocket server running on ws://${HOST}:${PORT}`);
  console.log(`   Health check: http://${HOST}:${PORT}/health`);
});
