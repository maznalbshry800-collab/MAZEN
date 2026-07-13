const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "revenues.json");
const SEEN_CHATS_FILE = process.env.SEEN_CHATS_FILE || path.join(__dirname, "seen-chats.json");
const TALLIES_DIR = process.env.TALLIES_DIR || path.join(__dirname, "tallies");
const PRICES_FILE = process.env.PRICES_FILE || path.join(__dirname, "courses-prices.json");
const COURSE_PRICES = JSON.parse(fs.readFileSync(PRICES_FILE, "utf8"));
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const ALLOWED_GROUP_IDS = `${process.env.ALLOWED_GROUP_IDS || ""},${process.env.ALLOWED_GROUP_ID || ""}`
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// "group_id:country,group_id2:country2" e.g. "120363...@g.us:العراق,120363...@g.us:لبنان"
const GROUP_COUNTRY = Object.fromEntries(
  (process.env.GROUP_COUNTRY_MAP || "")
    .split(",")
    .map((pair) => pair.split(":").map((s) => s.trim()))
    .filter((pair) => pair.length === 2 && pair[0])
    .map(([groupId, country]) => [groupId.toLowerCase(), country])
);

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function arabicMonth(unixSeconds) {
  const d = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  return ARABIC_MONTHS[d.getMonth()];
}

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

// Expected message shape: "اسم العميل / اسم المنتج  السعر$"
// The price actually recorded always comes from COURSE_PRICES (the reference
// file), never from the number typed in the message.
function parseRepMessage(text) {
  let customer = null;
  let productAndPrice = text.trim();

  const slashIndex = text.indexOf("/");
  if (slashIndex !== -1) {
    customer = text.slice(0, slashIndex).trim();
    productAndPrice = text.slice(slashIndex + 1).trim();
  }

  const trailingPrice = productAndPrice.match(/^(.*?)\s*[\d.,]+\s*\$?\s*$/);
  const product = (trailingPrice ? trailingPrice[1] : productAndPrice).trim();

  const price = Object.prototype.hasOwnProperty.call(COURSE_PRICES, product)
    ? COURSE_PRICES[product]
    : null;

  return { customer, product, price, matched: price !== null };
}

function tallyFilePath(country, month) {
  return path.join(TALLIES_DIR, `${country}-${month}.json`);
}

function loadTally(country, month) {
  const file = tallyFilePath(country, month);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return Object.entries(COURSE_PRICES).map(([product, price]) => ({
    product,
    price_sar: price.sar,
    price_usd: price.usd,
    count: 0,
    amount_sar: 0,
    amount_usd: 0,
  }));
}

function saveTally(country, month, rows) {
  if (!fs.existsSync(TALLIES_DIR)) fs.mkdirSync(TALLIES_DIR, { recursive: true });
  fs.writeFileSync(tallyFilePath(country, month), JSON.stringify(rows, null, 2));
}

function incrementTally(country, month, product) {
  const rows = loadTally(country, month);
  const row = rows.find((r) => r.product === product);
  if (!row) return;
  row.count += 1;
  row.amount_sar = Math.round((row.count * row.price_sar + Number.EPSILON) * 100) / 100;
  row.amount_usd = row.count * row.price_usd;
  saveTally(country, month, rows);
}

function processMessage(message) {
  if (message.from_me) return;

  if (message.chat_id && message.chat_id.endsWith("@g.us")) {
    recordSeenChat(message);
  }

  if (message.type !== "text") return;
  if (ALLOWED_GROUP_IDS.length && !ALLOWED_GROUP_IDS.includes((message.chat_id || "").toLowerCase())) return;
  if (ALLOWED_SENDERS.length && !ALLOWED_SENDERS.includes(message.from)) return;

  const rawText = message.text && message.text.body;
  if (!rawText) return;

  const { customer, product, price, matched } = parseRepMessage(rawText);
  const country = GROUP_COUNTRY[(message.chat_id || "").toLowerCase()] || null;
  const month = arabicMonth(message.timestamp);

  if (matched && country) {
    incrementTally(country, month, product);
  }

  saveRevenue({
    message_id: message.id,
    group_id: message.chat_id,
    country,
    month,
    from: message.from,
    from_name: message.from_name || null,
    customer,
    product,
    price_sar: matched ? price.sar : null,
    price_usd: matched ? price.usd : null,
    matched,
    raw_text: rawText,
    message_timestamp: message.timestamp,
    received_at: new Date().toISOString(),
  });
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
    processMessage(message);
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

app.get("/tally/:country/:month", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.json(loadTally(req.params.country, req.params.month));
});

app.get("/seen-chats", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.json(loadJsonArray(SEEN_CHATS_FILE));
});

const whatsapp = require("./whatsapp");

app.get("/qr", (req, res) => {
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  const qr = whatsapp.getQrDataUrl();
  const status = whatsapp.getStatus();
  const refresh = `<meta http-equiv="refresh" content="10">`;
  if (!qr) {
    return res.send(`${refresh}<h2>WhatsApp status: ${status}</h2><p>No QR code needed right now (either already connected, or not generated yet — this page auto-refreshes every 10s).</p>`);
  }
  res.send(`${refresh}<h2>Scan this with WhatsApp (Linked Devices) — scan quickly, it expires in ~20s and this page auto-refreshes</h2><img src="${qr}" /><p>Status: ${status}</p>`);
});

whatsapp.start(processMessage).catch((err) => console.error("WhatsApp connection error:", err));

app.listen(PORT, () => console.log(`revenue-tracking listening on ${PORT}`));
