import { WebSocketServer } from "ws";

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

let nextId = 1;
const clients = new Map(); // ws -> id

wss.on("connection", (ws) => {
  const id = "User" + nextId++;
  clients.set(ws, id);
  console.log(id + " connected");

  ws.on("message", (data) => {
    const text = data.toString();
    console.log(id + ": " + text);
    for (const [client, clientId] of clients) {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(JSON.stringify({ from: clientId, text }));
      }
    }
  });

  ws.on("close", () => {
    console.log(id + " disconnected");
    clients.delete(ws);
  });
});

console.log("WebSocket chat server listening on ws://localhost:" + PORT);
