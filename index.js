require('dotenv').config();
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const express = require('express');
const cors = require('cors'); // ← реально используем
const app = express();

const CHANNEL_ID = process.env.CHANNEL_ID || null;
const CHANNEL_THREAD_ID = process.env.CHANNEL_THREAD_ID ? Number(process.env.CHANNEL_THREAD_ID) : null;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;
const POST_BUTTON_TEXT = process.env.POST_BUTTON_TEXT || 'Открыть';
const POST_BUTTON_URL  = process.env.POST_BUTTON_URL  || FRONTEND_URL || 'https://example.com';


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
bot.start(async (ctx) => {
  await ctx.reply('📂 Добро пожаловать! Нажмите кнопку ниже, чтобы открыть каталог услуг:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Каталог', web_app: { url: FRONTEND_URL } }]]
    }
  });

  if (ctx.chat?.type === 'private' && isAdmin(ctx.from?.id)) {
    await ctx.reply(
      [
        '🛠 <b>Публикация поста</b>',
        '• Напишите текст поста и отправьте:',
        '<code>/post Текст поста</code>',
        '• Или ответьте командой <code>/post</code> на сообщение с текстом/фото+подписью.',
        '',
        `Кнопка добавляется автоматически: «${POST_BUTTON_TEXT}» → ${POST_BUTTON_URL}`,
        CHANNEL_ID
          ? `По умолчанию посты уходят в: <code>${CHANNEL_ID}</code>`
          : 'Без CHANNEL_ID пост уйдёт в текущий чат.'
      ].join('\n'),
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }
});




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
app.use(cors({
  origin: FRONTEND_URL ? [FRONTEND_URL] : true,
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type'],
}));

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
});

// ---- Доп. endpoints: проверка admin и CRUD для карточек ----
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRODUCTS_FILE = path.join(__dirname, 'products.json');
function loadProductsFile(){
  try{ if (fs.existsSync(PRODUCTS_FILE)) return JSON.parse(fs.readFileSync(PRODUCTS_FILE,'utf8')); }catch(e){ console.warn('loadProductsFile error', e.message); }
  return [];
}
function saveProductsFile(list){
  try{ fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(list, null, 2), 'utf8'); return true; }catch(e){ console.error('saveProductsFile error', e.message); return false; }
}

function verifyInitData(initDataString){
  // initDataString — строка initData из Telegram WebApp
  if (!initDataString || !BOT_TOKEN) return null;
  try{
    // разбираем пары, разделённые либо '&' либо '\n'
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
    const { init_data } = req.body || {};
    const v = verifyInitData(init_data);
    if (!v) return res.json({ ok:false, isAdmin:false });
    const uid = v.user_id || (v.data && (v.data.user_id || v.data.user && JSON.parse(v.data.user).id));
    const isAdm = !!(uid && ADMIN_CHAT_IDS.includes(Number(uid)));
    return res.json({ ok:true, isAdmin: isAdm, user_id: uid });
  }catch(e){ console.error('check_admin error', e.message); return res.status(500).json({ ok:false }); }
});

app.get('/products', (req, res) => {
  try{
    const list = loadProductsFile();
    return res.json({ ok:true, products: list });
  }catch(e){ console.error('GET /products error', e.message); return res.status(500).json({ ok:false }); }
});

// protected upsert product
app.post('/products', express.json(), (req, res) => {
  try{
    const { init_data, product } = req.body || {};
    const v = verifyInitData(init_data);
    if (!v) return res.status(403).json({ ok:false, error:'invalid_init_data' });
    const uid = v.user_id || (v.data && (v.data.user_id || v.data.user && JSON.parse(v.data.user).id));
    if (!uid || !ADMIN_CHAT_IDS.includes(Number(uid))) return res.status(403).json({ ok:false, error:'not_admin' });

    if (!product || !product.id) return res.status(400).json({ ok:false, error:'missing_product' });
    const list = loadProductsFile().filter(x=>x.id!==product.id);
    list.push(product);
    saveProductsFile(list);
    return res.json({ ok:true, product });
  }catch(e){ console.error('POST /products error', e.message); return res.status(500).json({ ok:false }); }
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
    return res.json({ ok:true });
  }catch(e){ console.error('DELETE /products error', e.message); return res.status(500).json({ ok:false }); }
});

