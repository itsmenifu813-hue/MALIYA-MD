const { cmd, commands } = require("../command");
const puppeteer = require("puppeteer");

// මේවා තාවකාලිකව දත්ත මතක තබා ගැනීමට භාවිතා කරයි
const pendingSearch = {};
const pendingQuality = {};

// -----------------------------
// Quality Normalize
// -----------------------------
function normalizeQuality(text) {
  if (!text) return "Unknown";
  text = text.toUpperCase();
  if (/1080|FHD/.test(text)) return "1080p";
  if (/720|HD/.test(text)) return "720p";
  if (/480|SD/.test(text)) return "480p";
  return text;
}

// -----------------------------
// Helper Functions (Scrapers)
// -----------------------------
async function searchMovies(query) {
  const browser = await puppeteer.launch({ 
    headless: true, 
    args: ["--no-sandbox", "--disable-setuid-sandbox"] 
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(`https://cinesubz.lk/?s=${encodeURIComponent(query)}`, { waitUntil: "networkidle2", timeout: 60000 });
    
    return await page.$$eval(".display-item .item-box", boxes =>
      boxes.slice(0, 10).map((box, index) => ({
        id: index + 1,
        title: box.querySelector("a")?.title?.trim() || "No Title",
        movieUrl: box.querySelector("a")?.href || "",
        thumb: box.querySelector("img")?.src || "",
        language: box.querySelector(".language")?.textContent?.trim() || "Sinhala Sub",
      })).filter(m => m.movieUrl)
    );
  } finally {
    await browser.close();
  }
}

async function getDirectDownloadLinks(movieUrl) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Step 1: Movie Page
    await page.goto(movieUrl, { waitUntil: "networkidle2" });
    const linkItems = await page.$$eval('a[href*="/zt-links/"]', links => 
      links.map(link => {
        const text = link.closest('div')?.innerText || "";
        return {
          url: link.href,
          quality: text.includes('1080p') ? '1080p' : text.includes('720p') ? '720p' : '480p',
          size: text.match(/\d+(\.\d+)?\s*(GB|MB)/i)?.[0] || 'Unknown'
        };
      })
    );

    let finalLinks = [];
    // Step 2 & 3: ZT-Links to Sonic-Cloud
    for (const item of linkItems.slice(0, 3)) {
      try {
        await page.goto(item.url, { waitUntil: "networkidle2" });
        const finalPageUrl = await page.$eval('a.btn-danger, .download-btn', el => el.href).catch(() => null);
        
        if (finalPageUrl) {
          await page.goto(finalPageUrl, { waitUntil: "networkidle2" });
          const directFileLink = await page.$eval('a[href*="sonic-cloud.online"]', el => el.href).catch(() => null);
          if (directFileLink) {
            finalLinks.push({ link: directFileLink, quality: item.quality, size: item.size });
          }
        }
      } catch (e) {}
    }
    return finalLinks;
  } finally {
    await browser.close();
  }
}

// -----------------------------
// MALIYA-MD Commands
// -----------------------------

// 1. සෙවුම් විධානය (Search Command)
cmd({
  pattern: "film",
  alias: ["movie", "cinesubz"],
  category: "download",
  react: "🎬",
  desc: "Cinesubz movie downloader",
  filename: __filename
}, async (conn, mek, m, { from, q, sender, reply }) => {
  try {
    if (!q) return reply("අවශ්‍ය චිත්‍රපටයේ නම ඇතුළත් කරන්න. (උදා: .film Leo)");

    reply("🔎 සොයමින් පවතී, කරුණාකර රැඳී සිටින්න...");
    const results = await searchMovies(q);
    
    if (results.length === 0) return reply("❌ කිසිවක් හමු වූයේ නැත.");

    pendingSearch[sender] = { results, timestamp: Date.now() };

    let msg = `🎬 *MALIYA-MD MOVIE SEARCH*\n\n`;
    results.forEach((res, i) => {
      msg += `*${i + 1}.* ${res.title}\n`;
    });
    msg += `\n📥 *ලින්ක් ලබාගැනීමට අදාළ අංකය Reply කරන්න.*`;

    await conn.sendMessage(from, { image: { url: results[0].thumb }, caption: msg }, { quoted: mek });
  } catch (e) {
    reply("Error: " + e.message);
  }
});

// 2. අංකය ලැබුණු පසු ක්‍රියාත්මක වන කොටස (Listen for Replies)
conn.ev.on('messages.upsert', async (chatUpdate) => {
  const m = chatUpdate.messages[chatUpdate.messages.length - 1];
  if (!m.message || !m.message.extendedTextMessage) return;
  
  const from = m.key.remoteJid;
  const sender = m.key.participant || m.key.remoteJid;
  const text = m.message.extendedTextMessage.text;

  // Selection for Movie
  if (pendingSearch[sender] && !isNaN(text)) {
    const index = parseInt(text) - 1;
    const selected = pendingSearch[sender].results[index];
    if (selected) {
      delete pendingSearch[sender];
      await conn.sendMessage(from, { text: `⏳ *${selected.title}* සඳහා Direct Links ලබාගනිමින් පවතී...` }, { quoted: m });
      
      const links = await getDirectDownloadLinks(selected.movieUrl);
      if (links.length === 0) return conn.sendMessage(from, { text: "❌ Direct links සොයාගත නොහැකි විය." }, { quoted: m });

      pendingQuality[sender] = { title: selected.title, links, timestamp: Date.now() };

      let qMsg = `🎬 *${selected.title}*\n\n`;
      links.forEach((l, i) => qMsg += `*${i + 1}.* ${l.quality} (${l.size})\n`);
      qMsg += `\n📥 *ඩවුන්ලෝඩ් කිරීමට අංකය Reply කරන්න.*`;
      
      await conn.sendMessage(from, { text: qMsg }, { quoted: m });
    }
  }

  // Selection for Quality & Sending File
  else if (pendingQuality[sender] && !isNaN(text)) {
    const index = parseInt(text) - 1;
    const data = pendingQuality[sender];
    const selected = data.links[index];
    
    if (selected) {
      delete pendingQuality[sender];
      await conn.sendMessage(from, { react: { text: "⏳", key: m.key } });
      
      try {
        await conn.sendMessage(from, {
          document: { url: selected.link },
          mimetype: "video/mp4",
          fileName: `${data.title} (${selected.quality}).mp4`,
          caption: `🎬 *${data.title}*\n⭐ Quality: ${selected.quality}\n\n*Enjoy! - Powered by MALIYA-MD*`
        }, { quoted: m });
        await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      } catch (e) {
        await conn.sendMessage(from, { text: "❌ ගොනුව එවීමේදී දෝෂයක් ඇතිවිය. ඩිරෙක්ට් ලින්ක් එක:\n" + selected.link }, { quoted: m });
      }
    }
  }
});

module.exports = { searchMovies, getDirectDownloadLinks };
