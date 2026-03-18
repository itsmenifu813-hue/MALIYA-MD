const { cmd, commands } = require("../command");
const { sendInteractiveMessage } = require("gifted-btns");
const config = require("../config");

const pendingMenu = Object.create(null);

/* ============ CONFIG ============ */
const BOT_NAME = "MALIYA-MD";
const PREFIX = ".";
const TZ = "Asia/Colombo";

const OWNER_NUMBER_RAW = String(config.BOT_OWNER || "").trim();
const OWNER_NUMBER = OWNER_NUMBER_RAW.startsWith("+")
  ? OWNER_NUMBER_RAW
  : OWNER_NUMBER_RAW
  ? `+${OWNER_NUMBER_RAW}`
  : "Not Set";

const headerImage =
  "https://raw.githubusercontent.com/Maliya-bro/MALIYA-MD/refs/heads/main/images/a1b18d21-fd72-43cb-936b-5b9712fb9af0.png";

/* ================= HELPERS ================= */
function keyFor(sender, from) {
  return `${from || ""}::${(sender || "").split(":")[0]}`;
}

function getUserName(pushname, sender = "") {
  if (pushname && String(pushname).trim()) return String(pushname).trim();

  const num = String(sender || "").split("@")[0].split(":")[0];
  if (num) return num;

  return "User";
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

function normalizeText(s = "") {
  return String(s)
    .replace(/\r/g, "")
    .replace(/\n+/g, "\n")
    .trim()
    .toUpperCase();
}

function getCategoryReact(cat) {
  const c = String(cat || "").toUpperCase();

  if (c.includes("DOWNLOAD")) return "📥";
  if (c.includes("AI")) return "🤖";
  if (c.includes("ANIME")) return "🍥";
  if (c.includes("ADMIN")) return "🛡️";
  if (c.includes("GROUP")) return "👥";
  if (c.includes("OWNER")) return "👑";
  if (c.includes("TOOLS")) return "🛠️";
  if (c.includes("FUN")) return "🎉";
  if (c.includes("GAME")) return "🎮";
  if (c.includes("SEARCH")) return "🔎";
  if (c.includes("NEWS")) return "📰";
  if (c.includes("MEDIA")) return "🎬";
  if (c.includes("CONFIG")) return "⚙️";
  if (c.includes("MAIN")) return "📜";

  return "📂";
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

function menuHeader(userName = "User") {
  const { time, date } = nowLK();

  return `👋 HI ${userName}

┏━〔 BOT'S MENU 〕━⬣
┃ 🤖 Bot     : ${BOT_NAME}
┃ 👤 User    : ${userName}
┃ 👑 Owner   : ${OWNER_NUMBER}
┃ 🕒 Time    : ${time}
┃ 📅 Date    : ${date}
┃ ✨ Prefix  : ${PREFIX}
┗━━━━━━━━━━━━⬣

🎀 Select a Command List Below`;
}

function categoryInfoCaption(cat, list, userName = "User") {
  return `👋 HI ${userName}

┏━〔 ${cat} MENU 〕━⬣
┃ 📦 Total Commands : ${list.length}
┃ ✨ Prefix         : ${PREFIX}
┃ 👑 Owner          : ${OWNER_NUMBER}
┗━━━━━━━━━━━━⬣

Select an option below.`;
}

function commandListCaption(cat, list, userName = "User") {
  let txt = `👋 HI ${userName}\n\n`;
  txt += `┏━〔 ${cat} COMMANDS 〕━⬣\n`;
  txt += `┃ 📦 Total : ${list.length}\n`;
  txt += `┃ ✨ Prefix: ${PREFIX}\n`;
  txt += `┗━━━━━━━━━━━━⬣\n\n`;

  list.forEach((c) => {
    const primary = c.pattern ? `${PREFIX}${c.pattern}` : "No Pattern";
    const aliases = (c.alias || []).filter(Boolean).map((a) => `${PREFIX}${a}`);

    txt += `• *${primary}*\n`;
    if (aliases.length) {
      txt += `   ◦ Aliases: ${aliases.join(", ")}\n`;
    }
    txt += `   ⭕ ${c.desc || "No description"}\n\n`;
  });

  txt += `━━━━━━━━━━━━━━━━━━\n`;
  txt += `👑 Owner: ${OWNER_NUMBER}`;

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

function resolveMenuAction(rawText, state) {
  const text = normalizeText(rawText || "");
  if (!text) return null;

  if (text.startsWith("MENU_CAT:")) {
    return { type: "category", cat: text.replace("MENU_CAT:", "").trim() };
  }

  if (text.startsWith("MENU_VIEW:")) {
    return { type: "view", cat: text.replace("MENU_VIEW:", "").trim() };
  }

  if (text === "MENU_BACK:MAIN") {
    return { type: "back" };
  }

  if (text === "MENU_CLOSE:NOW") {
    return { type: "close" };
  }

  for (const cat of state.categories || []) {
    const menuTitle = `${cat} MENU`;
    const commandsTitle = `${cat} COMMANDS`;

    if (text.includes(menuTitle)) {
      return { type: "category", cat };
    }

    if (text.includes(commandsTitle)) {
      return { type: "view", cat };
    }
  }

  if (text.includes("BACK TO MAIN MENU")) {
    return { type: "back" };
  }

  if (text.includes("CLOSE MENU")) {
    return { type: "close" };
  }

  return null;
}

async function sendMainMenu(sock, from, mek, state, userName) {
  return sendInteractiveMessage(
    sock,
    from,
    {
      image: { url: headerImage },
      text: menuHeader(userName),
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
            copy_code: OWNER_NUMBER,
          }),
        },
      ],
    },
    { quoted: mek }
  );
}

/* ================= COMMAND: .menu ================= */
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

      const userName = getUserName(pushname, sender);
      const k = keyFor(sender, from);

      pendingMenu[k] = {
        step: "main",
        map,
        categories,
        userName,
        timestamp: Date.now(),
      };

      await sendMainMenu(sock, from, mek, pendingMenu[k], userName);
    } catch (e) {
      console.log("MENU ERROR:", e);
      reply("❌ Menu eka send karanna බැරි වුණා.");
    }
  }
);

/* ================= HANDLE MENU BUTTON IDS ================= */
cmd(
  {
    filter: (text, { sender, from }) => {
      const k = keyFor(sender, from);
      const state = pendingMenu[k];
      if (!state) return false;
      return !!resolveMenuAction(text, state);
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

      const userName = state.userName || getUserName(pushname, sender);
      const action = resolveMenuAction(body, state);

      if (!action) {
        return reply("⚠️ Invalid menu selection. Please use the menu buttons.");
      }

      if (action.type === "close") {
        delete pendingMenu[k];
        await sock.sendMessage(from, { react: { text: "✅", key: mek.key } });
        return reply("✅ Menu closed.");
      }

      if (action.type === "back") {
        state.step = "main";
        state.timestamp = Date.now();
        state.userName = userName;

        await sock.sendMessage(from, { react: { text: "↩️", key: mek.key } });
        return sendMainMenu(sock, from, mek, state, userName);
      }

      if (action.type === "category") {
        const cat = action.cat;
        const list = state.map[cat] || [];

        if (!list.length) {
          return reply("❌ No commands found in this category.");
        }

        state.step = "category";
        state.selectedCategory = cat;
        state.timestamp = Date.now();
        state.userName = userName;

        await sock.sendMessage(from, {
          react: { text: getCategoryReact(cat), key: mek.key },
        });

        return sendInteractiveMessage(
          sock,
          from,
          {
            image: { url: headerImage },
            text: categoryInfoCaption(cat, list, userName),
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

      if (action.type === "view") {
        const cat = action.cat;
        const list = state.map[cat] || [];

        if (!list.length) {
          return reply("❌ No commands found in this category.");
        }

        state.step = "command_view";
        state.selectedCategory = cat;
        state.timestamp = Date.now();
        state.userName = userName;

        await sock.sendMessage(from, {
          react: { text: getCategoryReact(cat), key: mek.key },
        });

        return sock.sendMessage(
          from,
          {
            image: { url: headerImage },
            caption: commandListCaption(cat, list, userName),
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
  const timeout = 10 * 60 * 1000; // 10 minutes

  for (const k of Object.keys(pendingMenu)) {
    if (now - pendingMenu[k].timestamp > timeout) {
      delete pendingMenu[k];
    }
  }
}, 60 * 1000);

module.exports = { pendingMenu };
