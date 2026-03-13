const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const TEMP_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ✅ GitHub Secret name eka oyage widihata
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const activeJobs = new Set();
const processedMsgIds = new Set();

function safeUnlink(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function randomFile(ext = ".jpg") {
  return path.join(
    TEMP_DIR,
    `imgtxt_${Date.now()}_${crypto.randomBytes(5).toString("hex")}${ext}`
  );
}

function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessageV2) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessage) return unwrapMessage(message.viewOnceMessage.message);
  return message;
}

function getSenderJid(sock, mek) {
  return mek.key?.fromMe ? sock.user?.id : (mek.key?.participant || mek.key?.remoteJid);
}

function extractImageNode(mek) {
  const msg = unwrapMessage(mek?.message);
  if (!msg) return null;

  if (msg.imageMessage) return msg.imageMessage;
  return null;
}

async function downloadImageNode(imageNode, outPath) {
  const stream = await downloadContentFromMessage(imageNode, "image");
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

async function preprocessImage(inputPath, outputPath) {
  await sharp(inputPath)
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toFile(outputPath);

  return outputPath;
}

function cleanRawText(text = "") {
  return String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function runOCR(filePath) {
  const result = await Tesseract.recognize(filePath, "sin+eng", {
    logger: () => {},
  });

  return cleanRawText(result?.data?.text || "");
}

async function formatWithDeepSeek(rawText) {
  if (!DEEPSEEK_API_KEY) {
    return {
      title: "",
      formatted_text: rawText,
      notes: [],
    };
  }

  const systemPrompt = `
Return JSON only.

You clean OCR text extracted from an image.
Rules:
1. Keep the original language.
2. Preserve numbering, headings, labels, dates and structure.
3. Fix only obvious OCR spacing/line-break mistakes.
4. Do not invent missing text.
5. If some part is unreadable, keep it as close as possible and mark [අපැහැදිලි].
6. Output neat readable text for chat messages.

JSON format:
{
  "title": "short title or empty",
  "formatted_text": "clean formatted text",
  "notes": ["short notes if needed"]
}
`.trim();

  const userPrompt = `
Please clean this OCR text and return JSON.

OCR text:
${rawText}
`.trim();

  const res = await axios.post(
    DEEPSEEK_URL,
    {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1800
    },
    {
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 120000
    }
  );

  const content = res?.data?.choices?.[0]?.message?.content;
  if (!content) {
    return {
      title: "",
      formatted_text: rawText,
      notes: [],
    };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || "",
      formatted_text: parsed.formatted_text || rawText,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return {
      title: "",
      formatted_text: rawText,
      notes: [],
    };
  }
}

function buildFinalText(result) {
  const title = result?.title ? `📄 *${result.title}*\n\n` : "📝 *Image Text*\n\n";
  const body = result?.formatted_text || "No text found.";
  const notes =
    result?.notes?.length
      ? `\n\n⚠️ *Notes*\n${result.notes.map((n) => `• ${n}`).join("\n")}`
      : "";

  return `${title}${body}${notes}`.trim();
}

function splitText(text, maxLen = 3500) {
  const out = [];
  let remaining = text || "";

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < 1200) cut = maxLen;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.trim()) out.push(remaining.trim());
  return out;
}

global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push({
  onMessage: async (sock, mek) => {
    let originalPath = null;
    let processedPath = null;

    try {
      const from = mek.key?.remoteJid;
      if (!from || from === "status@broadcast") return;
      if (!mek.message) return;

      const msgId = mek.key?.id;
      if (msgId && processedMsgIds.has(msgId)) return;

      const imageNode = extractImageNode(mek);
      if (!imageNode) return;

      const sender = getSenderJid(sock, mek);
      if (!sender) return;

      const jobKey = `${from}:${sender}`;
      if (activeJobs.has(jobKey)) return;
      activeJobs.add(jobKey);

      if (msgId) {
        processedMsgIds.add(msgId);
        if (processedMsgIds.size > 500) {
          const first = processedMsgIds.values().next().value;
          processedMsgIds.delete(first);
        }
      }

      await sock.sendMessage(
        from,
        { text: "🔎 Searching for text in the image...." },
        { quoted: mek }
      );

      originalPath = randomFile(".jpg");
      processedPath = randomFile(".png");

      await downloadImageNode(imageNode, originalPath);
      await preprocessImage(originalPath, processedPath);

      const rawText = await runOCR(processedPath);

      if (!rawText || rawText.length < 3) {
        await sock.sendMessage(
          from,
          { text: "❌ Could not find text in image.." },
          { quoted: mek }
        );
        return;
      }

      let formatted;
      try {
        formatted = await formatWithDeepSeek(rawText);
      } catch (e) {
        console.log("DeepSeek format error:", e?.response?.data || e?.message || e);
        formatted = {
          title: "",
          formatted_text: rawText,
          notes: [],
        };
      }

      const finalText = buildFinalText(formatted);
      const parts = splitText(finalText, 3500);

      for (const part of parts) {
        await sock.sendMessage(
          from,
          { text: part },
          { quoted: mek }
        );
      }
    } catch (e) {
      console.log("AUTO IMG TEXT ERROR:", e);
      try {
        await sock.sendMessage(
          mek.key.remoteJid,
          { text: "❌ An error occurs when converting text." },
          { quoted: mek }
        );
      } catch {}
    } finally {
      safeUnlink(originalPath);
      safeUnlink(processedPath);

      const from = mek.key?.remoteJid;
      const sender = getSenderJid(sock, mek);
      if (from && sender) {
        activeJobs.delete(`${from}:${sender}`);
      }
    }
  },
});
