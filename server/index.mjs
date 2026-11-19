// N.T Cookie × N.T Canelé — 訂單／商品／付款 API（AWS Lambda Function URL, Node 22）
// 資料：DynamoDB 單一資料表（pk/sk + gsi1）。金流：LINE Pay v3、綠界全方位金流、銀行轉帳。
// 會員：LIFF ID token（LINE Login channel）驗證後綁定 userId。
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';

const env = process.env;
const TABLE = env.TABLE || 'ntcookie';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const SITE_URL = (env.SITE_URL || 'https://brucewaynelin.github.io/ntcookie/').replace(/\/?$/, '/');
const SITE_ORIGINS = (env.SITE_ORIGINS || 'https://brucewaynelin.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const API_URL = (env.API_URL || '').replace(/\/$/, '');

// ---------------------------------------------------------------- helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const json = (status, body, headers = {}) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  body: JSON.stringify(body),
});
const text = (status, body, headers = {}) => ({ statusCode: status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body });
const redirect = (url) => ({ statusCode: 302, headers: { location: url, 'cache-control': 'no-store' }, body: '' });

// Taiwan time (UTC+8, no DST)
const twNow = () => new Date(Date.now() + 8 * 3600e3);
const twDate = (d = twNow()) => d.toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
const rand = (n = 16) => crypto.randomBytes(n).toString('base64url');
const randAlnum = (n) => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const b = crypto.randomBytes(n); for (let i = 0; i < n; i++) s += a[b[i] % a.length]; return s; };
const int = (v, d = 0) => (Number.isFinite(+v) ? Math.round(+v) : d);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const ct = (event.headers?.['content-type'] || '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw bad('資料格式錯誤'); }
}

// returnBase: the site page the customer came from (so local preview / LIFF both come back to themselves)
function siteBase(candidate) {
  const c = String(candidate || '');
  if (c && SITE_ORIGINS.some((o) => c === o || c.startsWith(o + '/'))) return c.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return SITE_URL;
}

// ---------------------------------------------------------------- data
const get = async (pk, sk) => (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;
const putRaw = (item) => ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
// every settings save also keeps the admins' rich menu in step (see syncAdminMenus)
const put = async (item) => { const r = await putRaw(item); if (item.pk === 'SETTINGS') await syncAdminMenus(item).catch(() => {}); return r; };
// 管理員專用圖文選單（多一顆「店家後台」）：是管理員就掛上，被移除就拿掉。一般客人永遠是預設選單，看不到後台按鈕。
// menuSubs 記錄目前掛著管理員選單的 LINE 帳號；只有名單有變動時才會呼叫 LINE。
async function syncAdminMenus(s) {
  const menu = env.ADMIN_RICHMENU_ID; if (!menu || !env.LINE_MESSAGING_TOKEN) return;
  const real = (id) => /^U[0-9a-f]{32}$/.test(id || '');
  const want = [...new Set([...OWNER_IDS, ...(s.admins || []).map((a) => a.sub)])].filter(real);
  const have = (s.menuSubs || []).filter(real);
  const add = want.filter((x) => !have.includes(x)); const drop = have.filter((x) => !want.includes(x));
  if (!add.length && !drop.length) return;
  const H = { authorization: `Bearer ${env.LINE_MESSAGING_TOKEN}` };
  await Promise.all([...add.map((id) => fetch(`https://api.line.me/v2/bot/user/${id}/richmenu/${menu}`, { method: 'POST', headers: H })),
    ...drop.map((id) => fetch(`https://api.line.me/v2/bot/user/${id}/richmenu`, { method: 'DELETE', headers: H }))]);
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET menuSubs = :m', ExpressionAttributeValues: { ':m': want } }));
  console.log(JSON.stringify({ adminMenu: { added: add.length, removed: drop.length } }));
}
const del = (pk, sk) => ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
async function queryAll(params) {
  const out = []; let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: TABLE, ...params, ExclusiveStartKey }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < 2000);
  return out;
}

const DEFAULT_SETTINGS = {
  leadDays: 14, // 最早可預約：今天 + N 天（店家：接單後最快兩週出貨）
  maxDays: 60, // 最晚可預約：今天 + N 天
  maxOrdersPerDay: 0, // 0 = 不限
  closedWeekdays: [], // 0 = 星期日
  blockedDates: [],
  dateLabel: '希望到貨日期',
  dateNote: '接單後最快兩週出貨；急件請先用 LINE 詢問（需加收急件費 $300～500）。',
  // 運費：可麗露只能冷凍宅配，依「每件包裹的盒數」計費，一件最多 maxPerParcel 盒，超過就拆成多件；馬林糖走常溫
  shipping: {
    frozen: { label: '黑貓冷凍宅配', tiers: [{ upTo: 1, fee: 175 }, { upTo: 4, fee: 250 }, { upTo: 9, fee: 290 }], maxPerParcel: 9 },
    ambient: { label: '黑貓常溫宅配', fee: 150 },
  },
  freeShippingOver: 0, // 0 = 不免運
  payments: { linepay: true, ecpay: true, transfer: true },
  bank: { name: '', code: '', account: '', holder: '' },
  transferDays: 2, // 轉帳期限（天）
  canele: {
    assortedPrice: 800,
    singleMinBoxes: 1,
    modes: [
      { id: '3x2', flavors: 3, each: 2, minBoxes: 3 },
      { id: '6x1', flavors: 6, each: 1, minBoxes: 6 },
    ],
  },
  // 造型餅乾：依系列單片選購；最少片數、運費級距、系列都由店家在後台設定
  cookie: {
    minPieces: 6,
    shipping: { label: '黑貓宅配（造型餅乾）', tiers: [{ upTo: 8, fee: 130 }, { upTo: 999, fee: 170 }] },
    series: [], // { id, name, lines: [說明], photo, groups: ['character'|'birthday'], active, sort }
  },
  notice: '',
  pauseOrders: true, // 暫停接單：客人只能看、不能下單（管理員照樣能測）
  testMode: true, // 測試模式：只有管理員能線上結帳；客人看到「用 LINE 傳訂單給店家」
  admins: [],
};

async function getSettings() {
  const s = await get('SETTINGS', 'main');
  if (s) {
    return {
      ...DEFAULT_SETTINGS, ...s, canele: { ...DEFAULT_SETTINGS.canele, ...(s.canele || {}) },
      cookie: { ...DEFAULT_SETTINGS.cookie, ...(s.cookie || {}), shipping: { ...DEFAULT_SETTINGS.cookie.shipping, ...(s.cookie?.shipping || {}) } },
      shipping: { frozen: { ...DEFAULT_SETTINGS.shipping.frozen, ...(s.shipping?.frozen || {}) }, ambient: { ...DEFAULT_SETTINGS.shipping.ambient, ...(s.shipping?.ambient || {}) } },
    };
  }
  const fresh = { pk: 'SETTINGS', sk: 'main', ...DEFAULT_SETTINGS, adminInvite: randAlnum(10) };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: fresh, ConditionExpression: 'attribute_not_exists(pk)' })).catch(() => {});
  return (await get('SETTINGS', 'main')) || fresh;
}

// 造型餅乾系列沒有自己的開關（SK 11-19）：系列裡只要有一款餅乾「上架」，客人就看得到這個系列；一款都沒上架＝客人看不到。
// 管理員看得到全部系列（預覽、下測試單用）；回傳的 active＝這個系列現在客人看不看得到。
const seriesOf = (s) => [...(s.cookie?.series || [])].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
function visibleSeries(s, products, admin = false) {
  const live = new Set(products.filter((p) => p.category === 'cookie' && p.active).map((p) => p.series));
  return seriesOf(s).filter((x) => admin || live.has(x.id)).map((x) => ({ ...x, active: live.has(x.id) }));
}
const linepayReady = () => !!(env.LINEPAY_CHANNEL_ID && env.LINEPAY_CHANNEL_SECRET);
const ecpayReady = () => !!(env.ECPAY_MERCHANT_ID && env.ECPAY_HASH_KEY && env.ECPAY_HASH_IV);

const isAdminOf = (s, u) => !!(u && (u.shopAdmin || OWNER_IDS.has(u.sub) || (s.admins || []).some((a) => a.sub === u.sub)));
function publicSettings(s, admin = false, products = null) {
  const bankReady = !!(s.bank?.account);
  const open = !s.testMode || admin; // while testing, only admins can pay online
  return {
    testMode: !!s.testMode,
    pauseOrders: !!(s.pauseOrders && !admin),
    leadDays: s.leadDays, maxDays: s.maxDays, closedWeekdays: s.closedWeekdays, blockedDates: s.blockedDates,
    maxOrdersPerDay: s.maxOrdersPerDay, dateLabel: s.dateLabel, dateNote: s.dateNote || '',
    shipping: s.shipping, freeShippingOver: s.freeShippingOver,
    shippingOptions: [], // older cached pages still read this
    payments: {
      linepay: !!(open && s.payments?.linepay && linepayReady()),
      ecpay: !!(open && s.payments?.ecpay && ecpayReady()),
      transfer: !!(open && s.payments?.transfer && bankReady),
    },
    canele: s.canele, notice: s.notice, today: twDate(),
    cookie: { minPieces: s.cookie.minPieces, shipping: s.cookie.shipping, series: products ? visibleSeries(s, products, admin) : [] },
    preview: admin ? { closed: !!s.pauseOrders, testMode: !!s.testMode } : undefined, // 店家登入時：客人實際看到的狀態
  };
}

const PRODUCT_FIELDS = ['id', 'category', 'name', 'price', 'unit', 'photo', 'card', 'cardName', 'cardPrice', 'cardKind', 'icon', 'desc', 'active', 'soldOut', 'sort', 'series', 'textLabel', 'textMax', 'textOptional'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const listProducts = async () => (await queryAll({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'PRODUCT' } }))
  .map((p) => pick(p, PRODUCT_FIELDS)).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.id.localeCompare(b.id));

// ---------------------------------------------------------------- 店家密碼登入（不靠 LINE 也進得了後台）
// 密碼只存雜湊；登入成功發一張簽章過的通行證（60 天），改密碼後舊通行證全部失效。
const hashPass = (pass, salt = rand(12)) => `${salt}:${crypto.scryptSync(String(pass), salt, 32).toString('base64url')}`;
function checkPass(pass, stored) {
  if (!stored || typeof pass !== 'string') return false;
  const [salt, h] = stored.split(':'); const a = Buffer.from(h || '', 'base64url'); const b = crypto.scryptSync(pass, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sessionSig = (body, s) => crypto.createHmac('sha256', s.sessionSecret).update(body).digest('base64url');
function signSession(s) {
  const body = Buffer.from(JSON.stringify({ v: s.passVersion || 1, exp: Date.now() + 60 * 864e5 })).toString('base64url');
  return `adm.${body}.${sessionSig(body, s)}`;
}
function readSession(tok, s) {
  const [, body, sig] = String(tok).split('.');
  if (!body || !sig || !s.sessionSecret || !s.adminPass) return false;
  const good = sessionSig(body, s);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() && p.v === (s.passVersion || 1); } catch { return false; }
}
const SHOP_ADMIN = { sub: 'shop-admin', name: '店家', picture: '', shopAdmin: true };
// 負責人手機：寫死在伺服器設定（OWNER_PHONE），後台刪不掉；任何 LINE 帳號輸入這個號碼都會成為「負責人」等級的管理員
const OWNER_PHONE = String(env.OWNER_PHONE || '').replace(/\D/g, '');
// 最大管理員：寫死的 LINE 帳號 ID（OWNER_LINE_IDS，逗號分隔），永遠是負責人、後台刪不掉
const OWNER_IDS = new Set(String(env.OWNER_LINE_IDS || '').split(',').map((x) => x.trim()).filter(Boolean));
const ADMIN_URL = env.ADMIN_URL || 'https://liff.line.me/2012677349-KI6PM6Pz/admin.html';
const adminLink = (no) => `${ADMIN_URL}?order=${no}`;
const isOwnerOf = (s, u) => !!(u && (OWNER_IDS.has(u.sub) || (s.admins || []).some((a) => a.sub === u.sub && a.owner)));
const adminView = (s) => ({ ...s, pk: undefined, sk: undefined, adminPass: undefined, sessionSecret: undefined, menuSubs: undefined, hasAdminPass: !!s.adminPass,
  admins: [...(s.admins || []).map((a) => (OWNER_IDS.has(a.sub) ? { ...a, owner: true, fixed: true } : a)),
    ...[...OWNER_IDS].filter((id) => !(s.admins || []).some((a) => a.sub === id)).map((id) => ({ sub: id, name: '負責人（還沒登入過）', owner: true, fixed: true }))],
  adminPhones: [...(OWNER_PHONE ? [{ phone: OWNER_PHONE, label: '負責人', owner: true }] : []), ...(s.adminPhones || []).filter((p) => p.phone !== OWNER_PHONE)] });

// ---------------------------------------------------------------- auth (LIFF ID token)
const tokenCache = new Map();
async function getUser(event) {
  const h = event.headers || {};
  if (env.DEV_KEY && h['x-dev-key'] === env.DEV_KEY && h['x-dev-user']) { // test-only impersonation (dev function)
    const [sub, name] = decodeURIComponent(h['x-dev-user']).split('|');
    return { sub, name: name || 'Dev', picture: '' };
  }
  const m = /^Bearer\s+(.+)$/i.exec(h.authorization || '');
  if (!m) return null;
  const tok = m[1];
  if (tok.startsWith('adm.')) {
    if (env.ALLOW_PASSCODE === '1' && readSession(tok, await getSettings())) return SHOP_ADMIN;
    throw new HttpError(401, '請用管理員的 LINE 帳號登入');
  }
  const hit = tokenCache.get(tok);
  if (hit && hit.exp * 1000 > Date.now()) return hit.user;
  if (!env.LINE_LOGIN_CHANNEL_ID) return null;
  if (tok.startsWith('lat.')) { // LINE access token (used when LINE's browser gives the page no ID token): ask LINE who this is
    const at = tok.slice(4);
    const v = await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(at));
    const vj = v.ok ? await v.json() : null;
    if (!vj || String(vj.client_id) !== String(env.LINE_LOGIN_CHANNEL_ID) || !(vj.expires_in > 0)) throw new HttpError(401, 'LINE 登入已過期，請重新開啟頁面');
    const p = await fetch('https://api.line.me/v2/profile', { headers: { authorization: 'Bearer ' + at } });
    if (!p.ok) throw new HttpError(401, 'LINE 登入已過期，請重新開啟頁面');
    const pj = await p.json();
    const user = { sub: pj.userId, name: pj.displayName || '', picture: pj.pictureUrl || '' };
    tokenCache.set(tok, { exp: Math.floor(Date.now() / 1000) + Math.min(vj.expires_in, 3600), user });
    return user;
  }
  const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: tok, client_id: env.LINE_LOGIN_CHANNEL_ID }),
  });
  if (!r.ok) throw new HttpError(401, 'LINE 登入已過期，請重新開啟頁面');
  const v = await r.json();
  const user = { sub: v.sub, name: v.name || '', picture: v.picture || '' };
  tokenCache.set(tok, { exp: v.exp, user });
  return user;
}
async function requireUser(event) { const u = await getUser(event); if (!u) throw new HttpError(401, '請先用 LINE 登入'); return u; }
async function requireAdmin(event) {
  const u = await requireUser(event);
  const s = await getSettings();
  if (!isAdminOf(s, u)) throw new HttpError(403, '這個 LINE 帳號不是管理員');
  return { user: u, settings: s };
}

// ---------------------------------------------------------------- pricing
const TEMP = { canele: 'frozen', meringue: 'ambient', cookie: 'cookie' };
// keep in sync with NTC.shipping in js/app.js
function calcShipping(lines, subtotal, settings) {
  const sh = settings.shipping; const parts = [];
  const boxes = lines.filter((l) => l.temp === 'frozen').reduce((a, l) => a + l.qty, 0);
  if (boxes) {
    const tiers = [...(sh.frozen.tiers || [])].map((t) => ({ upTo: int(t.upTo), fee: int(t.fee) })).filter((t) => t.upTo > 0).sort((a, b) => a.upTo - b.upTo);
    const max = Math.max(1, int(sh.frozen.maxPerParcel) || (tiers.length ? tiers[tiers.length - 1].upTo : boxes));
    const feeFor = (n) => (tiers.find((t) => n <= t.upTo) || tiers[tiers.length - 1] || { fee: 0 }).fee;
    let left = boxes; let fee = 0; let parcels = 0;
    while (left > 0) { const n = Math.min(left, max); fee += feeFor(n); left -= n; parcels++; }
    parts.push({ kind: 'frozen', label: sh.frozen.label, units: boxes, parcels, fee });
  }
  const jars = lines.filter((l) => l.temp === 'ambient').reduce((a, l) => a + l.qty, 0);
  const pieces = lines.filter((l) => l.temp === 'cookie').reduce((a, l) => a + l.qty, 0);
  if (pieces) { // 造型餅乾：依片數級距；同一單的馬林糖跟餅乾裝同一箱常溫寄（運費取兩者較高的）
    const cs = settings.cookie?.shipping || DEFAULT_SETTINGS.cookie.shipping;
    const tiers = [...(cs.tiers || [])].map((t) => ({ upTo: int(t.upTo), fee: int(t.fee) })).filter((t) => t.upTo > 0).sort((a, b) => a.upTo - b.upTo);
    const fee = (tiers.find((t) => pieces <= t.upTo) || tiers[tiers.length - 1] || { fee: 0 }).fee;
    parts.push(jars ? { kind: 'cookie', label: `${cs.label}（含馬林糖）`, units: pieces, parcels: 1, fee: Math.max(fee, int(sh.ambient.fee)) } : { kind: 'cookie', label: cs.label, units: pieces, parcels: 1, fee });
  } else if (jars) parts.push({ kind: 'ambient', label: sh.ambient.label, units: jars, parcels: 1, fee: int(sh.ambient.fee) });
  const freeOver = int(settings.freeShippingOver);
  if (freeOver > 0 && subtotal >= freeOver) parts.forEach((p) => { p.fee = 0; });
  return { label: parts.map((p) => p.label + (p.parcels > 1 ? `（${p.parcels} 件）` : '')).join('＋'), fee: parts.reduce((a, p) => a + p.fee, 0), parts };
}
function priceOrder(reqItems, products, settings, { admin = false } = {}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const usable = (p) => p && !p.soldOut && (p.active || (admin && p.category === 'cookie')); // admins can test-order 未上架 cookies
  if (!Array.isArray(reqItems) || !reqItems.length) throw bad('購物車是空的');
  if (reqItems.length > 40) throw bad('品項太多');
  const lines = [];
  for (const it of reqItems) {
    const qty = int(it.qty);
    if (!(qty >= 1 && qty <= 200)) throw bad('數量不正確');
    if (it.type === 'product') {
      const p = byId.get(it.productId);
      if (!usable(p)) throw bad(`「${p?.name || '商品'}」目前無法訂購，請從購物車移除`);
      if (p.category === 'cookie') {
        const se = seriesOf(settings).find((x) => x.id === p.series);
        if (!se) throw bad(`「${p.name}」目前無法訂購，請從購物車移除`);
        let text = '';
        if (p.textLabel) {
          text = String(it.text ?? '').trim().replace(/\s+/g, ' ');
          if (!text && !p.textOptional) throw bad(`「${p.name}」請填寫${p.textLabel}`);
          if ([...text].length > int(p.textMax, 12)) throw bad(`「${p.name}」的${p.textLabel}最多 ${int(p.textMax, 12)} 個字`);
        }
        lines.push({ type: 'product', productId: p.id, name: p.name, detail: se.name + (text ? `｜${p.textLabel}：${text}` : ''), text: text || undefined, unit: p.unit || '片', price: int(p.price), qty, temp: 'cookie' });
      } else if (p.category === 'canele') {
        const min = int(settings.canele?.singleMinBoxes, 1);
        if (qty < min) throw bad(`單一口味禮盒 ${min} 盒起訂`);
        lines.push({ type: 'product', productId: p.id, name: `${p.name}・單一口味禮盒`, detail: '每盒 6 顆・皆為相同口味', unit: '盒', price: int(p.price), qty, temp: 'frozen' });
      } else {
        lines.push({ type: 'product', productId: p.id, name: p.name, unit: p.unit || '個', price: int(p.price), qty, temp: TEMP[p.category] || 'ambient' });
      }
    } else if (it.type === 'canele-assorted') {
      const mode = (settings.canele?.modes || []).find((m) => m.id === it.mode);
      if (!mode) throw bad('綜合禮盒組合不正確');
      const ids = [...new Set(Array.isArray(it.flavors) ? it.flavors : [])];
      if (ids.length !== mode.flavors) throw bad(`綜合禮盒要選 ${mode.flavors} 種口味`);
      const fl = ids.map((id) => byId.get(id));
      if (fl.some((p) => !usable(p) || p.category !== 'canele')) throw bad('綜合禮盒裡有口味目前無法訂購');
      if (qty < mode.minBoxes) throw bad(`任選 ${mode.flavors} 種口味的綜合禮盒 ${mode.minBoxes} 盒起訂`);
      lines.push({
        type: 'canele-assorted', mode: mode.id, flavors: ids,
        name: `綜合口味禮盒（任選 ${mode.flavors} 種）`, detail: fl.map((p) => p.name).join('、') + `｜每種 ${mode.each} 顆`,
        unit: '盒', price: int(settings.canele.assortedPrice), qty, temp: 'frozen',
      });
    } else throw bad('購物車資料不正確');
  }
  const pieces = lines.filter((l) => l.temp === 'cookie').reduce((a, l) => a + l.qty, 0);
  const minPieces = int(settings.cookie?.minPieces, 1);
  if (pieces && pieces < minPieces) throw bad(`造型餅乾 ${minPieces} 片起訂（目前 ${pieces} 片），可以跨系列搭配`);
  for (const l of lines) l.subtotal = l.price * l.qty;
  const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
  const shipping = calcShipping(lines, subtotal, settings);
  return { lines, subtotal, shipping, total: subtotal + shipping.fee };
}

async function checkDate(date, settings) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad(`請選擇${settings.dateLabel || '日期'}`);
  const today = twDate();
  if (date < addDays(today, int(settings.leadDays))) throw bad(`最早只能預約 ${addDays(today, int(settings.leadDays))}`);
  if (date > addDays(today, int(settings.maxDays, 60))) throw bad('日期太遠，請選近一點的日期');
  if ((settings.blockedDates || []).includes(date) || (settings.closedWeekdays || []).includes(weekday(date))) throw bad(`${date} 不接單，請換一天`);
}

async function fullDates(settings) {
  const max = int(settings.maxOrdersPerDay);
  if (!max) return [];
  const today = twDate();
  const rows = await queryAll({
    KeyConditionExpression: 'pk = :p AND sk BETWEEN :a AND :b',
    ExpressionAttributeValues: { ':p': 'DATE', ':a': today, ':b': addDays(today, int(settings.maxDays, 60)) },
  });
  return rows.filter((r) => (r.count || 0) >= max).map((r) => r.sk);
}

async function takeDateSlot(date, settings) {
  const max = int(settings.maxOrdersPerDay);
  const params = {
    TableName: TABLE, Key: { pk: 'DATE', sk: date },
    UpdateExpression: 'ADD #c :one', ExpressionAttributeNames: { '#c': 'count' }, ExpressionAttributeValues: { ':one': 1 },
  };
  if (max) { params.ConditionExpression = 'attribute_not_exists(#c) OR #c < :max'; params.ExpressionAttributeValues[':max'] = max; }
  try { await ddb.send(new UpdateCommand(params)); } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') throw bad(`${date} 已經額滿，請換一天`);
    throw e;
  }
}
const releaseDateSlot = (date) => ddb.send(new UpdateCommand({
  TableName: TABLE, Key: { pk: 'DATE', sk: date }, UpdateExpression: 'ADD #c :m', ExpressionAttributeNames: { '#c': 'count' }, ExpressionAttributeValues: { ':m': -1 },
})).catch(() => {});

async function nextOrderNo() {
  const day = twDate().replace(/-/g, '').slice(2); // yymmdd
  const r = await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: 'COUNTER', sk: day }, UpdateExpression: 'ADD n :one', ExpressionAttributeValues: { ':one': 1 }, ReturnValues: 'UPDATED_NEW',
  }));
  return `NT${day}${String(r.Attributes.n).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- orders
const STATUS = {
  pending: '待付款', reported: '已匯款（待確認）', paid: '已付款', making: '製作中', shipped: '已出貨', done: '已完成', cancelled: '已取消',
};
const PAY_LABEL = { linepay: 'LINE Pay', ecpay: '信用卡／ATM／超商', transfer: '銀行轉帳' };

function publicOrder(o, settings) {
  const v = pick(o, ['orderNo', 'createdAt', 'status', 'lines', 'subtotal', 'shipping', 'total', 'date', 'note', 'contact']);
  v.statusLabel = STATUS[o.status] || o.status;
  v.payment = pick(o.payment || {}, ['method', 'status', 'paidAt', 'last5', 'info', 'deadline']);
  v.payment.label = PAY_LABEL[o.payment?.method] || '';
  if (o.payment?.method === 'transfer' && settings) v.bank = settings.bank;
  v.adminMessage = o.adminMessage || '';
  return v;
}
const adminOrder = (o) => ({ ...publicOrder(o), byShop: !!o.byShop, token: o.token, user: o.user, payment: o.payment, adminNote: o.adminNote || '', adminMessage: o.adminMessage || '', history: o.history || [] });

async function loadOrder(no, event, token) {
  const o = await get('ORDER', String(no || ''));
  if (!o) throw new HttpError(404, '找不到這筆訂單');
  if (token && token === o.token) return o;
  const u = await getUser(event).catch(() => null);
  if (u && o.user?.sub === u.sub) return o;
  if (u && isAdminOf(await getSettings(), u)) return o;
  throw new HttpError(403, '沒有權限看這筆訂單');
}

async function setOrder(no, fields, historyNote) {
  const names = {}; const values = {}; const sets = [];
  Object.entries(fields).forEach(([k, v], i) => { names['#f' + i] = k; values[':v' + i] = v; sets.push(`#f${i} = :v${i}`); });
  if (historyNote) { names['#h'] = 'history'; values[':h'] = [{ at: new Date().toISOString(), note: historyNote }]; values[':e'] = []; sets.push('#h = list_append(if_not_exists(#h, :e), :h)'); }
  if (!sets.length) return get('ORDER', no);
  const expr = 'SET ' + sets.join(', ');
  const r = await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: 'ORDER', sk: no }, UpdateExpression: expr, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
  }));
  return r.Attributes;
}

async function markPaid(o, detail, note) {
  if (o.payment?.status === 'paid') return o;
  const payment = { ...(o.payment || {}), ...detail, status: 'paid', paidAt: new Date().toISOString() };
  const status = ['pending', 'reported'].includes(o.status) ? 'paid' : o.status;
  const n = await setOrder(o.orderNo, { payment, status }, note);
  await notifyAdmins(`💰 已付款 ${o.orderNo}｜$${o.total}｜${PAY_LABEL[payment.method] || ''}｜${o.contact?.name || ''}${o.user?.name && o.user.name !== o.contact?.name ? `（LINE：${o.user.name}）` : ''}\n${adminLink(o.orderNo)}`).catch(() => {});
  await pushTo(o.user?.sub, `您的訂單 ${o.orderNo} 已付款成功，我們會依預約日期為您製作 ♡`).catch(() => {});
  return n;
}

// optional: LINE Messaging API push (only when the OA has Messaging API enabled and a token is set)
async function pushTo(to, message) {
  if (!env.LINE_MESSAGING_TOKEN || !to || !/^U[0-9a-f]{32}$/.test(to)) return; // only real LINE user IDs
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_MESSAGING_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: message.slice(0, 4900) }] }),
  });
  // one log line per notification (no message text): to whom (masked), what kind, LINE's answer
  console.log(JSON.stringify({ push: to.slice(0, 5) + '…' + to.slice(-4), kind: message.split('\n')[0].slice(0, 20), status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 160) }));
}
async function notifyAdmins(message) {
  if (!env.LINE_MESSAGING_TOKEN) return;
  const s = await getSettings();
  const ids = new Set([...OWNER_IDS, ...(s.admins || []).map((a) => a.sub)]);
  await Promise.all([...ids].map((id) => pushTo(id, message).catch(() => {})));
}

// ---------------------------------------------------------------- LINE 官方帳號自動回覆（Messaging API webhook）
// 客人在聊天室傳訂單編號 → 自動回目前狀態；傳「訂單／查詢／進度」→ 回這個 LINE 帳號最近的訂單。其他訊息不回（留給店家聊天）。
async function lineReply(replyToken, textMsg) {
  if (!env.LINE_MESSAGING_TOKEN || !replyToken) return;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_MESSAGING_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: textMsg.slice(0, 4900) }] }),
  });
}
const twDay = (ymd) => { const d = new Date(ymd + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日一二三四五六'[d.getUTCDay()]}）`; };
function payLine(o) {
  if (o.status === 'cancelled') return '';
  if (o.payment?.status === 'paid') return '付款：已確認收到 ✓';
  if (o.status === 'reported') return `付款：已收到您的匯款回報（末五碼 ${o.payment.last5}），店家確認中`;
  if (o.payment?.method === 'transfer') return `付款：請匯款 $${o.total}，再到訂單頁回報帳號末五碼`;
  return '付款：尚未完成';
}
function statusText(o, mine) {
  if (!mine) return `📦 ${o.orderNo}
目前狀態：${STATUS[o.status] || o.status}`; // not this LINE account's order: status only, no personal details
  return [`📦 ${o.orderNo}`, `目前狀態：${STATUS[o.status] || o.status}`, payLine(o), `${'希望到貨'}：${twDay(o.date)}`, `合計：$${o.total}`, o.adminMessage ? `店家留言：${o.adminMessage}` : ''].filter(Boolean).join('\n');
}
async function lineWebhook(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const sig = String(event.headers?.['x-line-signature'] || '');
  const good = crypto.createHmac('sha256', env.LINE_MESSAGING_SECRET || 'unset').update(raw).digest('base64');
  if (!env.LINE_MESSAGING_SECRET || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return text(401, 'bad signature');
  let body; try { body = JSON.parse(raw || '{}'); } catch { return text(400, 'bad body'); }
  for (const ev of body.events || []) {
    try {
      if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.replyToken) continue;
      const msg = String(ev.message.text || ''); const uid = ev.source?.userId;
      const nos = [...new Set(msg.toUpperCase().replace(/\s/g, '').match(/NT\d{9}/g) || [])].slice(0, 3);
      if (nos.length) {
        const parts = [];
        const asAdmin = isAdminOf(await getSettings(), uid ? { sub: uid } : null);
        for (const no of nos) {
          const o = await get('ORDER', no);
          parts.push(!o ? `📦 ${no}\n找不到這筆訂單，請確認編號是否正確` : asAdmin ? `${statusText(o, true)}\n客人：${o.contact?.name || ''} ${o.contact?.phone || ''}\n後台：${adminLink(o.orderNo)}` : statusText(o, !!uid && o.user?.sub === uid));
        }
        if (!asAdmin) parts.push(`完整明細：官網「我的訂單」輸入訂單編號＋手機\n${SITE_URL}orders.html\n（有其他問題直接留言，店家看到會盡快回覆 ♡）`);
        await lineReply(ev.replyToken, parts.join('\n\n'));
      } else if (/訂單|查詢|進度|出貨了嗎|寄出/.test(msg)) {
        const mine = uid ? await queryAll({ IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': `USER#${uid}` }, ScanIndexForward: false }) : [];
        const recent = mine.filter((o) => o.status !== 'cancelled').slice(0, 3);
        await lineReply(ev.replyToken, recent.length
          ? `您最近的訂單：\n\n${recent.map((o) => statusText(o, true)).join('\n\n')}\n\n完整明細：${SITE_URL}orders.html`
          : `想查訂單進度，請直接傳「訂單編號」給我們（例如 NT261118006），會自動回覆目前狀態 ♡\n也可以到官網「我的訂單」用訂單編號＋手機查詢：\n${SITE_URL}orders.html`);
      }
    } catch (e) { console.error('webhook event', e.message); }
  }
  return text(200, 'OK');
}

function orderSummaryText(o) {
  const items = o.lines.map((l) => `・${l.name} ×${l.qty}${l.detail && (l.type === 'canele-assorted' || l.temp === 'cookie') ? `（${l.detail}）` : ''}`).join('\n');
  return `🧾 新訂單 ${o.orderNo}\n${items}\n合計 $${o.total}（含運 $${o.shipping.fee}）\n${o.date}｜${o.contact.name} ${o.contact.phone}\n付款：${PAY_LABEL[o.payment.method]}${o.note ? `\n備註：${o.note}` : ''}`;
}

async function createOrder(event) {
  const b = parseBody(event);
  const viewer = await getUser(event).catch(() => null);
  const user = viewer && !viewer.shopAdmin ? viewer : null; // the LINE member this order belongs to (none for guests / 店家密碼)
  const [settings, products] = await Promise.all([getSettings(), listProducts()]);
  const priced = priceOrder(b.items, products, settings, { admin: isAdminOf(settings, viewer) });
  await checkDate(b.date, settings);
  const contact = { name: str(b.contact?.name, 40), phone: str(b.contact?.phone, 20), address: str(b.contact?.address, 160) };
  if (!contact.name) throw bad('請填收件人姓名');
  if (!/^[0-9+\-() ]{8,20}$/.test(contact.phone)) throw bad('請填正確的手機號碼');
  if (!contact.address) throw bad('請填收件地址');
  const method = b.payment;
  const pub = publicSettings(settings, isAdminOf(settings, viewer));
  if (pub.pauseOrders) throw bad('目前暫停接單，敬請期待 ♡');
  if (!pub.payments[method]) throw bad('這個付款方式目前不能用');
  await takeDateSlot(b.date, settings);
  const orderNo = await nextOrderNo();
  const now = new Date().toISOString();
  const o = {
    pk: 'ORDER', sk: orderNo, orderNo, token: rand(18), createdAt: now, status: 'pending',
    lines: priced.lines, subtotal: priced.subtotal, shipping: priced.shipping, total: priced.total,
    date: b.date, note: str(b.note, 500), contact,
    payment: { method, status: 'unpaid', deadline: method === 'transfer' ? addDays(twDate(), int(settings.transferDays, 2)) : undefined },
    byShop: isAdminOf(settings, viewer) ? true : undefined, // 店家自己下的單（測試用），後台可以刪
    user: user ? { sub: user.sub, name: user.name, picture: user.picture } : undefined,
    gsi1pk: user ? `USER#${user.sub}` : undefined, gsi1sk: user ? now : undefined,
    history: [{ at: now, note: `建立訂單（${PAY_LABEL[method]}）` }],
  };
  await put(o);
  if (user) await put({ pk: 'USER', sk: user.sub, ...contact, lineName: user.name, picture: user.picture, updatedAt: now });
  await notifyAdmins(`${orderSummaryText(o)}\n\n後台看這筆：${adminLink(o.orderNo)}`).catch(() => {});
  const next = await startPayment(o, b.returnBase, b.inLine);
  return json(200, { orderNo, token: o.token, total: o.total, next, summary: orderSummaryText(o) });
}

// ---------------------------------------------------------------- payments
const orderPage = (base, o, extra = '') => `${base}order.html?no=${o.orderNo}&t=${o.token}${extra}`;

async function startPayment(o, returnBase, inLine) {
  const base = siteBase(returnBase);
  const method = o.payment.method;
  if (method === 'transfer') return { type: 'order', url: orderPage(base, o) };
  if (method === 'linepay') return linepayRequest(o, base, inLine);
  if (method === 'ecpay') return ecpayForm(o, base);
  throw bad('付款方式不正確');
}

// --- LINE Pay Online API v3
const LP_HOST = () => (env.LINEPAY_ENV === 'production' ? 'https://api-pay.line.me' : 'https://sandbox-api-pay.line.me');
async function linepayCall(uri, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const nonce = crypto.randomUUID();
  const sig = crypto.createHmac('sha256', env.LINEPAY_CHANNEL_SECRET).update(env.LINEPAY_CHANNEL_SECRET + uri + body + nonce).digest('base64');
  const r = await fetch(LP_HOST() + uri, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-LINE-ChannelId': env.LINEPAY_CHANNEL_ID, 'X-LINE-Authorization-Nonce': nonce, 'X-LINE-Authorization': sig },
    body,
  });
  const raw = await r.text();
  // transactionId is a 19-digit number: keep it as a string before JSON.parse rounds it
  return JSON.parse(raw.replace(/"transactionId"\s*:\s*(\d+)/g, '"transactionId":"$1"'));
}
async function linepayRequest(o, base, inLine) {
  const products = o.lines.map((l) => ({ name: l.name.slice(0, 100), quantity: l.qty, price: l.price }));
  if (o.shipping.fee) products.push({ name: '運費', quantity: 1, price: o.shipping.fee });
  const back = `${API_URL}/pay/linepay`;
  const q = `no=${o.orderNo}&t=${o.token}&b=${encodeURIComponent(base)}`;
  const res = await linepayCall('/v3/payments/request', {
    amount: o.total, currency: 'TWD', orderId: `${o.orderNo}-${randAlnum(4)}`,
    packages: [{ id: o.orderNo, amount: o.total, name: 'N.T Cookie × N.T Canelé', products }],
    redirectUrls: { confirmUrl: `${back}/confirm?${q}`, cancelUrl: `${back}/cancel?${q}` },
    options: { display: { locale: 'zh_TW' } },
  });
  if (res.returnCode !== '0000') throw new HttpError(502, `LINE Pay 暫時無法使用（${res.returnCode} ${res.returnMessage || ''}）`);
  await setOrder(o.orderNo, { payment: { ...o.payment, transactionId: res.info.transactionId } }, 'LINE Pay 付款請求');
  return { type: 'redirect', url: inLine && res.info.paymentUrl.app ? res.info.paymentUrl.app : res.info.paymentUrl.web, web: res.info.paymentUrl.web };
}
async function linepayConfirm(event) {
  const q = new URLSearchParams(event.rawQueryString || '');
  const base = siteBase(q.get('b'));
  const o = await get('ORDER', q.get('no') || '');
  if (!o || o.token !== q.get('t')) return redirect(`${base}index.html`);
  if (o.payment?.status === 'paid') return redirect(orderPage(base, o));
  const tid = q.get('transactionId');
  if (!tid || tid !== String(o.payment?.transactionId)) return redirect(orderPage(base, o, '&pay=fail'));
  const res = await linepayCall(`/v3/payments/${tid}/confirm`, { amount: o.total, currency: 'TWD' });
  if (res.returnCode === '0000' || res.returnCode === '1172') { // 1172 = already confirmed
    await markPaid(o, { method: 'linepay', transactionId: tid }, 'LINE Pay 付款成功');
    return redirect(orderPage(base, o, '&pay=ok'));
  }
  await setOrder(o.orderNo, {}, `LINE Pay 付款失敗 ${res.returnCode} ${res.returnMessage || ''}`).catch(() => {});
  return redirect(orderPage(base, o, '&pay=fail'));
}
async function linepayCancel(event) {
  const q = new URLSearchParams(event.rawQueryString || '');
  const base = siteBase(q.get('b'));
  const o = await get('ORDER', q.get('no') || '');
  if (!o || o.token !== q.get('t')) return redirect(`${base}index.html`);
  return redirect(orderPage(base, o, '&pay=cancel'));
}

// --- 綠界 ECPay 全方位金流 (AioCheckOut V5)
const EC_HOST = () => (env.ECPAY_ENV === 'production' ? 'https://payment.ecpay.com.tw' : 'https://payment-stage.ecpay.com.tw');
function ecpayEncode(s) {
  // .NET HttpUtility.UrlEncode + lowercase, the way ECPay computes CheckMacValue
  return encodeURIComponent(s).replace(/%20/g, '+').replace(/'/g, '%27').replace(/~/g, '%7e').toLowerCase();
}
function ecpayMac(params) {
  const keys = Object.keys(params).filter((k) => k !== 'CheckMacValue').sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  const raw = `HashKey=${env.ECPAY_HASH_KEY}&` + keys.map((k) => `${k}=${params[k]}`).join('&') + `&HashIV=${env.ECPAY_HASH_IV}`;
  return crypto.createHash('sha256').update(ecpayEncode(raw)).digest('hex').toUpperCase();
}
const ecpayTradeDate = () => twNow().toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, '/');
async function ecpayForm(o, base) {
  const tradeNo = `${o.orderNo}${randAlnum(4)}`; // ≤20 chars, unique per attempt
  const itemName = o.lines.map((l) => `${l.name.replace(/[#&]/g, ' ')} x${l.qty}`).concat(o.shipping.fee ? [`運費 x1`] : []).join('#').slice(0, 380);
  const params = {
    MerchantID: env.ECPAY_MERCHANT_ID, MerchantTradeNo: tradeNo, MerchantTradeDate: ecpayTradeDate(), PaymentType: 'aio',
    TotalAmount: String(o.total), TradeDesc: 'N.T Cookie order', ItemName: itemName,
    ReturnURL: `${API_URL}/pay/ecpay/notify`, ChoosePayment: 'ALL', EncryptType: '1',
    IgnorePayment: 'WebATM#BNPL#BARCODE',
    ClientBackURL: orderPage(base, o),
    OrderResultURL: `${API_URL}/pay/ecpay/result?b=${encodeURIComponent(base)}`,
    PaymentInfoURL: `${API_URL}/pay/ecpay/info`,
    ClientRedirectURL: `${API_URL}/pay/ecpay/result?b=${encodeURIComponent(base)}`, // ATM／超商取號後（瀏覽器 POST）
    CustomField1: o.orderNo, ExpireDate: '3', NeedExtraPaidInfo: 'N',
  };
  params.CheckMacValue = ecpayMac(params);
  await setOrder(o.orderNo, { payment: { ...o.payment, tradeNos: [...(o.payment.tradeNos || []), tradeNo] } }, '綠界付款頁');
  return { type: 'form', action: `${EC_HOST()}/Cashier/AioCheckOut/V5`, fields: params };
}
function ecpayVerify(p) { return p.CheckMacValue && ecpayMac(p) === String(p.CheckMacValue).toUpperCase(); }
async function ecpayNotify(event) {
  const p = parseBody(event);
  if (!ecpayVerify(p)) return text(400, '0|CheckMacValue error');
  const o = await get('ORDER', p.CustomField1 || '');
  if (!o) return text(200, '1|OK');
  if (String(p.RtnCode) === '1' && int(p.TradeAmt) === o.total) {
    await markPaid(o, { method: 'ecpay', tradeNo: p.TradeNo, merchantTradeNo: p.MerchantTradeNo, type: p.PaymentType, simulated: p.SimulatePaid === '1' }, `綠界付款成功（${p.PaymentType}）`);
  } else {
    await setOrder(o.orderNo, {}, `綠界通知 RtnCode=${p.RtnCode} ${p.RtnMsg || ''}`);
  }
  return text(200, '1|OK');
}
const isTakeNumber = (p) => ['2', '10100073'].includes(String(p.RtnCode));
async function saveTakeNumber(o, p) {
  if (!o || !isTakeNumber(p) || o.payment?.info?.ref === p.MerchantTradeNo) return;
  const info = p.vAccount
    ? { kind: 'atm', bankCode: p.BankCode, account: p.vAccount, expire: p.ExpireDate, ref: p.MerchantTradeNo }
    : { kind: 'cvs', code: p.PaymentNo, expire: p.ExpireDate, ref: p.MerchantTradeNo };
  await setOrder(o.orderNo, { payment: { ...o.payment, info } }, `綠界取號（${p.PaymentType}）`);
}
async function ecpayInfo(event) { // ATM／超商代碼 取號結果（server to server）
  const p = parseBody(event);
  if (!ecpayVerify(p)) return text(400, '0|CheckMacValue error');
  await saveTakeNumber(await get('ORDER', p.CustomField1 || ''), p);
  return text(200, '1|OK');
}
async function ecpayResult(event) { // browser comes back here (form POST) after paying by card
  const p = parseBody(event);
  const base = siteBase(new URLSearchParams(event.rawQueryString || '').get('b'));
  const o = await get('ORDER', p.CustomField1 || '');
  if (!o) return redirect(`${base}index.html`);
  if (ecpayVerify(p) && String(p.RtnCode) === '1' && int(p.TradeAmt) === o.total) {
    await markPaid(o, { method: 'ecpay', tradeNo: p.TradeNo, merchantTradeNo: p.MerchantTradeNo, type: p.PaymentType }, `綠界付款成功（${p.PaymentType}）`);
    return redirect(orderPage(base, o, '&pay=ok'));
  }
  if (ecpayVerify(p) && isTakeNumber(p)) { await saveTakeNumber(o, p); return redirect(orderPage(base, o, '&pay=number')); }
  return redirect(orderPage(base, o, String(p.RtnCode) === '1' ? '' : '&pay=fail'));
}

// ---------------------------------------------------------------- images (admin uploads, stored in the table)
async function putImage(b) {
  const m = /^data:(image\/(webp|jpeg|png));base64,(.+)$/.exec(b.dataUrl || '');
  if (!m) throw bad('圖片格式不支援');
  const data = m[3];
  if (data.length > 380000) throw bad('圖片太大（請小於 280 KB）');
  const id = rand(12);
  await put({ pk: 'IMG', sk: id, type: m[1], data, createdAt: new Date().toISOString() });
  return `${API_URL}/img/${id}`;
}
async function getImage(id) {
  const it = await get('IMG', id);
  if (!it) return text(404, 'not found');
  return { statusCode: 200, headers: { 'content-type': it.type, 'cache-control': 'public, max-age=31536000, immutable' }, body: it.data, isBase64Encoded: true };
}

// ---------------------------------------------------------------- 客製詢問：客人留言＋上傳參考照片 → 店家在 LINE 跟客人討論價格
const INQ_STATUS = { new: '新詢問', talking: '討論中', quoted: '已報價', confirmed: '已成立', declined: '不接單' };
const PURPOSES = ['收涎', '慶生', '抓週', '婚禮小物', '其他'];
const inqView = (q) => ({ ...q, pk: undefined, sk: undefined });
function inquirySummary(q) {
  return `🎨 客製詢問 ${q.no}\n用途：${q.purpose}${q.date ? `｜希望 ${q.date} 收到` : ''}${q.qty ? `｜約 ${q.qty} 片` : ''}\n圖案：${q.design.slice(0, 300)}${q.text ? `\n餅乾上的字：${q.text}` : ''}\n參考照片 ${q.photos.length} 張\n${q.contact.name} ${q.contact.phone}（LINE：${q.user.name || ''}）`;
}
async function createInquiry(event) {
  const u = await requireUser(event);
  if (u.shopAdmin) throw bad('請用 LINE 帳號送出');
  const b = parseBody(event);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '';
  if (date && date < twDate()) throw bad('日期不能是過去的日子');
  const design = str(b.design, 1000); if (!design) throw bad('請描述想要的圖案或主題');
  const contact = { name: str(b.name, 40), phone: str(b.phone, 20) };
  if (!contact.name) throw bad('請填聯絡人姓名');
  if (!/^[0-9+\-() ]{8,20}$/.test(contact.phone)) throw bad('請填正確的手機號碼');
  const photos = Array.isArray(b.photos) ? b.photos : [];
  if (photos.length > 5) throw bad('參考照片最多 5 張');
  for (const d of photos) if (!/^data:image\/(webp|jpeg|png);base64,/.test(d || '') || d.length > 380100) throw bad('照片格式不支援或太大');
  const rl = (await get('INQRATE', u.sub)) || { count: 0, since: 0 }; const now = Date.now(); const fresh = now - (rl.since || 0) > 864e5;
  if (!fresh && rl.count >= 6) throw new HttpError(429, '今天送出太多次了，請直接在 LINE 聊天室跟我們聊 ♡');
  await put({ pk: 'INQRATE', sk: u.sub, count: fresh ? 1 : rl.count + 1, since: fresh ? now : rl.since });
  const urls = []; for (const d of photos) urls.push(await putImage({ dataUrl: d }));
  const day = twDate().replace(/-/g, '').slice(2);
  const c = await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'COUNTER', sk: 'Q' + day }, UpdateExpression: 'ADD n :one', ExpressionAttributeValues: { ':one': 1 }, ReturnValues: 'UPDATED_NEW' }));
  const no = `Q${day}${String(c.Attributes.n).padStart(3, '0')}`; const at = new Date().toISOString();
  const q = {
    pk: 'INQUIRY', sk: no, no, createdAt: at, status: 'new', purpose: PURPOSES.includes(b.purpose) ? b.purpose : '其他', date,
    qty: Math.max(0, Math.min(9999, int(b.qty))), design, text: str(b.text, 200), contact, photos: urls,
    user: { sub: u.sub, name: u.name, picture: u.picture }, history: [{ at, note: '客人送出客製詢問' }],
  };
  await put(q);
  const old = (await get('USER', u.sub)) || {};
  await put({ ...old, pk: 'USER', sk: u.sub, name: contact.name, phone: contact.phone, lineName: u.name, picture: u.picture, updatedAt: at });
  await notifyAdmins(`${inquirySummary(q)}\n\n後台看照片：${ADMIN_URL}?inq=${no}`).catch(() => {});
  return json(200, { no, summary: inquirySummary(q).replace('🎨 客製詢問', '您好，我送出了客製詢問') });
}

// ---------------------------------------------------------------- 每天早上 9 點：提醒「兩週後客人要收到包裹」（只傳給最大管理員）
// 每張訂單只提醒一次：到貨日前剛好 14 天的那天早上；如果下單時已經不到 14 天（例如剛好 14 天前下單），就在下單隔天早上補提醒。
// 沒有要提醒的訂單就不傳（省推播額度）。
const DIGEST_DAYS = 14;
async function dailyDigest() {
  if (!env.LINE_MESSAGING_TOKEN || !OWNER_IDS.size) return { sent: false, reason: 'not configured' };
  const today = twDate(); const target = addDays(today, DIGEST_DAYS);
  const all = await queryAll({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'ORDER' } });
  const live = all.filter((o) => !o.byShop && !o.remindedAt && o.status !== 'cancelled' && o.date >= today && o.date <= target)
    .sort((a, b) => a.date.localeCompare(b.date) || a.orderNo.localeCompare(b.orderNo));
  if (!live.length) return { sent: false, reason: 'nothing to remind' };
  const onTime = live.filter((o) => o.date === target); const late = live.filter((o) => o.date < target);
  const n = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];
  const item = (o, i, withDate) => {
    const paid = o.payment?.status === 'paid' ? '已付款 ✓' : o.status === 'reported' ? '⚠️ 匯款待確認' : '⚠️ 還沒付款';
    return [`${n[i] || `(${i + 1})`} ${o.orderNo}　${o.contact?.name || ''}${withDate ? `　📅 ${twDay(o.date)}` : ''}`, `　${o.lines.map((l) => `${l.name}×${l.qty}`).join('、').slice(0, 90)}`, `　$${o.total}｜${paid}`, ''];
  };
  const lines = ['🔔 出貨提醒', ''];
  if (onTime.length) { lines.push(`<<--- 兩週後 ${twDay(target)} 客人要收到包裹：${onTime.length} 件 --->>`, ''); onTime.forEach((o, i) => lines.push(...item(o, i, false))); }
  if (late.length) { lines.push(`<<--- 新進來、兩週內客人就要收到包裹：${late.length} 件 --->>`, ''); late.forEach((o, i) => lines.push(...item(o, i, true))); }
  lines.push(`後台：${ADMIN_URL}`);
  await Promise.all([...OWNER_IDS].map((id) => pushTo(id, lines.join('\n'))));
  const at = new Date().toISOString();
  await Promise.all(live.map((o) => setOrder(o.orderNo, { remindedAt: at }).catch(() => {})));
  return { sent: true, orders: live.length };
}

// ---------------------------------------------------------------- router
export async function handler(event) {
  if (event?.source === 'ntcookie.daily') { const r = await dailyDigest(); console.log(JSON.stringify({ daily: r })); return r; }
  const res = await route(event);
  try {
    const h = event.headers || {}; const ua = h['user-agent'] || '';
    console.log(JSON.stringify({ m: event.requestContext?.http?.method, p: (event.rawPath || '').replace(/NT\d+/, 'NT…').replace(/\/img\/.+/, '/img/…'), s: res.statusCode,
      auth: h['x-dev-key'] ? 'dev' : /^Bearer adm\./i.test(h.authorization || '') ? 'pass' : /^Bearer lat\./i.test(h.authorization || '') ? 'line-at' : h.authorization ? 'line' : 'none',
      diag: h['x-ntc-diag'] ? String(h['x-ntc-diag']).slice(0, 60) : undefined,
      via: / Line\//.test(ua) ? 'LINE' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mozilla/.test(ua) ? 'desktop' : 'other' }));
  } catch (e) { /* logging must never break a request */ }
  return res;
}
async function route(event) {
  const method = event.requestContext?.http?.method || 'GET';
  const path = (event.rawPath || '/').replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  try {
    // ---- public
    if (method === 'POST' && path === '/line/webhook') return await lineWebhook(event);
    if (method === 'GET' && path === '/catalog') {
      const [settings, products, viewer] = await Promise.all([getSettings(), listProducts(), getUser(event).catch(() => null)]);
      const admin = isAdminOf(settings, viewer); const seriesIds = new Set(seriesOf(settings).map((x) => x.id));
      return json(200, {
        // customers: only 上架 products; admins also get 未上架 cookies (cookie preview marks them)
        products: products.filter((p) => (p.active || (admin && p.category === 'cookie')) && (p.category !== 'cookie' || seriesIds.has(p.series))),
        settings: publicSettings(settings, admin, products),
        fullDates: await fullDates(settings),
      }, { 'cache-control': 'no-cache' });
    }
    if (method === 'GET' && seg[0] === 'img' && seg[1]) return getImage(seg[1]);
    if (method === 'POST' && path === '/orders') return await createOrder(event);
    if (method === 'POST' && path === '/inquiries') return await createInquiry(event);
    if (method === 'POST' && path === '/orders/lookup') { // 查詢訂單：訂單編號＋下單時填的手機
      const b = parseBody(event);
      const ip = event.requestContext?.http?.sourceIp || 'unknown';
      const rec = (await get('LOOKUPFAIL', ip)) || { count: 0, until: 0 };
      if (rec.until > Date.now()) throw new HttpError(429, '查詢太多次，請 15 分鐘後再試，或直接用 LINE 問我們');
      const digits = (v) => String(v ?? '').replace(/\D/g, '');
      const o = await get('ORDER', str(b.no, 20).toUpperCase().replace(/\s/g, ''));
      if (!o || digits(o.contact?.phone).length < 8 || digits(o.contact.phone) !== digits(b.phone)) {
        const count = (rec.count || 0) + 1;
        await put({ pk: 'LOOKUPFAIL', sk: ip, count: count >= 10 ? 0 : count, until: count >= 10 ? Date.now() + 15 * 60e3 : 0 });
        throw new HttpError(404, '找不到這筆訂單，請確認訂單編號和手機號碼');
      }
      return json(200, { no: o.orderNo, t: o.token, total: o.total });
    }
    if (seg[0] === 'orders' && seg[1]) {
      const q = new URLSearchParams(event.rawQueryString || '');
      if (method === 'GET' && seg.length === 2) {
        const o = await loadOrder(seg[1], event, q.get('t'));
        return json(200, { order: publicOrder(o, await getSettings()) });
      }
      const b = parseBody(event);
      if (method === 'POST' && seg[2] === 'transfer') {
        const o = await loadOrder(seg[1], event, b.t);
        const last5 = String(b.last5 ?? '').trim();
        if (!/^\d{5}$/.test(last5)) throw bad('請填帳號末五碼（5 個數字）');
        if (o.payment?.status === 'paid' || o.status === 'cancelled') throw bad('這筆訂單不需要再回報匯款');
        const fields = { payment: { ...o.payment, last5, reportedAt: new Date().toISOString() } };
        if (o.status === 'pending') fields.status = 'reported'; // customer says the money is sent; the shop still confirms it arrived
        const n = await setOrder(o.orderNo, fields, `客人回報已匯款，末五碼 ${last5}`);
        const who = `${o.contact?.name || ''}${o.user?.name && o.user.name !== o.contact?.name ? `（LINE：${o.user.name}）` : ''}`;
        await notifyAdmins(`🏦 客人回報已轉帳\n訂單：${o.orderNo}\n客人：${who || '（未填）'}　${o.contact?.phone || ''}\n金額：$${o.total}\n帳號末五碼：${last5}\n\n請到網銀確認入帳後，在後台按「確認已收到款項」：\n${adminLink(o.orderNo)}`).catch(() => {});
        return json(200, { order: publicOrder(n, await getSettings()) });
      }
      if (method === 'POST' && seg[2] === 'pay') { // retry / switch payment
        const o = await loadOrder(seg[1], event, b.t);
        if (o.payment?.status === 'paid' || o.status === 'cancelled') throw bad('這筆訂單不需要付款');
        const settings = await getSettings();
        const m = b.method || o.payment.method;
        const viewer = await getUser(event).catch(() => null);
        if (!publicSettings(settings, isAdminOf(settings, viewer)).payments[m]) throw bad('這個付款方式目前不能用');
        const payment = { ...o.payment, method: m, deadline: m === 'transfer' ? addDays(twDate(), int(settings.transferDays, 2)) : o.payment.deadline };
        const n = await setOrder(o.orderNo, { payment }, m !== o.payment.method ? `改用 ${PAY_LABEL[m]} 付款` : '重新付款');
        return json(200, { next: await startPayment(n, b.returnBase, b.inLine) });
      }
    }
    if (method === 'GET' && path === '/me') {
      const u = await requireUser(event);
      if (u.shopAdmin) return json(200, { user: u, contact: null, orders: [], isAdmin: true });
      const [contact, orders, settings] = await Promise.all([
        get('USER', u.sub),
        queryAll({ IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': `USER#${u.sub}` }, ScanIndexForward: false }),
        getSettings(),
      ]);
      return json(200, {
        user: u,
        contact: contact ? pick(contact, ['name', 'phone', 'address']) : null,
        orders: orders.slice(0, 50).map((o) => publicOrder(o)),
        isAdmin: isAdminOf(settings, u),
      });
    }
    if (seg[0] === 'pay') {
      if (method === 'GET' && path === '/pay/linepay/confirm') return await linepayConfirm(event);
      if (method === 'GET' && path === '/pay/linepay/cancel') return await linepayCancel(event);
      if (method === 'POST' && path === '/pay/ecpay/notify') return await ecpayNotify(event);
      if (method === 'POST' && path === '/pay/ecpay/info') return await ecpayInfo(event);
      if (method === 'POST' && path === '/pay/ecpay/result') return await ecpayResult(event);
    }

    // ---- admin
    if (seg[0] === 'admin') {
      if (method === 'POST' && path === '/admin/claim') {
        const u = await requireUser(event);
        const b = parseBody(event);
        const s = await getSettings();
        if (!b.invite || b.invite !== s.adminInvite) throw new HttpError(403, '邀請碼不正確或已失效');
        if (u.shopAdmin) throw bad('邀請連結要用 LINE 帳號打開：請在手機 LINE 裡點這個連結');
        if (!u.shopAdmin && !(s.admins || []).some((a) => a.sub === u.sub)) { // a passcode session is already admin: nothing to add
          const admins = [...(s.admins || []), { sub: u.sub, name: u.name, picture: u.picture, addedAt: new Date().toISOString() }];
          await put({ ...s, pk: 'SETTINGS', sk: 'main', admins });
        }
        return json(200, { ok: true });
      }
      if (method === 'POST' && path === '/admin/bind-phone') { // 用手機號碼綁定：號碼要先被設定成「管理員手機」，每個號碼只能綁一個 LINE 帳號
        const u = await requireUser(event);
        if (u.shopAdmin) throw bad('請在 LINE 裡打開後台再綁定');
        const s = await getSettings();
        if (isAdminOf(s, u)) return json(200, { admin: true });
        const key = `${u.sub}`; const rec = (await get('BINDFAIL', key)) || { count: 0, until: 0 };
        if (rec.until > Date.now()) throw new HttpError(429, '輸入錯太多次，請 30 分鐘後再試');
        const digits = String(parseBody(event).phone ?? '').replace(/\D/g, '');
        if (OWNER_PHONE && digits === OWNER_PHONE) {
          const now0 = new Date().toISOString();
          await put({ ...s, pk: 'SETTINGS', sk: 'main', admins: [...(s.admins || []).filter((a) => a.sub !== u.sub), { sub: u.sub, name: u.name, picture: u.picture, addedAt: now0, via: 'owner-phone', owner: true }] });
          if (rec.count) await del('BINDFAIL', key);
          return json(200, { ok: true, name: u.name, owner: true });
        }
        const entry = digits.length >= 8 && (s.adminPhones || []).find((p) => p.phone === digits && !p.boundSub);
        if (!entry) {
          const count = (rec.count || 0) + 1;
          await put({ pk: 'BINDFAIL', sk: key, count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 30 * 60e3 : 0 });
          throw new HttpError(403, '這個手機號碼沒有被設定成管理員，或已經綁定過了');
        }
        const now = new Date().toISOString();
        const adminPhones = s.adminPhones.map((p) => (p === entry ? { ...p, boundSub: u.sub, boundName: u.name, boundAt: now } : p));
        await put({ ...s, pk: 'SETTINGS', sk: 'main', adminPhones, admins: [...(s.admins || []), { sub: u.sub, name: u.name, picture: u.picture, addedAt: now, via: 'phone' }] });
        if (rec.count) await del('BINDFAIL', key);
        return json(200, { ok: true, name: u.name });
      }
      if (method === 'POST' && path === '/admin/request') { // a LINE member who isn't an admin asks to become one
        const u = await requireUser(event);
        if (u.shopAdmin) return json(200, { admin: true });
        const s = await getSettings();
        if (isAdminOf(s, u)) return json(200, { admin: true });
        await put({ pk: 'ADMINREQ', sk: u.sub, name: u.name, picture: u.picture, at: new Date().toISOString() });
        return json(200, { pending: true });
      }
      if (method === 'POST' && path === '/admin/bind-line') { // 綁定：已用店家密碼登入的人，把自己的 LINE 帳號加成管理員（之後在 LINE 打開後台自動認得）
        const u = await requireUser(event);
        if (u.shopAdmin) throw bad('請在 LINE 裡打開後台再綁定');
        const s = await getSettings();
        if (!readSession(parseBody(event).adminToken, s)) throw new HttpError(403, '請先用店家密碼登入');
        if (!(s.admins || []).some((a) => a.sub === u.sub)) {
          await put({ ...s, pk: 'SETTINGS', sk: 'main', admins: [...(s.admins || []), { sub: u.sub, name: u.name, picture: u.picture, addedAt: new Date().toISOString(), via: 'passcode' }] });
        }
        return json(200, { ok: true, name: u.name });
      }
      if (method === 'POST' && path === '/admin/login') {
        const b = parseBody(event);
        const s = await getSettings();
        if (env.ALLOW_PASSCODE !== '1' || !s.adminPass) throw new HttpError(403, '後台只能用管理員的 LINE 帳號登入');
        const ip = event.requestContext?.http?.sourceIp || 'unknown';
        const rec = (await get('LOGINFAIL', ip)) || { count: 0, until: 0 };
        if (rec.until > Date.now()) throw new HttpError(429, '嘗試太多次，請 15 分鐘後再試');
        if (!checkPass(b.pass, s.adminPass)) {
          const count = (rec.count || 0) + 1;
          await put({ pk: 'LOGINFAIL', sk: ip, count: count >= 8 ? 0 : count, until: count >= 8 ? Date.now() + 15 * 60e3 : 0 });
          throw new HttpError(403, '密碼不正確');
        }
        if (rec.count) await del('LOGINFAIL', ip);
        return json(200, { token: signSession(s) });
      }
      const { settings, user: me } = await requireAdmin(event);
      if (OWNER_IDS.has(me.sub)) {
        const cur = (settings.admins || []).find((a) => a.sub === me.sub);
        if (!cur || cur.name !== me.name || cur.picture !== me.picture) {
          settings.admins = [...(settings.admins || []).filter((a) => a.sub !== me.sub), { sub: me.sub, name: me.name, picture: me.picture, addedAt: cur?.addedAt || new Date().toISOString(), owner: true, via: 'fixed' }];
          await put({ ...settings, pk: 'SETTINGS', sk: 'main' });
        }
      }
      if (method === 'GET' && path === '/admin/orders') {
        const q = new URLSearchParams(event.rawQueryString || '');
        let orders = await queryAll({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'ORDER' }, ScanIndexForward: false });
        if (q.get('status')) orders = orders.filter((o) => o.status === q.get('status'));
        return json(200, { orders: orders.map(adminOrder), statuses: STATUS, canDeleteReal: OWNER_IDS.has(me.sub) });
      }
      if (method === 'PATCH' && seg[1] === 'orders' && seg[2]) {
        const o = await get('ORDER', seg[2]);
        if (!o) throw new HttpError(404, '找不到訂單');
        const b = parseBody(event);
        const fields = {}; const notes = [];
        // money first: an unpaid order only moves to 已付款 / 製作中 / 已出貨 / 已完成 when the shop explicitly confirms the payment arrived
        const AFTER_PAY = ['paid', 'making', 'shipped', 'done'];
        if (AFTER_PAY.includes(b.status) && b.status !== o.status && o.payment?.status !== 'paid' && !b.markPaid) {
          throw bad('這筆還沒確認收款。請先到網銀確認錢已入帳，再按「確認已收到款項」。');
        }
        if (b.status && STATUS[b.status] && b.status !== o.status) {
          fields.status = b.status; notes.push(`狀態 → ${STATUS[b.status]}`);
          if (b.status === 'cancelled') await releaseDateSlot(o.date);
          if (o.status === 'cancelled') await takeDateSlot(o.date, { ...settings, maxOrdersPerDay: 0 });
        }
        if (b.markPaid && o.payment?.status !== 'paid') {
          fields.payment = { ...o.payment, status: 'paid', paidAt: new Date().toISOString(), confirmedBy: 'admin' };
          if (['pending', 'reported'].includes(fields.status || o.status)) fields.status = 'paid';
          notes.push('管理員確認已收款');
        }
        if (b.adminNote !== undefined) fields.adminNote = str(b.adminNote, 1000);
        if (b.adminMessage !== undefined) { fields.adminMessage = str(b.adminMessage, 500); notes.push('更新給客人的訊息'); }
        if (b.date && b.date !== o.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) { fields.date = b.date; notes.push(`日期 ${o.date} → ${b.date}`); await releaseDateSlot(o.date); await takeDateSlot(b.date, { ...settings, maxOrdersPerDay: 0 }); }
        const n = Object.keys(fields).length ? await setOrder(o.orderNo, fields, notes.join('；') || null) : o;
        if (fields.payment?.status === 'paid' && o.payment?.status !== 'paid') await pushTo(o.user?.sub, `您的訂單 ${o.orderNo} 已確認收到款項（付款成功）✓\n我們會依預約日期為您製作 ♡`).catch(() => {});
        const note = fields.adminMessage || o.adminMessage;
        if (fields.status === 'cancelled') await pushTo(o.user?.sub, `很抱歉，您的訂單 ${o.orderNo} 已由店家取消。${note ? `\n店家說明：${note}` : ''}\n如有任何問題，請聯絡客服：直接在這個聊天室留言即可 ♡`).catch(() => {});
        else if (fields.status && !['paid', 'reported'].includes(fields.status)) await pushTo(o.user?.sub, `您的訂單 ${o.orderNo} 狀態更新：${STATUS[fields.status]}${note ? `\n${note}` : ''}`).catch(() => {});
        return json(200, { order: adminOrder(n) });
      }
      if (method === 'DELETE' && seg[1] === 'orders' && seg[2]) {
        // 店家測試單：管理員可以刪。客人的真實訂單：只有最大管理員（OWNER_LINE_IDS）能刪，而且要已取消、從沒付過款
        const o = await get('ORDER', seg[2]);
        if (!o) throw new HttpError(404, '找不到訂單');
        if (!o.byShop) {
          if (!OWNER_IDS.has(me.sub)) throw new HttpError(403, '客人的訂單只有最大管理員可以刪除；請改成「已取消」');
          if (o.status !== 'cancelled') throw bad('要先把訂單改成「已取消」才能刪除');
          if (o.payment?.status === 'paid') throw bad('這筆訂單收過款，不能刪除（保留付款紀錄）');
        }
        if (o.status !== 'cancelled') await releaseDateSlot(o.date);
        await del('ORDER', o.orderNo);
        return json(200, { ok: true });
      }
      if (method === 'GET' && path === '/admin/inquiries') {
        const all = await queryAll({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'INQUIRY' }, ScanIndexForward: false, ConsistentRead: true }); // a request sent seconds ago must be there when the owner taps the LINE alert
        return json(200, { inquiries: all.slice(0, 300).map(inqView), statuses: INQ_STATUS });
      }
      if (seg[1] === 'inquiries' && seg[2] && ['PATCH', 'DELETE'].includes(method)) {
        const q = await get('INQUIRY', seg[2]);
        if (!q) throw new HttpError(404, '找不到這筆客製詢問');
        if (method === 'DELETE') { for (const u of q.photos || []) { const id = String(u).split('/img/')[1]; if (id) await del('IMG', id); } await del('INQUIRY', q.no); return json(200, { ok: true }); }
        const b = parseBody(event); const at = new Date().toISOString();
        if (b.status !== undefined) {
          if (!INQ_STATUS[b.status]) throw bad('狀態不正確');
          if (b.status !== q.status) { q.history = [...(q.history || []), { at, note: `${INQ_STATUS[q.status]} → ${INQ_STATUS[b.status]}（${me.name || '店家'}）` }]; q.status = b.status; }
        }
        if (b.adminNote !== undefined) q.adminNote = str(b.adminNote, 1000);
        if (b.quote !== undefined) q.quote = Math.max(0, int(b.quote));
        q.updatedAt = at; await put(q);
        return json(200, { inquiry: inqView(q) });
      }
      if (method === 'GET' && path === '/admin/requests') {
        const reqs = await queryAll({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'ADMINREQ' } });
        return json(200, { requests: reqs.map((r) => ({ sub: r.sk, name: r.name, picture: r.picture, at: r.at })) });
      }
      if (method === 'POST' && seg[1] === 'requests' && seg[2] && ['approve', 'reject'].includes(seg[3])) {
        const r = await get('ADMINREQ', seg[2]);
        if (!r) throw new HttpError(404, '找不到這個申請');
        if (seg[3] === 'approve' && !(settings.admins || []).some((a) => a.sub === r.sk)) {
          await put({ ...settings, pk: 'SETTINGS', sk: 'main', admins: [...(settings.admins || []), { sub: r.sk, name: r.name, picture: r.picture, addedAt: new Date().toISOString(), via: 'request' }] });
        }
        await del('ADMINREQ', r.sk);
        return json(200, { ok: true });
      }
      if (method === 'GET' && path === '/admin/products') return json(200, { products: await listProducts() });
      if (method === 'PUT' && seg[1] === 'products' && seg[2]) {
        const b = parseBody(event);
        const id = seg[2].replace(/[^a-z0-9-]/gi, '').slice(0, 40);
        if (!id) throw bad('商品代號不正確');
        const old = (await get('PRODUCT', id)) || {};
        const p = { ...old, ...pick(b, PRODUCT_FIELDS), pk: 'PRODUCT', sk: id, id };
        if (!['canele', 'meringue', 'cookie'].includes(p.category)) throw bad('分類不正確');
        if (p.category === 'cookie') {
          if (!(settings.cookie?.series || []).some((x) => x.id === p.series)) throw bad('請選擇這片餅乾屬於哪個系列');
          p.textLabel = str(p.textLabel, 30) || undefined; p.textMax = p.textLabel ? Math.min(40, Math.max(1, int(p.textMax, 12))) : undefined;
          p.textOptional = p.textLabel ? !!p.textOptional : undefined; // 選填：客人可以不填（不填就照圖上的字）
          p.unit = str(p.unit, 4) || '片';
        } else { delete p.series; delete p.textLabel; delete p.textMax; delete p.textOptional; }
        p.name = str(p.name, 40); if (!p.name) throw bad('請填商品名稱');
        p.price = int(p.price); if (!(p.price > 0)) throw bad('請填價格');
        p.active = !!p.active; p.soldOut = !!p.soldOut; p.sort = int(p.sort, 999);
        p.updatedAt = new Date().toISOString();
        await put(p);
        return json(200, { product: pick(p, PRODUCT_FIELDS) });
      }
      if (method === 'DELETE' && seg[1] === 'products' && seg[2]) { await del('PRODUCT', seg[2]); return json(200, { ok: true }); }
      if (method === 'POST' && path === '/admin/images') return json(200, { url: await putImage(parseBody(event)) });
      if (method === 'GET' && path === '/admin/settings') {
        return json(200, { settings: adminView(settings), ready: { linepay: linepayReady(), ecpay: ecpayReady(), linepayEnv: env.LINEPAY_ENV || 'sandbox', ecpayEnv: env.ECPAY_ENV || 'stage', messaging: !!env.LINE_MESSAGING_TOKEN } });
      }
      if (method === 'PUT' && path === '/admin/settings') {
        const b = parseBody(event);
        const keys = ['leadDays', 'maxDays', 'maxOrdersPerDay', 'closedWeekdays', 'blockedDates', 'dateLabel', 'dateNote', 'shipping', 'freeShippingOver', 'payments', 'bank', 'transferDays', 'canele', 'notice', 'testMode', 'pauseOrders', 'cookie'];
        const next = { ...settings, ...pick(b, keys), pk: 'SETTINGS', sk: 'main' };
        if (b.shipping) {
          const f = b.shipping.frozen || {}; const a = b.shipping.ambient || {};
          const tiers = (Array.isArray(f.tiers) ? f.tiers : []).map((t) => ({ upTo: int(t.upTo), fee: Math.max(0, int(t.fee)) })).filter((t) => t.upTo > 0).sort((x, y) => x.upTo - y.upTo);
          if (!tiers.length) throw bad('冷凍運費至少要有一個級距');
          next.shipping = {
            frozen: { label: str(f.label, 30) || DEFAULT_SETTINGS.shipping.frozen.label, tiers, maxPerParcel: Math.max(1, int(f.maxPerParcel) || tiers[tiers.length - 1].upTo) },
            ambient: { label: str(a.label, 30) || DEFAULT_SETTINGS.shipping.ambient.label, fee: Math.max(0, int(a.fee)) },
          };
        }
        if (b.cookie) {
          const c = b.cookie; const cs = c.shipping || settings.cookie.shipping;
          const tiers = (Array.isArray(cs.tiers) ? cs.tiers : []).map((t) => ({ upTo: int(t.upTo), fee: Math.max(0, int(t.fee)) })).filter((t) => t.upTo > 0).sort((x, y) => x.upTo - y.upTo);
          if (!tiers.length) throw bad('餅乾運費至少要有一個級距');
          const ids = new Set();
          const series = (Array.isArray(c.series) ? c.series : settings.cookie.series).slice(0, 40).map((x, i) => ({
            id: str(x.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, ''), name: str(x.name, 30),
            lines: (Array.isArray(x.lines) ? x.lines : []).map((l) => str(l, 40)).filter(Boolean).slice(0, 3),
            photo: str(x.photo, 300), groups: (Array.isArray(x.groups) ? x.groups : []).filter((g) => ['character', 'birthday'].includes(g)),
            active: !!x.active, sort: int(x.sort, (i + 1) * 10),
          }));
          for (const x of series) { if (!x.id || !x.name) throw bad('每個系列都要有名稱'); if (ids.has(x.id)) throw bad('系列代號重複'); ids.add(x.id); }
          next.cookie = { minPieces: Math.min(200, Math.max(1, int(c.minPieces ?? settings.cookie.minPieces, 1))), shipping: { label: str(cs.label, 30) || DEFAULT_SETTINGS.cookie.shipping.label, tiers }, series };
        }
        let token;
        if (b.newAdminPass !== undefined && env.ALLOW_PASSCODE !== '1') throw bad('後台只能用 LINE 帳號登入，沒有店家密碼');
        if (b.newAdminPass !== undefined) { // set / change the 店家密碼: every older session stops working
          const np = String(b.newAdminPass);
          if (np.length < 6 || np.length > 40) throw bad('店家密碼要 6 個字以上');
          next.adminPass = hashPass(np); next.passVersion = (settings.passVersion || 1) + 1;
          if (!next.sessionSecret) next.sessionSecret = rand(32);
          token = signSession(next);
        }
        if (Array.isArray(b.addAdminPhones)) {
          const list = [...(settings.adminPhones || [])];
          for (const x of b.addAdminPhones) {
            const d = String(x.phone ?? '').replace(/\D/g, '');
            if (d.length < 8 || d.length > 15) throw bad('手機號碼格式不正確');
            if (!list.some((p) => p.phone === d)) list.push({ phone: d, label: str(x.label, 20), addedAt: new Date().toISOString() });
          }
          next.adminPhones = list;
        }
        if (Array.isArray(b.addAdminPhones) && b.addAdminPhones.some((x) => String(x.phone ?? '').replace(/\D/g, '') === OWNER_PHONE)) next.adminPhones = (next.adminPhones || []).filter((p) => p.phone !== OWNER_PHONE);
        if (Array.isArray(b.removeAdminPhones)) next.adminPhones = (next.adminPhones || settings.adminPhones || []).filter((p) => !b.removeAdminPhones.includes(p.phone));
        if (b.rotateInvite) next.adminInvite = randAlnum(10);
        if (Array.isArray(b.removeAdmins)) {
          if (b.removeAdmins.some((id) => OWNER_IDS.has(id))) throw new HttpError(403, '最大管理員是固定的，不能移除');
          const owner = isOwnerOf(settings, me);
          if (!owner && (next.admins || []).some((a) => a.owner && b.removeAdmins.includes(a.sub))) throw new HttpError(403, '負責人只能由負責人自己移除');
          next.admins = (next.admins || []).filter((a) => !b.removeAdmins.includes(a.sub));
        }
        await put(next);
        return json(200, { settings: adminView(next), token });
      }
    }
    if (method === 'GET' && path === '/') return json(200, { ok: true, service: 'ntcookie-api' });
    return json(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: '系統忙碌中，請稍後再試' });
  }
}
