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

async function start(onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
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
      if (!msg.message) continue;

      const chatId = msg.key.remoteJid;
      const isGroup = chatId && chatId.endsWith("@g.us");
      const from = isGroup ? msg.key.participant : chatId;
      const text =
        msg.message.conversation ||
        (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) ||
        null;

      onMessage({
        id: msg.key.id,
        chat_id: chatId,
        from: from ? from.split("@")[0] : from,
        from_name: msg.pushName || null,
        from_me: Boolean(msg.key.fromMe),
        type: text ? "text" : "other",
        text: text ? { body: text } : undefined,
        timestamp: typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : Number(msg.messageTimestamp),
      });
    }
  });

  return sock;
}

module.exports = { start, getQrDataUrl, getStatus };
