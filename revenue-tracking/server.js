const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "revenues.json");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID || "";
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function loadRevenues() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveRevenue(record) {
  const all = loadRevenues();
  all.push(record);
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
}

function extractAmount(text) {
  const match = text.match(/\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  return parseFloat(match[0].replace(/,/g, ""));
}

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("revenue-tracking webhook is running"));

app.post("/webhook", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }

  const messages = req.body.messages || [];
  for (const message of messages) {
    if (message.from_me) continue;
    if (message.type !== "text") continue;
    if (ALLOWED_GROUP_ID && message.chat_id !== ALLOWED_GROUP_ID) continue;
    if (ALLOWED_SENDERS.length && !ALLOWED_SENDERS.includes(message.from)) continue;

    const rawText = message.text && message.text.body;
    if (!rawText) continue;

    const amount = extractAmount(rawText);
    saveRevenue({
      message_id: message.id,
      group_id: message.chat_id,
      from: message.from,
      from_name: message.from_name || null,
      amount,
      raw_text: rawText,
      message_timestamp: message.timestamp,
      received_at: new Date().toISOString(),
    });
  }

  res.sendStatus(200);
});

app.get("/revenues", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.json(loadRevenues());
});

app.listen(PORT, () => console.log(`revenue-tracking listening on ${PORT}`));
