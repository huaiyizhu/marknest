const http = require("node:http");
const path = require("node:path");
const { createApp } = require("./app");
const { createDatabase } = require("./database");

const port = Number(process.env.PORT || 4173);
const databaseFile = process.env.DATABASE_FILE || path.resolve(__dirname, "..", "data", "marknest.db");
const db = createDatabase(databaseFile);
const server = http.createServer(createApp(db));

server.listen(port, () => {
  console.log(`Marknest listening on http://localhost:${port}`);
});

