const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");

/* ---------- SINHALA ---------- */

async function getSinhala(q) {
  try {
    const search = await axios.get(`https://sinhalasongbook.com/?s=${encodeURIComponent(q)}`);
    const $ = cheerio.load(search.data);

    const link = $("h2.entry-title a").attr("href");
    if (!link) return null;

    const page = await axios.get(link);
    const $$ = cheerio.load(page.data);

    let title = $$("h1.entry-title").text().trim();
    let lyrics = $$("div.entry-content").text().trim();

    if (!lyrics) return null;

    // clean junk
    lyrics = lyrics
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\b(Em|Dm|Am|G|C|D|F|B7|A7|E7|Bm|Fm|C7)\b/g, "")
      .replace(/INTRO|CHORUS|VERSE|Key:|Beat:|Posted by:|Lyrics:|Music:.*/gi, "")
      .replace(/\n{3,}/g, "\n\n");

    return { title, lyrics };
  } catch {
    return null;
  }
}

/* ---------- ENGLISH ---------- */

async function getEnglish(q) {
  try {
    const s = await axios.get(`https://api.lyrics.ovh/suggest/${encodeURIComponent(q)}`);
    if (!s.data.data.length) return null;

    const a = s.data.data[0].artist.name;
    const t = s.data.data[0].title;

    const l = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`);

    return { title: `${a} - ${t}`, lyrics: l.data.lyrics };
  } catch {
    return null;
  }
}

/* ---------- SINHALA CMD ---------- */

cmd({
  pattern: "lyr",
  alias: ["lyrics", "l", "ly"],
  react: "🎼",
  desc: "Sinhala lyrics only",
  category: "search",
  filename: __filename
},
async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("Enter Sinhala song name.");

    const data = await getSinhala(q);
    if (!data) return reply("Sinhala lyrics not found.");

    let msg = `*${data.title}*\n\n${data.lyrics}`;

    if (msg.length > 3500)
      msg = msg.slice(0, 3500) + "\n\nToo long...";

    await conn.sendMessage(from, { text: msg }, { quoted: mek });

  } catch (err) {
    console.log(err);
    reply("Error fetching Sinhala lyrics.");
  }
});

/* ---------- ENGLISH CMD ---------- */

cmd({
  pattern: "lyren",
  alias: ["len", "lyen", "lyricsen"],
  desc: "English lyrics only",
  category: "search",
  filename: __filename
},
async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("Enter English song name.");

    const data = await getEnglish(q);
    if (!data) return reply("English lyrics not found.");

    let msg = `*${data.title}*\n\n${data.lyrics}`;

    if (msg.length > 3500)
      msg = msg.slice(0, 3500) + "\n\nToo long...";

    await conn.sendMessage(from, { text: msg }, { quoted: mek });

  } catch (err) {
    console.log(err);
    reply("Error fetching English lyrics.");
  }
});
