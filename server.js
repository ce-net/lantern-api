// Lantern API: neighbourhood events. Plain Node, no dependencies.
const http = require("http");
const events = [
  { id: 1, title: "Street cleanup", when: "2026-11-01T10:00", where: "Main square" },
  { id: 2, title: "Board game night", when: "2026-11-03T19:00", where: "Library" },
];
const port = +process.env.PORT || 8080;
http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(events));
  }
  res.writeHead(404); res.end();
}).listen(port, () => console.log("lantern-api on", port));
