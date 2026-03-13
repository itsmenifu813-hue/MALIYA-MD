const { cmd } = require("../command");
const { ytmp4 } = require("sadaslk-dlcore");
const yts = require("yt-search");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/* ================= STORAGE ================= */

const STORE_PATH = path.join(__dirname, "csong_targets.json");
const TEMP_DIR = path.join(__dirname, "../temp");

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { groups: [] };
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8") || '{"groups":[]}');
  } catch {
    return { groups: [] };
  }
}

/* ================= HELPERS ================= */

function getBodyFromMek(mek) {
  const msg = mek?.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ""
  );
}

function getSenderJid(sock, mek) {
  return mek.key?.fromMe ? sock.user?.id : (mek.key?.participant || mek.key?.remoteJid);
}

async function getYoutube(query) {
  const isUrl = /(youtube\.com|youtu\.be)/i.test(query);
  if (isUrl) {
    const id = query.includes("v=")
      ? query.split("v=")[1].split("&")[0]
      : query.split("/").pop().split("?")[0];

    const r = await yts({ videoId: id });
    return r?.title ? r : null;
  }

  const search = await yts(query);
  return search.videos?.[0];
}

function generateProgressBar(duration) {
  const totalBars = 10;
  const bar = "─".repeat(totalBars);
  return `*00:00* ${bar}○ *${duration || "0:00"}*`;
}

async function getGroupName(bot, jid) {
  try {
    const meta = await bot.groupMetadata(jid);
    return meta?.subject || jid;
  } catch {
    return jid;
  }
}

function sanitizeFileName(name = "youtube_video") {
  return String(name).replace(/[\\/:*?"<>|]/g, "").trim() || "youtube_video";
}

function getFileSizeMB(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size / (1024 * 1024);
}

async function downloadFile(url, filePath) {
  const writer = fs.createWriteStream(filePath);
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 180000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  res.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function reencodeForWhatsApp(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-profile:v main",
        "-level 3.1",
        "-preset veryfast",
        "-crf 28",
        "-maxrate 1200k",
        "-bufsize 2400k",
        "-vf scale='min(854,iw)':-2"
      ])
      .format("mp4")
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });
}

function safeUnlink(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function makeUserPreviewCaption(video, extraLine = "") {
  const title = video?.title || "Unknown Title";
  const channel = video?.author?.name || "Unknown";
  const duration = video?.timestamp || "0:00";
  const views = Number(video?.views || 0).toLocaleString();
  const uploaded = video?.ago || "Unknown";
  const progressBar = generateProgressBar(duration);

  return `
🎬 *${title}*

👤 *Channel:* ${channel}
⏱ *Duration:* ${duration}
👀 *Views:* ${views}
📅 *Uploaded:* ${uploaded}

${progressBar}
${extraLine ? `\n\n${extraLine}` : ""}
  `.trim();
}

function makeVideoCaption(video, sizeMB, modeLabel = "Video") {
  const title = video?.title || "Unknown Title";
  const channel = video?.author?.name || "Unknown";
  const duration = video?.timestamp || "0:00";
  const views = Number(video?.views || 0).toLocaleString();
  const uploaded = video?.ago || "Unknown";

  return `🎬 *${title}*

👤 *Channel:* ${channel}
⏱ *Duration:* ${duration}
👀 *Views:* ${views}
📅 *Uploaded:* ${uploaded}
📦 *Size:* ${sizeMB.toFixed(2)} MB
📁 *Mode:* ${modeLabel}`;
}

async function sendVideoToGroup(bot, quoted, target, video) {
  const VIDEO_LIMIT_MB = 45;
  let rawFile = null;
  let fixedFile = null;

  try {
    const data = await ytmp4(video.url, {
      format: "mp4",
      videoQuality: "360",
    });

    if (!data?.url) throw new Error("Video download failed (missing url).");

    const stamp = Date.now();
    rawFile = path.join(TEMP_DIR, `cvideo_raw_${stamp}.mp4`);
    fixedFile = path.join(TEMP_DIR, `cvideo_fixed_${stamp}.mp4`);

    await downloadFile(data.url, rawFile);
    await reencodeForWhatsApp(rawFile, fixedFile);

    const sizeMB = getFileSizeMB(fixedFile);
    const fileName = `${sanitizeFileName(video.title)}.mp4`;

    if (sizeMB > VIDEO_LIMIT_MB) {
      await bot.sendMessage(
        target,
        {
          document: fs.readFileSync(fixedFile),
          mimetype: "video/mp4",
          fileName,
          caption: makeVideoCaption(video, sizeMB, "Document"),
        },
        { quoted }
      );
    } else {
      await bot.sendMessage(
        target,
        {
          video: fs.readFileSync(fixedFile),
          mimetype: "video/mp4",
          fileName,
          caption: makeVideoCaption(video, sizeMB, "Playable Video"),
          gifPlayback: false,
        },
        { quoted }
      );
    }
  } finally {
    safeUnlink(rawFile);
    safeUnlink(fixedFile);
  }
}

/* ================= PENDING ================= */

const pending = {};
const TTL = 2 * 60 * 1000;

/* ================= CVIDEO ================= */

cmd(
  { pattern: "cvideo", react: "🎬", category: "download", filename: __filename },
  async (bot, mek, m, { from, q, reply, sender }) => {
    try {
      const store = readStore();
      const groups = store.groups || [];

      if (!groups.length) {
        return reply("No target groups saved. Use .ctarget inside a group first.");
      }

      if (!q) return reply("Please provide a video name or YouTube link.");

      await reply("🔎 Searching video...");

      const video = await getYoutube(q);
      if (!video) return reply("No results found.");

      // user preview only
      await bot.sendMessage(
        from,
        {
          image: { url: video.thumbnail },
          caption: makeUserPreviewCaption(video),
        },
        { quoted: mek }
      );

      // if only one group -> ask confirmation directly
      if (groups.length === 1) {
        const groupName = await getGroupName(bot, groups[0]);

        pending[sender] = {
          mode: "confirm",
          video,
          groups,
          from,
          selectedGroup: groups[0],
          selectedGroupName: groupName,
          createdAt: Date.now(),
        };

        return reply(
          `🎯 *Target Group:* ${groupName}\n\nSend this video to that group?\n\nReply *yes* to confirm or *no* to cancel.`
        );
      }

      const names = await Promise.all(groups.map((g) => getGroupName(bot, g)));
      const list = names.map((n, i) => `${i + 1}. ${n}`).join("\n");

      pending[sender] = {
        mode: "choose_group",
        video,
        groups,
        from,
        createdAt: Date.now(),
      };

      return reply(
        `🎯 *Select a target group number:*\n\n${list}\n\nReply with a number only.`
      );
    } catch (e) {
      console.log("cvideo command error:", e?.message || e);
      return reply("Error while processing the video.");
    }
  }
);

/* ================= NUMBER / YES-NO REPLY HOOK ================= */

global.pluginHooks = global.pluginHooks || [];
global.pluginHooks.push({
  onMessage: async (bot, mek) => {
    try {
      const from = mek.key?.remoteJid;
      if (!from || from === "status@broadcast") return;

      const body = (getBodyFromMek(mek) || "").trim();
      if (!body) return;

      const senderJid = getSenderJid(bot, mek);
      if (!senderJid) return;

      const p = pending[senderJid];
      if (!p) return;
      if (p.from !== from) return;

      if (Date.now() - p.createdAt > TTL) {
        delete pending[senderJid];
        await bot.sendMessage(
          from,
          { text: "Selection expired. Please run .cvideo again." },
          { quoted: mek }
        );
        return;
      }

      if (p.mode === "choose_group") {
        if (!/^\d+$/.test(body)) return;

        const num = parseInt(body, 10);

        if (num < 1 || num > p.groups.length) {
          await bot.sendMessage(
            from,
            { text: `Invalid number. Reply 1-${p.groups.length} only.` },
            { quoted: mek }
          );
          return;
        }

        const target = p.groups[num - 1];
        const groupName = await getGroupName(bot, target);

        pending[senderJid] = {
          ...p,
          mode: "confirm",
          selectedGroup: target,
          selectedGroupName: groupName,
          createdAt: Date.now(),
        };

        await bot.sendMessage(
          from,
          {
            text: `🎯 *Selected Group:* ${groupName}\n\nSend this video to that group?\n\nReply *yes* to confirm or *no* to cancel.`,
          },
          { quoted: mek }
        );
        return;
      }

      if (p.mode === "confirm") {
        const lower = body.toLowerCase();

        if (lower === "no" || lower === "n" || lower === "0" || lower === "cancel") {
          delete pending[senderJid];
          await bot.sendMessage(
            from,
            { text: "Cancelled." },
            { quoted: mek }
          );
          return;
        }

        if (lower === "yes" || lower === "y" || lower === "1" || lower === "ok") {
          const target = p.selectedGroup;
          const targetName = p.selectedGroupName || target;

          delete pending[senderJid];

          // only user sees these messages
          await bot.sendMessage(
            from,
            { text: `📤 Sending video to *${targetName}*...` },
            { quoted: mek }
          );

          await sendVideoToGroup(bot, mek, target, p.video);

          await bot.sendMessage(
            from,
            { text: `✅ Video sent successfully to *${targetName}*.` },
            { quoted: mek }
          );
          return;
        }

        await bot.sendMessage(
          from,
          { text: "Please reply *yes* to confirm or *no* to cancel." },
          { quoted: mek }
        );
      }
    } catch (e) {
      console.log("cvideo hook error:", e?.message || e);
    }
  },
});
