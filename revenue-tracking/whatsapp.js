const path = require("path");
const QRCode = require("qrcode");
const P = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const AUTH_DIR = process.env.BAILEYS_AUTH_DIR || path.join(__dirname, "baileys_auth");

let currentQrDataUrl = null;
let status = "starting";

function getQrDataUrl() {
  return currentQrDataUrl;
}

function getStatus() {
  return status;
}

function unwrapMessage(message) {
  // Disappearing-messages / view-once / edit wrappers nest the real content
  // one level deeper; unwrap until we hit an actual content type.
  let m = message;
  while (m && (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage)) {
    m = (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage).message;
  }
  return m;
}

function convertMessage(msg) {
  if (!msg.message) return null;

  const chatId = msg.key.remoteJid;
  const isGroup = chatId && chatId.endsWith("@g.us");
  const from = isGroup ? msg.key.participant || msg.participant : chatId;
  const content = unwrapMessage(msg.message);
  const text =
    (content &&
      (content.conversation ||
        (content.extendedTextMessage && content.extendedTextMessage.text) ||
        (content.imageMessage && content.imageMessage.caption) ||
        (content.videoMessage && content.videoMessage.caption))) ||
    null;

  return {
    id: msg.key.id,
    chat_id: chatId,
    from: from ? from.split("@")[0] : from,
    from_name: msg.pushName || null,
    from_me: Boolean(msg.key.fromMe),
    type: text ? "text" : "other",
    text: text ? { body: text } : undefined,
    timestamp: typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : Number(msg.messageTimestamp),
  };
}

async function start(onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    syncFullHistory: true,
    logger: P({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQrDataUrl = await QRCode.toDataURL(qr);
      status = "waiting_for_qr_scan";
      console.log("New WhatsApp QR code ready at /qr");
    }

    if (connection === "open") {
      currentQrDataUrl = null;
      status = "connected";
      console.log("WhatsApp connected");
    }

    if (connection === "close") {
      status = "disconnected";
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log("WhatsApp connection closed", { statusCode, loggedOut });
      if (!loggedOut) {
        setTimeout(() => start(onMessage), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const converted = convertMessage(msg);
      if (converted) onMessage(converted);
    }
  });

  // Sent once by WhatsApp after (re)linking a device, containing recent
  // chat history from the phone so older rep messages can be backfilled.
  sock.ev.on("messaging-history.set", ({ messages }) => {
    console.log(`History sync: processing ${messages.length} historical messages`);
    for (const msg of messages) {
      const converted = convertMessage(msg);
      if (converted) onMessage(converted);
    }
  });

  return sock;
}

module.exports = { start, getQrDataUrl, getStatus };
