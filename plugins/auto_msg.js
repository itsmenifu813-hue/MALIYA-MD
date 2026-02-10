const { cmd } = require("../command");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ✅ Only this plugin uses KEY2
const API_KEY = process.env.GEMINI_API_KEY2;
if (!API_KEY) console.error("GEMINI_API_KEY2 is not set (auto_msg plugin)");

// =========================
// ✅ Model candidates (try in order)
// =========================
const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
  "gemini-pro-latest",
];

// =========================
// Settings
// =========================
const PREFIXES = ["."];
const STORE = path.join(process.cwd(), "data", "auto_msg.json");
const COOLDOWN_MS = 2500;

// =========================
// Store helpers
// =========================
function ensureStore() {
  const dir = path.dirname(STORE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, JSON.stringify({ chats: {} }, null, 2));
}
function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch {
    return { chats: {} };
  }
}
function writeStore(db) {
  ensureStore();
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2));
}
function setEnabled(chatId, val) {
  const db = readStore();
  db.chats[chatId] = !!val;
  writeStore(db);
}
function isEnabled(chatId) {
  const db = readStore();
  return !!db.chats[chatId];
}

// =========================
// Cooldown
// =========================
const lastReplyAt = new Map();
function inCooldown(chatId) {
  const now = Date.now();
  const last = lastReplyAt.get(chatId) || 0;
  if (now - last < COOLDOWN_MS) return true;
  lastReplyAt.set(chatId, now);
  return false;
}

// =========================
// Language detect
// =========================
function detectLang(text) {
  if (!text) return "en";
  if (/[අ-෴]/.test(text)) return "si";
  return "en";
}

// =========================
// Identity replies
// =========================
function checkIdentity(text, lang) {
  const t = (text || "").toLowerCase();

  const sinKeys = ["oya kawda", "kawda oya", "oyawa haduwe", "haduwe kawda", "oya kawuruda"];
  const enKeys = ["who are you", "who made you", "who created you", "who built you", "your creator"];

  const hit = sinKeys.some(k => t.includes(k)) || enKeys.some(k => t.includes(k));
  if (!hit) return null;

  if (lang === "si") {
    return "මම **MALIYA-MD bot**. මම **Malindu Nadith** විසින් හදපු AI powered advanced bot එකක්.";
  }

  // ✅ exact line you gave (English)
  return "I am MALIYA-MD bot.I am an ai powerd advace bot made by malindu nadith";
}

// =========================
// Prompt builder
// =========================
function buildChatPrompt(userText, lang) {
  if (lang === "si") {
    return `
ඔබ WhatsApp එකේ friendly AI assistant කෙනෙක්.
පිළිතුරු කෙටි, පැහැදිලි, උදව්කාරී ලෙස සිංහලෙන් දෙන්න.
User message: ${userText}
`.trim();
  }

  return `
You are a friendly WhatsApp assistant.
Reply short, clear, and helpful in English.
User message: ${userText}
`.trim();
}

// =========================
// Gemini call (KEY2 only)
// =========================
async function geminiGenerate(prompt) {
  if (!API_KEY) throw new Error("Missing GEMINI_API_KEY2 (auto_msg plugin)");

  let lastErr = null;

  for (const model of MODEL_CANDIDATES) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const res = await axios.post(
        url,
        { contents: [{ parts: [{ text: prompt }] }] },
        {
          timeout: 30000,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY, // ✅ KEY2
          },
        }
      );

      const out = res?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (out && out.length > 1) return out;

      lastErr = new Error("Empty response from Gemini");
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      if (status === 404) continue;
      break;
    }
  }

  throw lastErr || new Error("Unknown Gemini error");
}

// =========================
// .msg on/off/status
// =========================
cmd(
  {
    pattern: "msg",
    desc: "Auto AI reply ON/OFF",
    category: "AI",
    react: "💬",
    filename: __filename,
  },
  async (conn, mek, m, { from, q, reply }) => {
    const arg = (q || "").trim().toLowerCase();

    if (!arg) return reply("Use:\n.msg on\n.msg off\n.msg status");

    if (arg === "on") {
      setEnabled(from, true);
      return reply("✅ Auto Reply: ON");
    }

    if (arg === "off") {
      setEnabled(from, false);
      return reply("⛔ Auto Reply: OFF");
    }

    if (arg === "status") {
      return reply(`ℹ️ Auto Reply: ${isEnabled(from) ? "ON" : "OFF"}`);
    }

    return reply("Use:\n.msg on\n.msg off\n.msg status");
  }
);

// =========================
// Hook called from index.js plugin loop
// =========================
async function onMessage(conn, mek, m, ctx = {}) {
  try {
    const from = ctx.from || mek?.key?.remoteJid;
    if (!from) return;

    if (!isEnabled(from)) return;
    if (mek?.key?.fromMe) return;

    const body = (ctx.body || "").trim();
    if (!body) return;

    // ignore commands
    for (const p of PREFIXES) {
      if (body.startsWith(p)) return;
    }

    if (inCooldown(from)) return;

    const lang = detectLang(body);

    const idReply = checkIdentity(body, lang);
    if (idReply) {
      return await conn.sendMessage(from, { text: idReply }, { quoted: mek });
    }

    const prompt = buildChatPrompt(body, lang);
    const out = await geminiGenerate(prompt);

    if (out) {
      await conn.sendMessage(from, { text: out }, { quoted: mek });
    }
  } catch (e) {
    console.log("AUTO_MSG ERROR:", e?.response?.status, e?.response?.data || e?.message || e);
  }
}

module.exports = { onMessage };
