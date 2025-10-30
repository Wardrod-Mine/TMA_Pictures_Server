require('dotenv').config();
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const express = require('express');
const cors = require('cors'); // ← реально используем
const app = express();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// serve static assets (images uploaded)
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const CHANNEL_ID = process.env.CHANNEL_ID || null;
const CHANNEL_THREAD_ID = process.env.CHANNEL_THREAD_ID ? Number(process.env.CHANNEL_THREAD_ID) : null;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;
const POST_BUTTON_TEXT = process.env.POST_BUTTON_TEXT || 'Открыть';
const POST_BUTTON_URL  = process.env.POST_BUTTON_URL  || FRONTEND_URL || 'https://example.com';

// 🧩 --- Diagnostic logging helper ---
function log(tag, ...msg) {
  const t = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${t}] [${tag}]`, ...msg);
}
function warn(tag, ...msg) {
  const t = new Date().toISOString().split('T')[1].split('.')[0];
  console.warn(`[${t}] [WARN:${tag}]`, ...msg);
}
function err(tag, ...msg) {
  const t = new Date().toISOString().split('T')[1].split('.')[0];
  console.error(`[${t}] [ERROR:${tag}]`, ...msg);
}

const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || '')
  .split(/[,\s]+/)
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);

const ADMIN_THREAD_ID = process.env.ADMIN_THREAD_ID ? Number(process.env.ADMIN_THREAD_ID) : null;


if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в .env');
if (!APP_URL) console.warn('⚠️ APP_URL не задан — вебхук не установится');
if (!ADMIN_CHAT_IDS.length) console.warn('⚠️ ADMIN_CHAT_IDS пуст — /lead не сможет доставить заявку.');

const bot = new Telegraf(BOT_TOKEN);

// === утилиты ===
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (v) => v ? esc(v) : '—';
const who = (u) => {
  if (!u) return '—';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const un = u.username ? ` @${u.username}` : '';
  return `${esc(name)}${un}`;
};

function isAdmin(id) {
  return ADMIN_CHAT_IDS.includes(Number(id));
}

// === рассылка админам ===
async function notifyAdmins(ctx, html) {
  const targets = ADMIN_CHAT_IDS.length ? ADMIN_CHAT_IDS : [ctx.chat.id];
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (ADMIN_THREAD_ID) extra.message_thread_id = ADMIN_THREAD_ID;

  let delivered = 0;
  for (const chatId of targets) {
    try {
      console.log(`[notifyAdmins] sending → ${chatId}`);
      await ctx.telegram.sendMessage(chatId, html, extra);
      console.log(`[notifyAdmins] success → ${chatId}`);
      delivered++;
    } catch (err) {
      console.error(`[notifyAdmins] failed → ${chatId}`, err.message);
    }
  }
  return delivered;
}

// === /start ===
// bot.start(async (ctx) => {
//   await ctx.reply('📂 Добро пожаловать! Нажмите кнопку ниже, чтобы открыть каталог услуг:', {
//     reply_markup: {
//       inline_keyboard: [[{ text: 'Каталог', web_app: { url: FRONTEND_URL } }]]
//     }
//   });

//   if (ctx.chat?.type === 'private' && isAdmin(ctx.from?.id)) {
//     await ctx.reply(
//       [
//         '🛠 <b>Публикация поста</b>',
//         '• Напишите текст поста и отправьте:',
//         '<code>/post Текст поста</code>',
//         '• Или ответьте командой <code>/post</code> на сообщение с текстом/фото+подписью.',
//         '',
//         `Кнопка добавляется автоматически: «${POST_BUTTON_TEXT}» → ${POST_BUTTON_URL}`,
//         CHANNEL_ID
//           ? `По умолчанию посты уходят в: <code>${CHANNEL_ID}</code>`
//           : 'Без CHANNEL_ID пост уйдёт в текущий чат.'
//       ].join('\n'),
//       { parse_mode: 'HTML', disable_web_page_preview: true }
//     );
//   }
// });

// === /start ===
bot.command('start', ctx => ctx.reply('Добро пожаловать!', {
  reply_markup: {
    inline_keyboard: [[
      { text: 'Каталог', web_app: { url: process.env.FRONTEND_URL } }
    ]]
  }
}));



// === test_admin ===
bot.command('test_admin', async (ctx) => {
  const html = `<b>🔔 Тестовое сообщение</b>\n\nОт: ${who(ctx.from)}`;
  const ok = await notifyAdmins(ctx, html);
  return ctx.reply(ok > 0 ? `✅ Доставлено ${ok} админу(ам)` : '❌ Не удалось доставить');
});

let RUNTIME_CHANNEL_ID = CHANNEL_ID;

bot.command('where', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  ctx.reply(
    [
      `ENV CHANNEL_ID: ${CHANNEL_ID || '—'}`,
      `RUNTIME_CHANNEL_ID: ${RUNTIME_CHANNEL_ID || '—'}`,
      `THREAD_ID: ${CHANNEL_THREAD_ID || '—'}`
    ].join('\n')
  );
});

// Быстрый тест отправки в канал
bot.command('post_test', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  const target = RUNTIME_CHANNEL_ID || ctx.chat.id;
  try {
    await sendPost(
      {
        chatId: target,
        threadId: CHANNEL_THREAD_ID || undefined,
        text: 'Тестовый пост ✅\nЕсли вы это видите в канале — всё ок.',
        buttonText: 'Открыть',
        buttonUrl: 'https://example.com'
      },
      ctx.telegram
    );
    ctx.reply(`✅ Ушло в ${target}${CHANNEL_THREAD_ID ? ` (топик ${CHANNEL_THREAD_ID})` : ''}`);
  } catch (e) {
    // покажем точную причину Телеграма
    ctx.reply(`❌ Не отправилось: ${e.description || e.message}`);
  }
});

bot.command('bind', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  const fwd = ctx.message.reply_to_message?.forward_from_chat;
  if (!fwd) return ctx.reply('Сделайте /bind ответом на ПЕРЕСЛАННОЕ из канала сообщение.');
  RUNTIME_CHANNEL_ID = fwd.id; // например -100xxxxxxxxxx
  ctx.reply(`✅ Привязал канал: ${RUNTIME_CHANNEL_ID}`);
});

// Ручная установка: /set_channel -100123.. или /set_channel @username
bot.command('set_channel', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  const arg = ctx.message.text.replace(/^\/set_channel(@\w+)?\s+/, '').trim();
  if (!arg) return ctx.reply('Укажи id канала (-100…) или @username.');
  RUNTIME_CHANNEL_ID = arg.startsWith('@') ? arg : Number(arg);
  ctx.reply(`✔️ Теперь публикуем в: ${RUNTIME_CHANNEL_ID}`);
});

bot.command('post', async (ctx) => {
  try {
    if (!isAdmin?.(ctx.from?.id)) {
      return ctx.reply('🚫 Недостаточно прав для публикации');
    }

    // 1) текст прямо в команде
    let postText = ctx.message.text.replace(/^\/post(@\w+)?\s*/i, '').trim();

    // 2) или берём из реплая (text/caption)
    const reply = ctx.message.reply_to_message;
    if (!postText && reply) postText = (reply.caption || reply.text || '').trim();

    // 3) фото из реплая (если есть)
    let photoFileId = null;
    if (reply?.photo?.length) {
      const largest = reply.photo.reduce((a, b) => (a.file_size || 0) > (b.file_size || 0) ? a : b);
      photoFileId = largest?.file_id || null;
    }

    if (!postText) {
      return ctx.reply(
        'Пришлите текст поста после команды:\n' +
        '/post Текст поста\n' +
        'ИЛИ ответьте /post на сообщение с текстом/фото+подписью.\n' +
        `Кнопка будет добавлена автоматически: «${POST_BUTTON_TEXT}» → ${POST_BUTTON_URL}`,
        { disable_web_page_preview: true }
      );
    }

    const targetChatId = CHANNEL_ID || ctx.chat.id;    
    const threadId     = CHANNEL_THREAD_ID || undefined; 

    await sendPost({ chatId: targetChatId, threadId, text: postText, photoFileId }, ctx.telegram);
    return ctx.reply(`✅ Пост отправлен в ${targetChatId}${threadId ? ` (топик ${threadId})` : ''}`);
  } catch (e) {
    console.error('post error:', e);
    return ctx.reply('❌ Ошибка отправки: ' + (e.description || e.message));
  }
});

  

// === приём данных из WebApp ===
bot.on(message('web_app_data'), async (ctx) => {
  console.log('\n==== [web_app_data received] ====');
  console.log('[from.id]:', ctx.from?.id, 'username:', ctx.from?.username);
  console.log('[raw payload]:', ctx.message.web_app_data?.data);
  console.log('[ctx.message]:', JSON.stringify(ctx.message, null, 2));
  let data = null;
  try {

    data = JSON.parse(ctx.message.web_app_data.data);
    console.log('[parsed payload]:', data);
  } catch (err) {
    console.error('❌ JSON parse error:', err.message);
  }

  if (!data) {
    console.warn('[handler] payload empty → reply to user');
    return ctx.reply('⚠️ Ошибка: данные не распознаны.');
  }

  const stamp = new Date().toLocaleString('ru-RU');
  let html = '';

  // === разные типы заявок ===
  if (data.action === 'send_request' || data.action === 'send_request_form') {
    html =
      `📄 <b>Заявка (форма)</b>\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Телефон:</b> ${fmt(data.phone)}\n` +
      (data.comment ? `<b>Комментарий:</b> ${fmt(data.comment)}\n` : '') +
      (data.selected || data.product?.title ? `<b>Выбранный продукт:</b> ${fmt(data.selected || data.product.title)}\n` : '');
  }
  else if (data.type === 'lead' || data.action === 'consult') {
    html =
      `💬 <b>Запрос консультации</b>\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Телефон:</b> ${fmt(data.phone)}\n` +
      (data.comment ? `<b>Комментарий:</b> ${fmt(data.comment)}\n` : '');
  } 

 
  else {
    html =
      `📥 <b>Данные из ТМА</b>\n` +
      `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
  }

  html += `\n\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}`;

  const ok = await notifyAdmins(ctx, html);

  console.log('[notifyAdmins] delivered =', ok);

  return ctx.reply(ok > 0
    ? '✅ Заявка успешно передана администратору!'
    : '❌ Не удалось доставить администратору.');
});

// === Express + webhook ===
app.use(express.json());
app.use(bot.webhookCallback('/bot'));
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,                    // https://tma-pictures-front.onrender.com
  'https://web.telegram.org',                  // Telegram Web
  'https://web.telegram.org/a'                 // вариант подпути
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Разрешаем без Origin (например, curl, мобильные webview)
    if (!origin) return cb(null, true);
    // Разрешаем, если точное совпадение
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Дополнительно — пропустим, если это ровно фронт Render (на случай www/слэшей)
    try {
      const u = new URL(origin);
      if (ALLOWED_ORIGINS.some(a => a && new URL(a).host === u.host)) {
        return cb(null, true);
      }
    } catch {}
    return cb(new Error(`CORS blocked for origin ${origin}`));
  },
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));


const multer = require('multer');

const cloudinary = require('cloudinary').v2;
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true }); 
}


function ensureDir(p){ try{ fs.mkdirSync(p, { recursive: true }); }catch(e){} }
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const cardId = (req.body.cardId || req.query.cardId || 'misc').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const dir = path.join(__dirname, 'assets', cardId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const name = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, name);
  }
});
const upload = multer({ storage });

// POST /upload-image?cardId=product_id
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      warn('upload', 'no_file');
      return res.status(400).json({ ok: false, error: 'no_file' });
    }
    const cardId = (req.body.cardId || req.query.cardId || 'misc')
      .replace(/[^a-zA-Z0-9_\-]/g, '_');

    log('upload', 'file:', req.file.originalname, 'cardId:', cardId);

    // req.file.path уже создан multer.diskStorage
    let result = null;
    if (process.env.CLOUDINARY_URL) {
      try {
        result = await cloudinary.uploader.upload(req.file.path, {
          folder: `tma_cards/${cardId}`,
          use_filename: true,
          unique_filename: false,
          resource_type: 'image'
        });
        log('upload', 'cloudinary:', result.secure_url);
      } catch (e) {
        err('upload', 'cloudinary:', e.message);
      }
    }

    const rel = `/assets/${cardId}/${path.basename(req.file.path)}`;
    const url = result?.secure_url || (FRONTEND_URL ? FRONTEND_URL.replace(/\/$/,'') + rel : rel);
    const pathOrPublicId = result?.public_id || rel;

    return res.json({ ok: true, url, path: pathOrPublicId });
  } catch (e) {
    err('upload', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});



function parseBtn(line) {
  const [t, u] = (line || '').split('|');
  const text = (t || '').trim();
  const url = (u || '').trim();
  return { text, url };
}

function pickLargestPhoto(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return null;
  return sizes.reduce((a, b) => (a.file_size || 0) > (b.file_size || 0) ? a : b);
}

app.post('/lead', async (req, res) => {
  try {
    const data = req.body;
    console.log('\n==== [lead received] ====');
    console.log('[payload]:', data);

    if (!ADMIN_CHAT_IDS.length) {
      return res.status(400).json({ ok: false, error: 'ADMIN_CHAT_IDS is empty' });
    }

    const stamp = new Date().toLocaleString('ru-RU');
    let html = '';

    if (data.action === 'send_request_form') {
      html =
        `📄 <b>Заявка (форма)</b>\n` +
        `<b>Имя:</b> ${fmt(data.name)}\n` +
        `<b>Телефон:</b> ${fmt(data.phone)}\n` +
        (data.comment ? `<b>Комментарий:</b> ${fmt(data.comment)}\n` : '') +
        (data.service ? `<b>Услуга:</b> ${fmt(data.service)}\n` : '');
    } 
    else if (data.action === 'consult') {
      html =
        `💬 <b>Запрос консультации</b>\n` +
        `<b>Имя:</b> ${fmt(data.name)}\n` +
        `<b>Контакт:</b> ${fmt(data.contact)}\n` +
        (data.message ? `<b>Комментарий:</b> ${fmt(data.message)}\n` : '');
    }
    else {
      html =
        `📥 <b>Данные из ТМА</b>\n` +
        `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
    }

    html += `\n\n<b>Время:</b> ${esc(stamp)}`;

    const ok = await notifyAdmins({ telegram: bot.telegram, chat: { id: ADMIN_CHAT_IDS[0] } }, html);
    console.log('[notifyAdmins] delivered =', ok);
    res.json({ ok: true, delivered: ok });
  } catch (err) {
    console.error('❌ /lead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function sendPost({ chatId, threadId, text, photoFileId }, tg) {
  const baseExtra = {
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    reply_markup: { inline_keyboard: [[{ text: POST_BUTTON_TEXT, url: POST_BUTTON_URL }]] }
  };

  const tryOnce = async (withThread) => {
    const extra = (withThread && threadId) ? { ...baseExtra, message_thread_id: threadId } : baseExtra;
    if (photoFileId) return tg.sendPhoto(chatId, photoFileId, { caption: text, ...extra });
    return tg.sendMessage(chatId, text, extra);
  };

  try {
    return await tryOnce(true);   // пробуем с threadId (если задан)
  } catch (e) {
    const m = String(e.description || e.message || '').toLowerCase();
    const threadProblem = m.includes('message_thread_id') || m.includes('topic') || m.includes('forum') || m.includes('thread');
    if (threadId && threadProblem) {
      return await tryOnce(false); // канал без топиков — повтор без threadId
    }
    throw e;
  }
}


app.get('/', (req, res) => res.send('Bot is running'));
app.get('/debug', async (req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (APP_URL) {
    const webhookUrl = `${APP_URL}/bot`;
    try {
      const info = await bot.telegram.getWebhookInfo();

      if (info.url !== webhookUrl) {
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`✅ Webhook установлен: ${webhookUrl}`);
      } else {
        console.log(`ℹ️ Webhook уже актуален: ${webhookUrl}`);
      }

      const me = await bot.telegram.getMe();
      console.log(`[bot] logged in as @${me.username}, id=${me.id}`);
      console.log(`[bot] ADMIN_CHAT_IDS =`, ADMIN_CHAT_IDS);
    } catch (e) {
      console.error('❌ Failed to set webhook automatically:', e.message);
    }
  }
  // Try to sync products from GitHub if configured
  try{ await syncProductsFromGitHubToLocal(); }catch(e){ /* ignore */ }
});

// ---- Доп. endpoints: проверка admin и CRUD для карточек ----

const PRODUCTS_FILE = path.join(__dirname, 'products.json');
function loadProductsFile(){
  try{ if (fs.existsSync(PRODUCTS_FILE)) return JSON.parse(fs.readFileSync(PRODUCTS_FILE,'utf8')); }catch(e){ console.warn('loadProductsFile error', e.message); }
  return [];
}

function saveProductsFile(list){
  try{ fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(list, null, 2), 'utf8'); return true; }catch(e){ console.error('saveProductsFile error', e.message); return false; }
}

// --- GitHub integration helpers (optional) --------------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_PRODUCTS_PATH = process.env.GITHUB_PRODUCTS_PATH || 'products.json';
const GITHUB_COMMIT_BRANCH = process.env.GITHUB_COMMIT_BRANCH || 'main';
const GITHUB_COMMIT_MESSAGE = process.env.GITHUB_COMMIT_MESSAGE || 'Update products.json via backend';

async function githubGetFileContent(){
  if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
  try{
    const [owner, repo] = GITHUB_REPO.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(GITHUB_PRODUCTS_PATH)}?ref=${encodeURIComponent(GITHUB_COMMIT_BRANCH)}`;
    const res = await fetch(url, { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    if (!res.ok) { console.warn('githubGetFileContent: not ok', res.status); return null; }
    const j = await res.json();
    if (!j || !j.content) return null;
    const content = Buffer.from(j.content, 'base64').toString('utf8');
    return { content, sha: j.sha };
  }catch(e){ console.warn('githubGetFileContent error', e.message); return null; }
}

async function githubPutFileContent(textContent, sha){
  if (!GITHUB_TOKEN || !GITHUB_REPO) return { ok:false, error:'no_github_config' };
  try{
    const [owner, repo] = GITHUB_REPO.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(GITHUB_PRODUCTS_PATH)}`;
    const body = {
      message: GITHUB_COMMIT_MESSAGE,
      content: Buffer.from(textContent, 'utf8').toString('base64'),
      branch: GITHUB_COMMIT_BRANCH
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: 'PUT', headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) { console.warn('githubPutFileContent failed', res.status, j); return { ok:false, error: j }; }
    return { ok:true, result: j };
  }catch(e){ console.warn('githubPutFileContent error', e.message); return { ok:false, error: e.message }; }
}

// Attempt to fetch products.json from GitHub and save locally (run on startup)
async function syncProductsFromGitHubToLocal(){
  try{
    const f = await githubGetFileContent();
    if (f && f.content) {
      try{ fs.writeFileSync(PRODUCTS_FILE, f.content, 'utf8'); console.log('✅ products.json synced from GitHub'); return true; }catch(e){ console.warn('sync write failed', e.message); }
    }
  }catch(e){ console.warn('syncProductsFromGitHubToLocal error', e.message); }
  return false;
}


function verifyInitData(initDataString){
  if (!initDataString || !BOT_TOKEN) return null;
  try{
    const parts = String(initDataString).split(/[\n&]/).filter(Boolean);
    const kv = {};
    for (const p of parts) {
      const idx = p.indexOf('='); if (idx === -1) continue;
      const k = p.slice(0, idx); const v = decodeURIComponent(p.slice(idx+1)); kv[k]=v;
    }
    const hash = kv.hash || kv.h || null; if (!hash) return null; delete kv.hash; delete kv.h;
    const keys = Object.keys(kv).sort();
    const data_check_arr = keys.map(k => `${k}=${kv[k]}`);
    const data_check_string = data_check_arr.join('\n');

    const secret_key = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secret_key).update(data_check_string).digest('hex');
    if (hmac !== hash) return null;

    // return parsed user id if present
    const user_id = kv.user ? (JSON.parse(kv.user).id || null) : (kv.user_id ? Number(kv.user_id) : null);
    return { ok:true, data: kv, user_id };
  }catch(e){ console.warn('verifyInitData error', e.message); return null; }
}

app.post('/check_admin', express.json(), (req, res) => {
  try{
    const { init_data, init_data_unsafe } = req.body || {};
    // lightweight logging for debugging (do not log full tokens)
    try{
      const keys = Object.keys(req.body || {});
      console.log('[check_admin] received keys:', keys);
      if (init_data) console.log('[check_admin] init_data present, len=', String(init_data).length);
      if (init_data_unsafe && init_data_unsafe.user) console.log('[check_admin] init_data_unsafe.user -> id=', init_data_unsafe.user.id, ' username=', init_data_unsafe.user.username || '');
    }catch(e){ /* ignore logging errors */ }
    const ALLOW_UNSAFE = (process.env.ALLOW_UNSAFE_ADMIN === 'true');

    // Try signed init_data first
    const v = verifyInitData(init_data);
    if (v) {
      const uid = v.user_id || (v.data && (v.data.user_id || v.data.user && JSON.parse(v.data.user).id));
      const isAdm = !!(uid && ADMIN_CHAT_IDS.includes(Number(uid)));
      return res.json({ ok:true, isAdmin: isAdm, user_id: uid, unsafe: false });
    }

    // Fallback: if allowed by env, accept unsafe init data object (useful for desktop / debug)
    if (!v && init_data_unsafe && ALLOW_UNSAFE) {
      try{
        const uid = init_data_unsafe.user?.id || init_data_unsafe.user_id || null;
        const isAdm = !!(uid && ADMIN_CHAT_IDS.includes(Number(uid)));
        console.log('[check_admin] using unsafe init_data fallback, uid=', uid);
        return res.json({ ok:true, isAdmin: isAdm, user_id: uid, unsafe: true });
      }catch(e){ /* ignore parse errors below */ }
    }

    return res.json({ ok:false, isAdmin:false });
  }catch(e){ console.error('check_admin error', e.message); return res.status(500).json({ ok:false }); }
});

app.get('/check_admin', async (req, res) => {
  try {
    const init_data = req.query.init_data;
    const unsafe = req.query.unsafe === 'true';

    const v = verifyInitData(init_data);
    let uid = null;
    if (v) {
      uid = v.user_id
        ?? (v.data?.user ? JSON.parse(v.data.user).id : null)
        ?? v.data?.user_id
        ?? null;
      log('check_admin', 'Verified uid:', uid);
    } else {
      warn('check_admin', 'Invalid init_data, fallback:', unsafe);
    }

    if (!uid && process.env.ALLOW_UNSAFE_ADMIN === 'true' && unsafe) {
      log('check_admin', 'Using UNSAFE admin fallback');
      return res.json({ ok: true, admin: true, unsafe: true });
    }
    if (!uid) return res.status(403).json({ ok: false, error: 'invalid_init_data' });

    const adminIds = (process.env.ADMIN_CHAT_IDS || '')
      .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const isAdmin = adminIds.includes(String(uid));
    log('check_admin', `Admin check for ${uid}: ${isAdmin}`);
    return res.json({ ok: true, admin: isAdmin });
  } catch (e) {
    err('check_admin', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/products', (req, res) => {
  try{
    const list = loadProductsFile();
    return res.json({ ok:true, products: list });
  }catch(e){ console.error('GET /products error', e.message); return res.status(500).json({ ok:false }); }
});

// protected upsert product
app.post('/products', async (req, res) => {
  try {
    const { init_data, product } = req.body;
    log('products', 'Incoming product:', product?.id || '(no id)');

    // Разбираем init_data, достаём user_id
    const v = verifyInitData(init_data);
    let uid = null;
    if (v) {
      uid = v.user_id
        ?? (v.data?.user ? JSON.parse(v.data.user).id : null)
        ?? v.data?.user_id
        ?? null;
      log('products', 'Verified uid:', uid);
    } else {
      warn('products', 'Invalid init_data');
    }

    // Fallback для разработки
    if (!uid && process.env.ALLOW_UNSAFE_ADMIN === 'true') {
      log('products', 'InitData invalid, using UNSAFE fallback');
      uid = 'unsafe-admin';
    }
    if (!uid) {
      return res.status(403).json({ ok: false, error: 'invalid_init_data' });
    }

    // Проверка админа
    const adminIds = (process.env.ADMIN_CHAT_IDS || '')
      .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const isAdmin = adminIds.includes(String(uid)) || uid === 'unsafe-admin';
    if (!isAdmin) {
      warn('products', `User ${uid} is not admin`);
      return res.status(403).json({ ok: false, error: 'not_admin' });
    }

    // Сохранение карточки
    const list = loadProductsFile();
    const i = list.findIndex(p => p.id === product.id);
    if (i >= 0) list[i] = product; else list.push(product);

    log('products', 'Upserting product:', product.id, 'title:', product.title);
    const ok = saveProductsFile(list);
    log('products', `File write ${ok ? 'OK' : 'FAIL'}. Total: ${list.length}`);

    return res.json({ ok: true });
  } catch (e) {
    err('products', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


app.delete('/products/:id', express.json(), (req, res) => {
  try{
    const { init_data } = req.body || {};
    const v = verifyInitData(init_data);
    if (!v) return res.status(403).json({ ok:false, error:'invalid_init_data' });
    const uid = v.user_id || (v.data && (v.data.user_id || v.data.user && JSON.parse(v.data.user).id));
    if (!uid || !ADMIN_CHAT_IDS.includes(Number(uid))) return res.status(403).json({ ok:false, error:'not_admin' });
    const id = req.params.id;
    let list = loadProductsFile().filter(x=>x.id!==id);
    saveProductsFile(list);
    (async ()=>{
      try{ const txt = JSON.stringify(list, null, 2); const f = await githubGetFileContent(); const sha = f && f.sha ? f.sha : undefined; const p = await githubPutFileContent(txt, sha); if (!p.ok) console.warn('github push failed', p.error); else console.log('products.json pushed to GitHub'); }catch(e){ console.warn('push products to github error', e.message); }
    })();
    return res.json({ ok:true });
  }catch(e){ console.error('DELETE /products error', e.message); return res.status(500).json({ ok:false }); }
});

// PATCH /products/:id - partial update
app.patch('/products/:id', express.json(), (req, res) => {
  try{
    const { init_data, patch } = req.body || {};
    const v = verifyInitData(init_data);
    if (!v) return res.status(403).json({ ok:false, error:'invalid_init_data' });
    const uid = v.user_id || (v.data && (v.data.user_id || v.data.user && JSON.parse(v.data.user).id));
    if (!uid || !ADMIN_CHAT_IDS.includes(Number(uid))) return res.status(403).json({ ok:false, error:'not_admin' });

    const id = req.params.id;
    if (!patch || typeof patch !== 'object') return res.status(400).json({ ok:false, error:'missing_patch' });

    const list = loadProductsFile();
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return res.status(404).json({ ok:false, error:'not_found' });

    // merge allowed fields
    const allowed = ['title','shortDescription','short','description','long','imgs','link'];
    const target = list[idx];
    for (const k of Object.keys(patch)) {
      if (allowed.includes(k)) target[k] = patch[k];
    }
    target.updatedAt = (new Date()).toISOString();
    saveProductsFile(list);

    // async push to GitHub
    (async ()=>{
      try{ const txt = JSON.stringify(list, null, 2); const f = await githubGetFileContent(); const sha = f && f.sha ? f.sha : undefined; const p = await githubPutFileContent(txt, sha); if (!p.ok) console.warn('github push failed', p.error); else console.log('products.json pushed to GitHub'); }catch(e){ console.warn('push products to github error', e.message); }
    })();

    return res.json({ ok:true, product: target });
  }catch(e){ console.error('PATCH /products/:id error', e.message); return res.status(500).json({ ok:false, error: e.message }); }
});

// DELETE /images - delete image from Cloudinary or local storage and optionally remove from product
app.delete('/images', express.json(), async (req, res) => {
  try{
    const { init_data, public_id, path: imgPath, productId } = req.body || {};
    const v = verifyInitData(init_data);
    if (!v) return res.status(403).json({ ok:false, error:'invalid_init_data' });
    const uid = v.user_id || (v.data && (v.data.user_id || v.data.user && JSON.parse(v.data.user).id));
    if (!uid || !ADMIN_CHAT_IDS.includes(Number(uid))) return res.status(403).json({ ok:false, error:'not_admin' });

    let deleted = false;

    // Try Cloudinary delete if public_id provided and cloudinary configured
    if (public_id && cloudinary && cloudinary.uploader && process.env.CLOUDINARY_URL) {
      try{
        const r = await cloudinary.uploader.destroy(public_id);
        console.log('cloudinary destroy', public_id, r);
        deleted = true;
      }catch(e){ console.warn('cloudinary destroy failed', e.message); }
    }

    // If path provided and points to /assets, try local fs delete
    if (!deleted && imgPath && String(imgPath).startsWith('/assets/')) {
      try{
        const rel = imgPath.replace(/^\//,'');
        const abs = path.join(__dirname, rel);
        if (fs.existsSync(abs)) { fs.unlinkSync(abs); deleted = true; }
      }catch(e){ console.warn('local delete failed', e.message); }
    }

    // If productId provided, remove image entries matching public_id or url
    if (productId) {
      try{
        const list = loadProductsFile();
        const idx = list.findIndex(x => x.id === productId);
        if (idx !== -1) {
          const prod = list[idx];
          const imgs = (prod.imgs || []).filter(img => {
            if (!img) return false;
            if (typeof img === 'string') return !(img.includes(public_id) || img.includes(imgPath || ''));
            const url = img.url || '';
            const pid = img.public_id || '';
            return !(pid === public_id || url.includes(public_id) || url.includes(imgPath || ''));
          });
          prod.imgs = imgs;
          prod.updatedAt = (new Date()).toISOString();
          saveProductsFile(list);
          // push to GitHub async
          (async ()=>{ try{ const txt = JSON.stringify(list, null, 2); const f = await githubGetFileContent(); const sha = f && f.sha ? f.sha : undefined; const p = await githubPutFileContent(txt, sha); if (!p.ok) console.warn('github push failed', p.error); else console.log('products.json pushed to GitHub'); }catch(e){ console.warn('push products to github error', e.message); } })();
        }
      }catch(e){ console.warn('remove image from product failed', e.message); }
    }

    return res.json({ ok:true, deleted });
  }catch(e){ console.error('DELETE /images error', e.message); return res.status(500).json({ ok:false, error: e.message }); }
});

