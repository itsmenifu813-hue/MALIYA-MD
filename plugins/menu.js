const { cmd, commands } = require("../command");
const { sendInteractiveMessage } = require("gifted-btns");

const pendingMenu = Object.create(null);

/* ============ CONFIG ============ */
const BOT_NAME = "MALIYA-MD";
const OWNER_NAME = "Malindu";
const PREFIX = ".";
const TZ = "Asia/Colombo";

const headerImage =
  "https://raw.githubusercontent.com/Maliya-bro/MALIYA-MD/refs/heads/main/images/a1b18d21-fd72-43cb-936b-5b9712fb9af0.png";

/* ================= HELPERS ================= */
function keyFor(sender, from) {
  return `${from || ""}::${(sender || "").split(":")[0]}`;
}

function nowLK() {
  const d = new Date();

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  return { time, date };
}

function buildCommandMap() {
  const map = Object.create(null);

  for (const c of commands) {
    if (c.dontAddCommandList) continue;
    const cat = (c.category || "MISC").toUpperCase();
    (map[cat] ||= []).push(c);
  }

  const categories = Object.keys(map).sort((a, b) => a.localeCompare(b));

  for (const cat of categories) {
    map[cat].sort((a, b) => (a.pattern || "").localeCompare(b.pattern || ""));
  }

  return { map, categories };
}

function menuHeader(pushname = "User") {
  const { time, date } = nowLK();

  return `👋 HI ${pushname}

┏━〔 BOT'S MENU 〕━⬣
┃ 🤖 Bot     : ${BOT_NAME}
┃ 👤 User    : ${pushname}
┃ 👑 Owner   : ${OWNER_NAME}
┃ 🕒 Time    : ${time}
┃ 📅 Date    : ${date}
┃ ✨ Prefix  : ${PREFIX}
┗━━━━━━━━━━━━⬣

🎀 Select a Command List Below`;
}

function categoryInfoCaption(cat, list) {
  const pretty = `🍀.${cat.toLowerCase()}`;
  return `*${pretty}*
📦 Total Commands: ${list.length}

Select a role below to view commands.`;
}

function commandListCaption(cat, list) {
  const pretty = `🍀.${cat.toLowerCase()}`;
  let txt = `*${pretty} — COMMANDS*\n`;
  txt += `───────────────────────\n\n`;

  list.forEach((c) => {
    const primary = c.pattern ? `${PREFIX}${c.pattern}` : "";
    const aliases = (c.alias || []).filter(Boolean).map((a) => `${PREFIX}${a}`);

    txt += `• *${primary}*\n`;
    if (aliases.length) txt += `   ◦ Aliases: ${aliases.join(", ")}\n`;
    txt += `   ⭕ ${c.desc || "No description"}\n\n`;
  });

  txt += `───────────────────────\n`;
  txt += `Total Commands: ${list.length}`;

  return txt;
}

function makeCategoryRows(map, categories) {
  return categories.map((cat) => ({
    header: "📂",
    title: `${cat} MENU`,
    description: `${map[cat].length} commands available`,
    id: `menu_cat:${cat}`,
  }));
}

function makeRoleRows(cat) {
  return [
    {
      header: "📜",
      title: `${cat} Commands`,
      description: "View all commands with aliases and descriptions",
      id: `menu_view:${cat}`,
    },
    {
      header: "🏠",
      title: "Back To Main Menu",
      description: "Return to the main menu",
      id: `menu_back:main`,
    },
    {
      header: "❌",
      title: "Close Menu",
      description: "Close this menu session",
      id: `menu_close:now`,
    },
  ];
}

/* ================= MAIN MENU COMMAND ================= */
cmd(
  {
    pattern: "menu",
    react: "📜",
    desc: "Show command categories",
    category: "main",
    filename: __filename,
  },
  async (sock, mek, m, { from, sender, pushname, reply }) => {
    try {
      await sock.sendMessage(from, { react: { text: "📜", key: mek.key } });

      const { map, categories } = buildCommandMap();
      if (!categories.length) return reply("❌ No commands found!");

      const k = keyFor(sender, from);
      pendingMenu[k] = {
        step: "main",
        map,
        categories,
        timestamp: Date.now(),
      };

      await sendInteractiveMessage(
        sock,
        from,
        {
          image: { url: headerImage },
          text: menuHeader(pushname || "User"),
          footer: `${BOT_NAME} | Interactive Menu`,
          interactiveButtons: [
            {
              name: "single_select",
              buttonParamsJson: JSON.stringify({
                title: "Click Here ↯",
                sections: [
                  {
                    title: "Command Categories",
                    rows: makeCategoryRows(map, categories),
                  },
                ],
              }),
            },
            {
              name: "cta_url",
              buttonParamsJson: JSON.stringify({
                display_text: "🌐 Official Website",
                url: "https://example.com",
              }),
            },
            {
              name: "cta_copy",
              buttonParamsJson: JSON.stringify({
                display_text: "📋 Copy Owner Number",
                copy_code: "+94770000000",
              }),
            },
          ],
        },
        { quoted: mek }
      );
    } catch (e) {
      console.log("MENU ERROR:", e);
      reply("❌ Menu eka send karanna බැරි වුණා.");
    }
  }
);

/* ================= HANDLE MENU BUTTON IDS ================= */
cmd(
  {
    filter: (text) => {
      const t = (text || "").trim();
      return (
        t.startsWith("menu_cat:") ||
        t.startsWith("menu_view:") ||
        t === "menu_back:main" ||
        t === "menu_close:now"
      );
    },
    dontAddCommandList: true,
    filename: __filename,
  },
  async (sock, mek, m, { body, from, sender, pushname, reply }) => {
    try {
      const k = keyFor(sender, from);
      const state = pendingMenu[k];

      if (!state) {
        return reply("⚠️ Menu session expired. Please send *.menu* again.");
      }

      const text = (body || "").trim();

      /* ===== CLOSE ===== */
      if (text === "menu_close:now") {
        delete pendingMenu[k];
        await sock.sendMessage(from, { react: { text: "✅", key: mek.key } });
        return reply("✅ Menu closed.");
      }

      /* ===== BACK TO MAIN ===== */
      if (text === "menu_back:main") {
        state.step = "main";
        state.timestamp = Date.now();

        await sock.sendMessage(from, { react: { text: "↩️", key: mek.key } });

        return sendInteractiveMessage(
          sock,
          from,
          {
            image: { url: headerImage },
            text: menuHeader(pushname || "User"),
            footer: `${BOT_NAME} | Interactive Menu`,
            interactiveButtons: [
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  title: "Click Here ↯",
                  sections: [
                    {
                      title: "Command Categories",
                      rows: makeCategoryRows(state.map, state.categories),
                    },
                  ],
                }),
              },
              {
                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                  display_text: "🌐 Official Website",
                  url: "https://example.com",
                }),
              },
              {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                  display_text: "📋 Copy Owner Number",
                  copy_code: "+94770000000",
                }),
              },
            ],
          },
          { quoted: mek }
        );
      }

      /* ===== CATEGORY SELECT ===== */
      if (text.startsWith("menu_cat:")) {
        const cat = text.split("menu_cat:")[1];
        const list = state.map[cat] || [];

        if (!list.length) {
          return reply("❌ No commands found in this category.");
        }

        state.step = "category";
        state.selectedCategory = cat;
        state.timestamp = Date.now();

        await sock.sendMessage(from, { react: { text: "✅", key: mek.key } });

        return sendInteractiveMessage(
          sock,
          from,
          {
            image: { url: headerImage },
            text: categoryInfoCaption(cat, list),
            footer: `${BOT_NAME} | ${cat} MENU`,
            interactiveButtons: [
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  title: `${cat} Roles ↯`,
                  sections: [
                    {
                      title: `${cat} Options`,
                      rows: makeRoleRows(cat),
                    },
                  ],
                }),
              },
            ],
          },
          { quoted: mek }
        );
      }

      /* ===== VIEW CATEGORY COMMANDS ===== */
      if (text.startsWith("menu_view:")) {
        const cat = text.split("menu_view:")[1];
        const list = state.map[cat] || [];

        if (!list.length) {
          return reply("❌ No commands found in this category.");
        }

        state.step = "command_view";
        state.selectedCategory = cat;
        state.timestamp = Date.now();

        await sock.sendMessage(from, { react: { text: "📂", key: mek.key } });

        return sock.sendMessage(
          from,
          {
            image: { url: headerImage },
            caption: commandListCaption(cat, list),
          },
          { quoted: mek }
        );
      }
    } catch (e) {
      console.log("MENU ACTION ERROR:", e);
      reply("❌ Menu action eka process karanna බැරි වුණා.");
    }
  }
);

/* ================= AUTO CLEANUP ================= */
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000;

  for (const k of Object.keys(pendingMenu)) {
    if (now - pendingMenu[k].timestamp > timeout) {
      delete pendingMenu[k];
    }
  }
}, 60 * 1000);

module.exports = { pendingMenu };
