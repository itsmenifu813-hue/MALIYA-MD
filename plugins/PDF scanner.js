const { cmd } = require("../command");
const axios = require("axios");
const pdf = require("pdf-parse");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set (pdf_ai_scanner plugin)");
}

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
  "gemini-pro-latest",
];

const MAX_TEXT_FOR_AI = 22000;
const MAX_REPLY_CHUNK = 3500;
const SEND_DELAY_MS = 350;

// -------------------- helpers --------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanExtractedText(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cutLongText(text, max = MAX_TEXT_FOR_AI) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[Text trimmed due to length]";
}

function splitForWhatsApp(text, size = MAX_REPLY_CHUNK) {
  const chunks = [];
  let remaining = (text || "").trim();

  while (remaining.length > size) {
    let splitIndex = remaining.lastIndexOf("\n", size);
    if (splitIndex < Math.floor(size * 0.6)) {
      splitIndex = remaining.lastIndexOf(" ", size);
    }
    if (splitIndex < Math.floor(size * 0.6)) {
      splitIndex = size;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendLargeText(bot, jid, text, quoted) {
  const parts = splitForWhatsApp(text);
  for (const part of parts) {
    await bot.sendMessage(jid, { text: part }, { quoted });
    await sleep(SEND_DELAY_MS);
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function downloadPdfBuffer(docMessage) {
  const stream = await downloadContentFromMessage(docMessage, "document");
  return await streamToBuffer(stream);
}

function getPdfMessage(msg) {
  if (!msg) return null;

  if (
    msg.documentMessage &&
    msg.documentMessage.mimetype === "application/pdf"
  ) {
    return msg.documentMessage;
  }

  const quoted =
    msg.extendedTextMessage?.contextInfo?.quotedMessage ||
    msg.imageMessage?.contextInfo?.quotedMessage ||
    msg.videoMessage?.contextInfo?.quotedMessage ||
    msg.documentWithCaptionMessage?.message?.documentMessage;

  if (
    quoted?.documentMessage &&
    quoted.documentMessage.mimetype === "application/pdf"
  ) {
    return quoted.documentMessage;
  }

  if (
    msg.documentWithCaptionMessage?.message?.documentMessage &&
    msg.documentWithCaptionMessage.message.documentMessage.mimetype === "application/pdf"
  ) {
    return msg.documentWithCaptionMessage.message.documentMessage;
  }

  return null;
}

function guessIfQuestionPaper(text = "") {
  const t = text.toLowerCase();

  const patterns = [
    /\bquestion\b/,
    /\bquestions\b/,
    /\banswer\b/,
    /\banswers\b/,
    /\bactivity\b/,
    /\bworksheet\b/,
    /\bmodel paper\b/,
    /\bexam\b/,
    /\btest\b/,
    /\bfill in the blanks\b/,
    /\btrue\b.*\bfalse\b/,
    /\bmatch the\b/,
    /\bchoose\b/,
    /\bwrite\b/,
    /\breading\b/,
    /\blistening\b/,
    /\bmcq\b/,
    /\(\d+\)/,
    /\bप्र/i,
    /ප්‍රශ්න/,
    /පිළිතුරු/,
    /අභ්‍යාස/,
    /වරණ/,
  ];

  let hits = 0;
  for (const p of patterns) {
    if (p.test(t)) hits++;
  }

  return hits >= 2;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callGemini(prompt) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 4096,
        },
      };

      const res = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 120000,
      });

      const text =
        res.data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("\n")
          .trim() || "";

      if (text) return text;
      lastError = new Error(`Empty response from ${model}`);
    } catch (err) {
      console.log(`[PDF AI] model failed: ${model} -> ${err.message}`);
      lastError = err;
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

async function analyzePdfText(fileName, extractedText, pageCount) {
  const trimmedText = cutLongText(cleanExtractedText(extractedText), MAX_TEXT_FOR_AI);

  const prompt = `
You are an AI PDF study assistant.

You are given text extracted from a PDF.
Important:
- Ignore images completely.
- Do NOT mention image extraction limits unless text is missing.
- Detect the document language.
- Detect whether it is a question paper / worksheet / exercise / model paper / exam / study sheet.
- If it contains questions, answer them in the SAME language as the paper.
- Make the response very clean, student-friendly, and easy to read.
- Do not make the response too robotic.
- If some answers are uncertain due to missing text, say so briefly.
- If it is not really a question paper, provide a clean summary instead.

Return ONLY valid JSON in this exact structure:

{
  "language": "English or Sinhala or Tamil or Mixed",
  "doc_type": "Question Paper" or "Normal PDF",
  "title": "short title",
  "short_intro": "very short user friendly intro",
  "cleaned_text": "cleaned and structured extracted text",
  "answers": "final answers in same language, or 'No questions detected.'",
  "needs_answers": true
}

PDF file name: ${fileName}
Page count: ${pageCount}

EXTRACTED TEXT:
${trimmedText}
`;

  const raw = await callGemini(prompt);
  const parsed = safeJsonParse(raw);

  if (parsed) return parsed;

  // fallback format if model didn't return clean JSON
  return {
    language: "Unknown",
    doc_type: guessIfQuestionPaper(trimmedText) ? "Question Paper" : "Normal PDF",
    title: fileName || "PDF Analysis",
    short_intro: "PDF analysis completed.",
    cleaned_text: trimmedText,
    answers: guessIfQuestionPaper(trimmedText)
      ? "Questions detected, but AI returned an invalid formatted response."
      : "No questions detected.",
    needs_answers: guessIfQuestionPaper(trimmedText),
  };
}

function buildResponseMessage(result, fileName, pageCount) {
  const language = result.language || "Unknown";
  const docType = result.doc_type || "Normal PDF";
  const title = result.title || fileName || "PDF";
  const intro = result.short_intro || "PDF analysis completed.";
  const cleanedText = (result.cleaned_text || "").trim();
  const answers = (result.answers || "").trim();
  const hasAnswers =
    answers &&
    !/^no questions detected\.?$/i.test(answers) &&
    !/^no question detected\.?$/i.test(answers);

  let msg = "";
  msg += `📄 *PDF AI Scanner*\n\n`;
  msg += `📝 *File:* ${fileName}\n`;
  msg += `📚 *Title:* ${title}\n`;
  msg += `🌐 *Language:* ${language}\n`;
  msg += `📄 *Pages:* ${pageCount}\n`;
  msg += `📌 *Type:* ${docType}\n\n`;
  msg += `✨ ${intro}\n\n`;

  if (cleanedText) {
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `📖 *Cleaned Text*\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `${cleanedText}\n\n`;
  }

  if (hasAnswers) {
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `✅ *Answers*\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `${answers}\n`;
  } else {
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `ℹ️ *Answers*\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `No questions detected.\n`;
  }

  return msg.trim();
}

// -------------------- status command --------------------

cmd(
  {
    pattern: "pdfscan",
    alias: ["pdfai", "autopdf"],
    desc: "Check PDF AI scanner plugin status",
    category: "utility",
    react: "📄",
    filename: __filename,
  },
  async (bot, mek, m, { reply }) => {
    return reply(
      `✅ *PDF AI Scanner Active*\n\n` +
      `• PDF auto detect කරනවා\n` +
      `• text extract කරනවා\n` +
      `• images bypass කරනවා\n` +
      `• question paper නම් answer දෙනවා\n` +
      `• paper එකේ language එකෙන්ම reply කරනවා`
    );
  }
);

// -------------------- auto listener --------------------

cmd(
  {
    on: "body",
    dontAddCommandList: true,
    filename: __filename,
  },
  async (bot, mek, m, { from }) => {
    try {
      if (!GEMINI_API_KEY) return;
      if (!mek?.message) return;

      const pdfMessage = getPdfMessage(mek.message);
      if (!pdfMessage) return;
      if (pdfMessage.mimetype !== "application/pdf") return;

      const fileName = pdfMessage.fileName || "document.pdf";
      const senderName =
        mek.pushName ||
        mek.key?.participant ||
        mek.key?.remoteJid ||
        "User";

      await bot.sendMessage(
        from,
        {
          text:
            `📄 *PDF Detected*\n\n` +
            `👤 *Sender:* ${senderName}\n` +
            `📎 *File:* ${fileName}\n\n` +
            `⏳ PDF එක scan කරලා questions තියෙනවද බලනවා...`,
        },
        { quoted: mek }
      );

      const pdfBuffer = await downloadPdfBuffer(pdfMessage);

      let parsedPdf;
      try {
        parsedPdf = await pdf(pdfBuffer);
      } catch (err) {
        await bot.sendMessage(
          from,
          {
            text:
              `❌ *PDF parse කරන්න බැරි වුණා.*\n\n` +
              `මෙක image-only scanned PDF එකක් වෙන්න පුළුවන්.\n` +
              `මේ plugin එක images bypass කරන නිසා OCR කරන්නේ නෑ.`,
          },
          { quoted: mek }
        );
        return;
      }

      const rawText = cleanExtractedText(parsedPdf.text || "");
      const pageCount = parsedPdf.numpages || 0;

      if (!rawText || rawText.length < 20) {
        await bot.sendMessage(
          from,
          {
            text:
              `⚠️ *Text extract වුණේ නෑ.*\n\n` +
              `මෙක selectable text නැති scanned/image PDF එකක් වෙන්න පුළුවන්.\n` +
              `ඔයා කියපු විදියට images bypass කරන නිසා image OCR ගන්නේ නෑ.`,
          },
          { quoted: mek }
        );
        return;
      }

      const aiResult = await analyzePdfText(fileName, rawText, pageCount);
      const finalMessage = buildResponseMessage(aiResult, fileName, pageCount);

      await sendLargeText(bot, from, finalMessage, mek);

      // optional: send original pdf back with short caption
      await bot.sendMessage(
        from,
        {
          document: pdfBuffer,
          mimetype: "application/pdf",
          fileName,
          caption:
            `📎 *Original PDF*\n` +
            `🌐 Language: ${aiResult.language || "Unknown"}\n` +
            `📌 Type: ${aiResult.doc_type || "Normal PDF"}`,
        },
        { quoted: mek }
      );
    } catch (err) {
      console.error("PDF AI Scanner Error:", err);

      try {
        await bot.sendMessage(
          mek.key.remoteJid,
          {
            text:
              `❌ *PDF scanner error*\n\n` +
              `Reason: ${err.message || "Unknown error"}`,
          },
          { quoted: mek }
        );
      } catch {}
    }
  }
);
