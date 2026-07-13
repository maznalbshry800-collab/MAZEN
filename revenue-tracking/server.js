const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "revenues.json");
const SEEN_CHATS_FILE = process.env.SEEN_CHATS_FILE || path.join(__dirname, "seen-chats.json");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const ALLOWED_GROUP_IDS = `${process.env.ALLOWED_GROUP_IDS || ""},${process.env.ALLOWED_GROUP_ID || ""}`
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function loadJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadRevenues() {
  return loadJsonArray(DATA_FILE);
}

function saveRevenue(record) {
  const all = loadRevenues();
  all.push(record);
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
}

function recordSeenChat(message) {
  const chats = loadJsonArray(SEEN_CHATS_FILE);
  const existing = chats.find((c) => c.chat_id === message.chat_id);
  const rawText = (message.text && message.text.body) || `[${message.type}]`;
  if (existing) {
    existing.last_from = message.from;
    existing.last_from_name = message.from_name || null;
    existing.last_text = rawText;
    existing.last_seen = new Date().toISOString();
    existing.count = (existing.count || 0) + 1;
  } else {
    chats.push({
      chat_id: message.chat_id,
      last_from: message.from,
      last_from_name: message.from_name || null,
      last_text: rawText,
      last_seen: new Date().toISOString(),
      count: 1,
    });
  }
  fs.writeFileSync(SEEN_CHATS_FILE, JSON.stringify(chats, null, 2));
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

    if (message.chat_id && message.chat_id.endsWith("@g.us")) {
      recordSeenChat(message);
    }

    if (message.type !== "text") continue;
    if (ALLOWED_GROUP_IDS.length && !ALLOWED_GROUP_IDS.includes((message.chat_id || "").toLowerCase())) continue;
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

app.get("/debug-config", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.json({
    ALLOWED_GROUP_IDS: ALLOWED_GROUP_IDS.map((s) => JSON.stringify(s)),
    ALLOWED_SENDERS: ALLOWED_SENDERS.map((s) => JSON.stringify(s)),
    WEBHOOK_SECRET_set: Boolean(WEBHOOK_SECRET),
  });
});

app.get("/seen-chats", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.json(loadJsonArray(SEEN_CHATS_FILE));
});

app.listen(PORT, () => console.log(`revenue-tracking listening on ${PORT}`));
