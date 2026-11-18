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
const put = (item) => ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
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
      shipping: { frozen: { ...DEFAULT_SETTINGS.shipping.frozen, ...(s.shipping?.frozen || {}) }, ambient: { ...DEFAULT_SETTINGS.shipping.ambient, ...(s.shipping?.ambient || {}) } },
    };
  }
  const fresh = { pk: 'SETTINGS', sk: 'main', ...DEFAULT_SETTINGS, adminInvite: randAlnum(10) };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: fresh, ConditionExpression: 'attribute_not_exists(pk)' })).catch(() => {});
  return (await get('SETTINGS', 'main')) || fresh;
}

const linepayReady = () => !!(env.LINEPAY_CHANNEL_ID && env.LINEPAY_CHANNEL_SECRET);
const ecpayReady = () => !!(env.ECPAY_MERCHANT_ID && env.ECPAY_HASH_KEY && env.ECPAY_HASH_IV);

const isAdminOf = (s, u) => !!(u && (u.shopAdmin || (s.admins || []).some((a) => a.sub === u.sub)));
function publicSettings(s, admin = false) {
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
  };
}

const PRODUCT_FIELDS = ['id', 'category', 'name', 'price', 'unit', 'photo', 'card', 'cardName', 'cardPrice', 'cardKind', 'icon', 'desc', 'active', 'soldOut', 'sort'];
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
const adminView = (s) => ({ ...s, pk: undefined, sk: undefined, adminPass: undefined, sessionSecret: undefined, hasAdminPass: !!s.adminPass });

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
    if (readSession(tok, await getSettings())) return SHOP_ADMIN;
    throw new HttpError(401, '登入已過期，請重新輸入店家密碼');
  }
  const hit = tokenCache.get(tok);
  if (hit && hit.exp * 1000 > Date.now()) return hit.user;
  if (!env.LINE_LOGIN_CHANNEL_ID) return null;
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
const TEMP = { canele: 'frozen', meringue: 'ambient' };
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
  if (jars) parts.push({ kind: 'ambient', label: sh.ambient.label, units: jars, parcels: 1, fee: int(sh.ambient.fee) });
  const freeOver = int(settings.freeShippingOver);
  if (freeOver > 0 && subtotal >= freeOver) parts.forEach((p) => { p.fee = 0; });
  return { label: parts.map((p) => p.label + (p.parcels > 1 ? `（${p.parcels} 件）` : '')).join('＋'), fee: parts.reduce((a, p) => a + p.fee, 0), parts };
}
function priceOrder(reqItems, products, settings) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const usable = (p) => p && p.active && !p.soldOut;
  if (!Array.isArray(reqItems) || !reqItems.length) throw bad('購物車是空的');
  if (reqItems.length > 40) throw bad('品項太多');
  const lines = [];
  for (const it of reqItems) {
    const qty = int(it.qty);
    if (!(qty >= 1 && qty <= 200)) throw bad('數量不正確');
    if (it.type === 'product') {
      const p = byId.get(it.productId);
      if (!usable(p)) throw bad(`「${p?.name || '商品'}」目前無法訂購，請從購物車移除`);
      if (p.category === 'canele') {
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
  pending: '待付款', paid: '已付款', making: '製作中', shipped: '已出貨', done: '已完成', cancelled: '已取消',
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
const adminOrder = (o) => ({ ...publicOrder(o), token: o.token, user: o.user, payment: o.payment, adminNote: o.adminNote || '', adminMessage: o.adminMessage || '', history: o.history || [] });

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
  const status = o.status === 'pending' ? 'paid' : o.status;
  const n = await setOrder(o.orderNo, { payment, status }, note);
  await notifyAdmins(`💰 已付款 ${o.orderNo}｜$${o.total}｜${PAY_LABEL[payment.method] || ''}｜${o.contact?.name || ''}`).catch(() => {});
  await pushTo(o.user?.sub, `您的訂單 ${o.orderNo} 已付款成功，我們會依預約日期為您製作 ♡`).catch(() => {});
  return n;
}

// optional: LINE Messaging API push (only when the OA has Messaging API enabled and a token is set)
async function pushTo(to, message) {
  if (!env.LINE_MESSAGING_TOKEN || !to) return;
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_MESSAGING_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: message.slice(0, 4900) }] }),
  });
}
async function notifyAdmins(message) {
  if (!env.LINE_MESSAGING_TOKEN) return;
  const s = await getSettings();
  await Promise.all((s.admins || []).map((a) => pushTo(a.sub, message)));
}

function orderSummaryText(o) {
  const items = o.lines.map((l) => `・${l.name} ×${l.qty}${l.detail && l.type === 'canele-assorted' ? `（${l.detail}）` : ''}`).join('\n');
  return `🧾 新訂單 ${o.orderNo}\n${items}\n合計 $${o.total}（含運 $${o.shipping.fee}）\n${o.date}｜${o.contact.name} ${o.contact.phone}\n付款：${PAY_LABEL[o.payment.method]}${o.note ? `\n備註：${o.note}` : ''}`;
}

async function createOrder(event) {
  const b = parseBody(event);
  const viewer = await getUser(event).catch(() => null);
  const user = viewer && !viewer.shopAdmin ? viewer : null; // the LINE member this order belongs to (none for guests / 店家密碼)
  const [settings, products] = await Promise.all([getSettings(), listProducts()]);
  const priced = priceOrder(b.items, products, settings);
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
    user: user ? { sub: user.sub, name: user.name, picture: user.picture } : undefined,
    gsi1pk: user ? `USER#${user.sub}` : undefined, gsi1sk: user ? now : undefined,
    history: [{ at: now, note: `建立訂單（${PAY_LABEL[method]}）` }],
  };
  await put(o);
  if (user) await put({ pk: 'USER', sk: user.sub, ...contact, lineName: user.name, picture: user.picture, updatedAt: now });
  await notifyAdmins(orderSummaryText(o)).catch(() => {});
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

// ---------------------------------------------------------------- router
export async function handler(event) {
  const res = await route(event);
  try {
    const h = event.headers || {}; const ua = h['user-agent'] || '';
    console.log(JSON.stringify({ m: event.requestContext?.http?.method, p: (event.rawPath || '').replace(/NT\d+/, 'NT…').replace(/\/img\/.+/, '/img/…'), s: res.statusCode,
      auth: h['x-dev-key'] ? 'dev' : /^Bearer adm\./i.test(h.authorization || '') ? 'pass' : h.authorization ? 'line' : 'none',
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
    if (method === 'GET' && path === '/catalog') {
      const [settings, products, viewer] = await Promise.all([getSettings(), listProducts(), getUser(event).catch(() => null)]);
      return json(200, {
        products: products.filter((p) => p.active),
        settings: publicSettings(settings, isAdminOf(settings, viewer)),
        fullDates: await fullDates(settings),
      }, { 'cache-control': 'no-cache' });
    }
    if (method === 'GET' && seg[0] === 'img' && seg[1]) return getImage(seg[1]);
    if (method === 'POST' && path === '/orders') return await createOrder(event);
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
        const n = await setOrder(o.orderNo, { payment: { ...o.payment, last5, reportedAt: new Date().toISOString() } }, `客人回報轉帳末五碼 ${last5}`);
        await notifyAdmins(`🏦 ${o.orderNo} 回報已轉帳 $${o.total}，末五碼 ${last5}`).catch(() => {});
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
        if (!u.shopAdmin && !(s.admins || []).some((a) => a.sub === u.sub)) { // a passcode session is already admin: nothing to add
          const admins = [...(s.admins || []), { sub: u.sub, name: u.name, picture: u.picture, addedAt: new Date().toISOString() }];
          await put({ ...s, pk: 'SETTINGS', sk: 'main', admins });
        }
        return json(200, { ok: true });
      }
      if (method === 'POST' && path === '/admin/login') {
        const b = parseBody(event);
        const s = await getSettings();
        if (!s.adminPass) throw new HttpError(403, '還沒設定店家密碼');
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
      const { settings } = await requireAdmin(event);
      if (method === 'GET' && path === '/admin/orders') {
        const q = new URLSearchParams(event.rawQueryString || '');
        let orders = await queryAll({ KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'ORDER' }, ScanIndexForward: false });
        if (q.get('status')) orders = orders.filter((o) => o.status === q.get('status'));
        return json(200, { orders: orders.map(adminOrder), statuses: STATUS });
      }
      if (method === 'PATCH' && seg[1] === 'orders' && seg[2]) {
        const o = await get('ORDER', seg[2]);
        if (!o) throw new HttpError(404, '找不到訂單');
        const b = parseBody(event);
        const fields = {}; const notes = [];
        if (b.status && STATUS[b.status] && b.status !== o.status) {
          fields.status = b.status; notes.push(`狀態 → ${STATUS[b.status]}`);
          if (b.status === 'cancelled') await releaseDateSlot(o.date);
          if (o.status === 'cancelled') await takeDateSlot(o.date, { ...settings, maxOrdersPerDay: 0 });
        }
        if ((b.markPaid || b.status === 'paid') && o.payment?.status !== 'paid') {
          fields.payment = { ...o.payment, status: 'paid', paidAt: new Date().toISOString(), confirmedBy: 'admin' };
          if ((fields.status || o.status) === 'pending') fields.status = 'paid';
          notes.push('管理員確認已收款');
        }
        if (b.adminNote !== undefined) fields.adminNote = str(b.adminNote, 1000);
        if (b.adminMessage !== undefined) { fields.adminMessage = str(b.adminMessage, 500); notes.push('更新給客人的訊息'); }
        if (b.date && b.date !== o.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) { fields.date = b.date; notes.push(`日期 ${o.date} → ${b.date}`); await releaseDateSlot(o.date); await takeDateSlot(b.date, { ...settings, maxOrdersPerDay: 0 }); }
        const n = Object.keys(fields).length ? await setOrder(o.orderNo, fields, notes.join('；') || null) : o;
        if (fields.status && fields.status !== 'paid') await pushTo(o.user?.sub, `您的訂單 ${o.orderNo} 狀態：${STATUS[fields.status]}`).catch(() => {});
        return json(200, { order: adminOrder(n) });
      }
      if (method === 'GET' && path === '/admin/products') return json(200, { products: await listProducts() });
      if (method === 'PUT' && seg[1] === 'products' && seg[2]) {
        const b = parseBody(event);
        const id = seg[2].replace(/[^a-z0-9-]/gi, '').slice(0, 40);
        if (!id) throw bad('商品代號不正確');
        const old = (await get('PRODUCT', id)) || {};
        const p = { ...old, ...pick(b, PRODUCT_FIELDS), pk: 'PRODUCT', sk: id, id };
        if (!['canele', 'meringue'].includes(p.category)) throw bad('分類不正確');
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
        const keys = ['leadDays', 'maxDays', 'maxOrdersPerDay', 'closedWeekdays', 'blockedDates', 'dateLabel', 'dateNote', 'shipping', 'freeShippingOver', 'payments', 'bank', 'transferDays', 'canele', 'notice', 'testMode', 'pauseOrders'];
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
        let token;
        if (b.newAdminPass !== undefined) { // set / change the 店家密碼: every older session stops working
          const np = String(b.newAdminPass);
          if (np.length < 6 || np.length > 40) throw bad('店家密碼要 6 個字以上');
          next.adminPass = hashPass(np); next.passVersion = (settings.passVersion || 1) + 1;
          if (!next.sessionSecret) next.sessionSecret = rand(32);
          token = signSession(next);
        }
        if (b.rotateInvite) next.adminInvite = randAlnum(10);
        if (Array.isArray(b.removeAdmins)) next.admins = (next.admins || []).filter((a) => !b.removeAdmins.includes(a.sub));
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
