// API regression for the ntcookie backend. Run against the QA stage only (it rewrites settings/products/orders).
//   node qa/api.test.mjs <apiUrl> <devKey> <adminInvite>
import crypto from 'node:crypto';
const [API, DEVKEY, INVITE] = process.argv.slice(2);
if (!/-qa|localhost|wvlfrj/.test(API) && !process.env.FORCE) { console.error('refusing: not a QA api'); process.exit(2); }
const EK = 'pwFHCqoQZGmho4w6', EI = 'EkRm7iFT261dpevs';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, got) => { if (cond) { pass++; } else { fail++; fails.push(name + (got !== undefined ? ' → ' + JSON.stringify(got).slice(0, 260) : '')); console.log('  ✗', name, got !== undefined ? JSON.stringify(got).slice(0, 260) : ''); } };
const section = (t) => console.log('\n# ' + t);
const call = async (path, { method = 'GET', body, user, raw, headers = {}, form } = {}) => {
  const h = { ...headers };
  if (user) { h['x-dev-key'] = DEVKEY; h['x-dev-user'] = encodeURIComponent(user); }
  let b;
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(form).toString(); }
  else if (raw !== undefined) { h['content-type'] = 'application/json'; b = raw; }
  else if (body !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(API + path, { method, headers: h, body: b, redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
};
const tw = () => new Date(Date.now() + 8 * 3600e3);
const ymd = (n = 0) => { const d = tw(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/'/g, '%27').replace(/~/g, '%7e').toLowerCase();
const mac = (p) => { const keys = Object.keys(p).filter((k) => k !== 'CheckMacValue').sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)); return crypto.createHash('sha256').update(enc(`HashKey=${EK}&` + keys.map((k) => `${k}=${p[k]}`).join('&') + `&HashIV=${EI}`)).digest('hex').toUpperCase(); };
const ADMIN = 'Uqa-admin|QA店長', ALICE = 'Uqa-alice|Alice', BOB = 'Uqa-bob|Bob';
const contact = { name: '測試 王小明', phone: '0912-345-678', address: '台北市信義區市府路 1 號' };
const order = (over = {}, user) => call('/orders', { method: 'POST', user, body: { items: [{ type: 'product', productId: 'meringue-butter', qty: 1 }], date: ymd(10), shippingId: 'home', contact, note: '', payment: 'transfer', ...over } });
const putSettings = (b) => call('/admin/settings', { method: 'PUT', user: ADMIN, body: b });
const BASE = { leadDays: 5, maxDays: 60, maxOrdersPerDay: 0, closedWeekdays: [], blockedDates: [], freeShippingOver: 0, pauseOrders: false, testMode: false, transferDays: 2, notice: '',
  dateNote: 'QA', shipping: { frozen: { label: '黑貓冷凍宅配', tiers: [{ upTo: 1, fee: 175 }, { upTo: 4, fee: 250 }, { upTo: 9, fee: 290 }], maxPerParcel: 9 }, ambient: { label: '黑貓常溫宅配', tiers: [{ upTo: 3, fee: 130 }, { upTo: 999, fee: 170 }] } }, payments: { linepay: true, ecpay: true, transfer: true }, bank: { name: 'QA銀行', code: '999', account: '111122223333', holder: 'QA' },
  canele: { assortedPrice: 800, singleMinBoxes: 1, modes: [{ id: '3x2', flavors: 3, each: 2, minBoxes: 3 }, { id: '6x1', flavors: 6, each: 1, minBoxes: 6 }] } };

section('auth & admin bootstrap');
let r = await call('/catalog'); ok('catalog 200', r.status === 200 && r.json.products.length === 13, r.json?.products?.length);
r = await call('/admin/orders'); ok('admin without auth → 401', r.status === 401, r.status);
r = await call('/admin/orders', { user: BOB }); ok('admin as non-admin → 403', r.status === 403, r.status);
r = await call('/admin/claim', { method: 'POST', user: BOB, body: { invite: 'WRONG' } }); ok('claim with wrong invite → 403', r.status === 403, r.status);
r = await call('/admin/claim', { method: 'POST', body: { invite: INVITE } }); ok('claim without login → 401', r.status === 401, r.status);
r = await call('/admin/claim', { method: 'POST', user: ADMIN, body: { invite: INVITE } }); ok('claim with invite → ok', r.status === 200, r.text);
r = await call('/admin/claim', { method: 'POST', user: ADMIN, body: { invite: INVITE } }); r = await call('/admin/settings', { user: ADMIN });
ok('claiming twice does not duplicate admin', r.json.settings.admins.filter((a) => a.sub === 'Uqa-admin').length === 1, r.json.settings.admins);
r = await putSettings(BASE); ok('settings saved', r.status === 200 && r.json.settings.bank.account === '111122223333', r.text);
r = await call('/me'); ok('/me without auth → 401', r.status === 401, r.status);
r = await call('/nope'); ok('unknown path → 404', r.status === 404, r.status);
r = await call('/orders', { method: 'POST', raw: '{bad json' }); ok('malformed JSON → 400', r.status === 400, r.status);
r = await call('/catalog', { headers: { 'x-dev-key': 'wrong', 'x-dev-user': encodeURIComponent(ADMIN) } }); ok('wrong dev key is not an admin', r.json.settings.pauseOrders === false && r.status === 200, r.status);
r = await call('/admin/orders', { headers: { 'x-dev-key': 'wrong', 'x-dev-user': encodeURIComponent(ADMIN) } }); ok('wrong dev key cannot reach admin', r.status === 401, r.status);

section('catalog settings shape');
r = await call('/catalog');
ok('payments: ecpay+transfer on, linepay off (no merchant yet)', r.json.settings.payments.ecpay && r.json.settings.payments.transfer && !r.json.settings.payments.linepay, r.json.settings.payments);
ok('catalog does not leak admin data', !('admins' in r.json.settings) && !('adminInvite' in r.json.settings) && !('bank' in r.json.settings), Object.keys(r.json.settings));
ok('today is Taiwan date', r.json.settings.today === ymd(0), r.json.settings.today);

section('order validation');
const bad = async (name, over, re) => { const x = await order(over); ok(name, x.status === 400 && (!re || re.test(x.json?.error || '')), [x.status, x.json?.error]); };
await bad('empty cart', { items: [] }, /空/);
await bad('items not array', { items: 'x' }, /空/);
await bad('qty 0', { items: [{ type: 'product', productId: 'meringue-butter', qty: 0 }] }, /數量/);
await bad('qty negative', { items: [{ type: 'product', productId: 'meringue-butter', qty: -3 }] }, /數量/);
await bad('qty 201', { items: [{ type: 'product', productId: 'meringue-butter', qty: 201 }] }, /數量/);
await bad('qty text', { items: [{ type: 'product', productId: 'meringue-butter', qty: 'abc' }] }, /數量/);
await bad('unknown product', { items: [{ type: 'product', productId: 'nope', qty: 1 }] }, /無法訂購/);
await bad('unknown item type', { items: [{ type: 'gift', qty: 1 }] }, /不正確/);
await bad('41 lines', { items: Array.from({ length: 41 }, () => ({ type: 'product', productId: 'meringue-butter', qty: 1 })) }, /太多/);
const A3 = ['canele-original', 'canele-matcha', 'canele-thai-tea'];
await bad('assorted: unknown mode', { items: [{ type: 'canele-assorted', mode: '9x9', flavors: A3, qty: 3 }] }, /組合/);
await bad('assorted: 2 flavours for 3x2', { items: [{ type: 'canele-assorted', mode: '3x2', flavors: A3.slice(0, 2), qty: 3 }] }, /3 種/);
await bad('assorted: duplicate flavours', { items: [{ type: 'canele-assorted', mode: '3x2', flavors: ['canele-original', 'canele-original', 'canele-matcha'], qty: 3 }] }, /3 種/);
await bad('assorted: meringue as a flavour', { items: [{ type: 'canele-assorted', mode: '3x2', flavors: ['canele-original', 'canele-matcha', 'meringue-butter'], qty: 3 }] }, /無法訂購/);
await bad('assorted 3x2: 2 boxes', { items: [{ type: 'canele-assorted', mode: '3x2', flavors: A3, qty: 2 }] }, /3 盒起訂/);
await bad('assorted 6x1: 5 boxes', { items: [{ type: 'canele-assorted', mode: '6x1', flavors: [...A3, 'canele-mixed-berries', 'canele-honey-pistachio', 'canele-salted-caramel'], qty: 5 }] }, /6 盒起訂/);
await bad('date missing', { date: '' }, /日期/);
await bad('date bad format', { date: '2026/12/01' }, /日期/);
await bad('date too early (lead 5)', { date: ymd(4) }, /最早/);
await bad('date in the past', { date: ymd(-1) }, /最早/);
await bad('date too far', { date: ymd(61) }, /太遠/);
await bad('no name', { contact: { ...contact, name: ' ' } }, /姓名/);
await bad('bad phone', { contact: { ...contact, phone: 'abc' } }, /手機/);
await bad('no address', { contact: { ...contact, address: '' } }, /地址/);
await bad('no contact at all', { contact: undefined }, /姓名/);
await bad('unknown payment', { payment: 'cash' }, /付款方式/);
await bad('linepay not configured', { payment: 'linepay' }, /付款方式/);
r = await order({ date: ymd(5) }); ok('date = today+lead accepted', r.status === 200, r.json);
r = await order({ date: ymd(60) }); ok('date = today+max accepted', r.status === 200, r.json);

section('pricing (server decides the money)');
r = await order({ items: [{ type: 'product', productId: 'meringue-butter', qty: 2, price: 1, subtotal: 1 }, { type: 'product', productId: 'canele-original', qty: 1 }, { type: 'canele-assorted', mode: '3x2', flavors: A3, qty: 3 }], total: 1 });
ok('total = 390×2 + 750 + 800×3 + 冷凍 4 盒 250 + 常溫 2 罐 130 = 4310 (client prices ignored)', r.json?.total === 4310, r.json);
const O1 = r.json;
ok('order number format', /^NT\d{6}\d{3,}$/.test(O1.orderNo) && O1.token.length >= 20, O1.orderNo);
await putSettings({ freeShippingOver: 2000 });
r = await order({ items: [{ type: 'product', productId: 'meringue-butter', qty: 5 }] }); ok('subtotal 1950 < 2000 → shipping is charged (5 罐 → 170)', r.json?.total === 2120, r.json?.total);
r = await order({ items: [{ type: 'product', productId: 'meringue-butter', qty: 6 }] }); ok('subtotal 2340 ≥ 2000 → free shipping', r.json?.total === 2340, r.json?.total);
await putSettings({ freeShippingOver: 0 });
r = await order({ shippingId: 'teleport', shipping: { fee: 0 } }); ok('customer cannot choose or zero the shipping fee (390 + 1 罐 130)', r.json?.total === 520, r.json?.total);
section('可麗露冷凍運費（1 盒 175／2–4 盒 250／5–9 盒 290／一件最多 9 盒）');
for (const [n, fee] of [[1, 175], [2, 250], [4, 250], [5, 290], [9, 290], [10, 465], [13, 540], [18, 580], [19, 755]]) {
  r = await order({ items: [{ type: 'product', productId: 'canele-original', qty: n }] }); ok(`${n} 盒 → 運費 ${fee}`, r.json?.total === 750 * n + fee, [n, r.json?.total - 750 * n]);
}
r = await order({ items: [{ type: 'canele-assorted', mode: '3x2', flavors: ['canele-original', 'canele-matcha', 'canele-thai-tea'], qty: 3 }, { type: 'product', productId: 'canele-matcha', qty: 2 }] });
ok('綜合 3 盒 + 單一 2 盒 = 5 盒 → 290', r.json?.total === 2400 + 1580 + 290, r.json?.total);
r = await order({ items: [{ type: 'product', productId: 'meringue-butter', qty: 3 }] }); ok('馬林糖 3 罐 → 小箱 130', r.json?.total === 1170 + 130, r.json?.total);
r = await order({ items: [{ type: 'product', productId: 'meringue-butter', qty: 4 }] }); ok('馬林糖 4 罐 → 超過一個尺寸，170', r.json?.total === 1560 + 170, r.json?.total);
await putSettings({ freeShippingOver: 3000 });
r = await order({ items: [{ type: 'product', productId: 'canele-original', qty: 4 }, { type: 'product', productId: 'meringue-butter', qty: 1 }] }); ok('free-shipping threshold zeroes both parcels', r.json?.total === 3390, r.json?.total);
await putSettings({ freeShippingOver: 0 });
r = await putSettings({ shipping: { frozen: { tiers: [] }, ambient: { fee: 100 } } }); ok('admin cannot save shipping with no tiers', r.status === 400, r.status);
r = await putSettings({ shipping: { frozen: { tiers: [{ upTo: 9, fee: 300 }, { upTo: 3, fee: '200' }], maxPerParcel: 0 }, ambient: { tiers: [{ upTo: 999, fee: 170 }, { upTo: '2', fee: -5 }, { upTo: 0, fee: 9 }] } } });
ok('shipping settings are cleaned up (sorted, numbers, sane limits)', JSON.stringify(r.json.settings.shipping.frozen.tiers) === '[{"upTo":3,"fee":200},{"upTo":9,"fee":300}]' && r.json.settings.shipping.frozen.maxPerParcel === 9 && JSON.stringify(r.json.settings.shipping.ambient.tiers) === '[{"upTo":2,"fee":0},{"upTo":999,"fee":170}]', r.json.settings?.shipping);
r = await putSettings({ shipping: { frozen: BASE.shipping.frozen, ambient: { fee: 99 } } });
ok('an admin page from before the jar tiers (sends one flat fee) does not wipe the tiers', JSON.stringify(r.json.settings.shipping.ambient.tiers) === '[{"upTo":2,"fee":0},{"upTo":999,"fee":170}]', r.json.settings?.shipping?.ambient);
await putSettings({ shipping: BASE.shipping });
r = await call('/catalog'); ok('customers get the jar tiers (and a flat fee for old cached pages)', JSON.stringify(r.json.settings.shipping.ambient.tiers) === '[{"upTo":3,"fee":130},{"upTo":999,"fee":170}]' && r.json.settings.shipping.ambient.fee === 130, r.json.settings?.shipping?.ambient);

section('購物須知 (the owner can rewrite it in the admin)');
ok('starts automatic (nothing customised)', JSON.stringify(r.json.settings.shopNotes) === '{"over":{},"off":[],"extra":[]}', r.json.settings.shopNotes);
r = await putSettings({ shopNotes: { over: { meringue: ' 小箱 130、大箱 170 \r\n第二行 ', hacker: 'x', pay: '' }, off: ['custom', 'nope'], extra: [{ title: ' 保存方式 ', text: '常溫 14 天' }, { title: '', text: '' }, ...Array.from({ length: 12 }, (_, i) => ({ title: 't' + i, text: 'x'.repeat(900) }))] } });
{ const sn = r.json?.settings?.shopNotes || {};
  ok('cleaned up (known topics only, trimmed, line breaks kept, empty rows dropped, at most 10, 400 chars each)', JSON.stringify(sn.over) === '{"meringue":"小箱 130、大箱 170 \\n第二行"}' && JSON.stringify(sn.off) === '["custom"]' && sn.extra?.length === 10 && sn.extra[0].title === '保存方式' && sn.extra[1].text.length === 400, sn); }
r = await call('/catalog'); ok('customers get the owner\'s wording', /^小箱 130/.test(r.json.settings.shopNotes.over.meringue) && r.json.settings.shopNotes.extra[0].text === '常溫 14 天' && r.json.settings.shopNotes.off[0] === 'custom', r.json.settings.shopNotes);
r = await putSettings({ notice: '' }); ok('saving other settings leaves it alone', r.json.settings.shopNotes.extra.length === 10, r.json.settings.shopNotes);
r = await putSettings({ shopNotes: {} }); ok('clearing it goes back to automatic', JSON.stringify(r.json.settings.shopNotes) === '{"over":{},"off":[],"extra":[]}', r.json.settings.shopNotes);

section('pricing, continued');
r = await order({ note: 'x'.repeat(900), contact: { ...contact, name: '名'.repeat(80) } });
let g = await call(`/orders/${r.json.orderNo}?t=${r.json.token}`); ok('long note/name are capped', g.json.order.note.length === 500 && g.json.order.contact.name.length === 40, [g.json.order.note.length, g.json.order.contact.name.length]);

section('order privacy');
g = await call(`/orders/${O1.orderNo}`); ok('no token → 403', g.status === 403, g.status);
g = await call(`/orders/${O1.orderNo}?t=wrong`); ok('wrong token → 403', g.status === 403, g.status);
g = await call(`/orders/NT000000999?t=${O1.token}`); ok('unknown order → 404', g.status === 404, g.status);
g = await call(`/orders/${O1.orderNo}?t=${O1.token}`); ok('token → 200', g.status === 200 && g.json.order.total === 4310, g.status);
ok('order records both parcels (冷凍 250＋常溫 2 罐 130)', g.json.order.shipping.fee === 380 && g.json.order.shipping.parts.length === 2 && /冷凍/.test(g.json.order.shipping.label) && /常溫/.test(g.json.order.shipping.label), g.json.order.shipping);
ok('customer view hides token/adminNote/history/user', !('token' in g.json.order) && !('adminNote' in g.json.order) && !('history' in g.json.order) && !('user' in g.json.order), Object.keys(g.json.order));
ok('transfer order shows the bank account + deadline', g.json.order.bank?.account === '111122223333' && g.json.order.payment.deadline === ymd(2), [g.json.order.bank, g.json.order.payment]);
r = await order({}, ALICE); const OA = r.json;
g = await call(`/orders/${OA.orderNo}`, { user: ALICE }); ok('owner sees own order without token', g.status === 200, g.status);
g = await call(`/orders/${OA.orderNo}`, { user: BOB }); ok('another member → 403', g.status === 403, g.status);
g = await call(`/orders/${OA.orderNo}`, { user: ADMIN }); ok('admin sees any order', g.status === 200, g.status);
g = await call('/me', { user: ALICE }); ok('/me lists the member\'s order + remembers contact', g.json.orders.some((o) => o.orderNo === OA.orderNo) && g.json.contact?.phone === contact.phone && g.json.isAdmin === false, g.json);
g = await call('/me', { user: BOB }); ok('/me for someone else is empty', g.json.orders.length === 0 && g.json.contact === null, g.json);
g = await call('/me', { user: ADMIN }); ok('/me marks the admin', g.json.isAdmin === true, g.json.isAdmin);

section('bank transfer');
for (const v of ['1234', '123456', '12a45', '']) { r = await call(`/orders/${O1.orderNo}/transfer`, { method: 'POST', body: { t: O1.token, last5: v } }); ok(`last5 "${v}" rejected`, r.status === 400, r.status); }
r = await call(`/orders/${O1.orderNo}/transfer`, { method: 'POST', body: { t: 'wrong', last5: '12345' } }); ok('last5 with wrong token → 403', r.status === 403, r.status);
r = await call(`/orders/${O1.orderNo}/transfer`, { method: 'POST', body: { t: O1.token, last5: '54321' } }); ok('last5 saved → 已匯款（待確認）, money not yet confirmed', r.json?.order.payment.last5 === '54321' && r.json.order.payment.status === 'unpaid' && r.json.order.status === 'reported' && r.json.order.statusLabel === '已匯款（待確認）', [r.json?.order?.status, r.json?.order?.payment]);
r = await call(`/orders/${O1.orderNo}/transfer`, { method: 'POST', body: { t: O1.token, last5: '54322' } }); ok('customer can correct the digits, status stays 已匯款（待確認）', r.json?.order.payment.last5 === '54322' && r.json.order.status === 'reported', r.json?.order?.status);
r = await call('/admin/orders', { user: ADMIN }); ok('admin list shows 已匯款（待確認） as its own status', r.json.statuses.reported === '已匯款（待確認）' && r.json.orders.find((o) => o.orderNo === O1.orderNo).status === 'reported', r.json.statuses);
r = await call(`/admin/orders/${O1.orderNo}`, { method: 'PATCH', user: BOB, body: { markPaid: true } }); ok('non-admin cannot mark paid', r.status === 403, r.status);
r = await call(`/admin/orders/${O1.orderNo}`, { method: 'PATCH', user: ADMIN, body: { markPaid: true } }); ok('admin marks paid → 已付款', r.json?.order.status === 'paid' && r.json.order.payment.status === 'paid', r.json?.order?.status);
r = await call(`/orders/${O1.orderNo}/pay`, { method: 'POST', body: { t: O1.token } }); ok('paid order cannot be paid again', r.status === 400, r.status);
r = await call(`/orders/${O1.orderNo}/transfer`, { method: 'POST', body: { t: O1.token, last5: '11111' } }); ok('after 已付款 the customer cannot re-report', r.status === 400, r.status);

section('查詢訂單（訂單編號＋手機）');
r = await call('/orders/lookup', { method: 'POST', body: { no: O1.orderNo.toLowerCase(), phone: '0912 345 678' } }); ok('right number + phone (any format) → link to the order', r.json?.no === O1.orderNo && r.json.t === O1.token, r.json);
r = await call('/orders/lookup', { method: 'POST', body: { no: O1.orderNo, phone: '0912345679' } }); ok('wrong phone → not found', r.status === 404 && !r.json.t, r.status);
r = await call('/orders/lookup', { method: 'POST', body: { no: 'NT000000999', phone: '0912345678' } }); ok('unknown order → not found (same message)', r.status === 404, r.status);
r = await call('/orders/lookup', { method: 'POST', body: { no: O1.orderNo, phone: '' } }); ok('empty phone → not found', r.status === 404, r.status);

section('admin order handling');
r = await order(); const O2 = r.json;
for (const st of ['paid', 'making', 'shipped', 'done']) { r = await call(`/admin/orders/${O2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: st } }); ok(`unpaid order cannot jump to ${st} without confirming the money`, r.status === 400 && /確認收款/.test(r.json.error), [r.status, r.json?.error]); }
g = await call(`/orders/${O2.orderNo}?t=${O2.token}`); ok('…and it stays 待付款／unpaid', g.json.order.status === 'pending' && g.json.order.payment.status === 'unpaid', g.json.order.status);
r = await call(`/admin/orders/${O2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'cancelled' } }); ok('cancelling an unpaid order needs no payment', r.json?.order.status === 'cancelled', r.json?.order?.status);
r = await call(`/admin/orders/${O2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'pending' } });
r = await call(`/admin/orders/${O2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'paid', markPaid: true } });
ok('with the shop\'s confirmation → 已付款 and the payment is recorded', r.json?.order.status === 'paid' && r.json.order.payment.status === 'paid' && r.json.order.payment.confirmedBy === 'admin', [r.json?.order?.status, r.json?.order?.payment?.status]);
r = await call(`/admin/orders/${O2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'bogus' } }); ok('unknown status ignored', r.json?.order.status === 'paid', r.json?.order?.status);
r = await call(`/admin/orders/${O2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'shipped', adminMessage: '已出貨 <b>黑貓</b> 1234', adminNote: '內部備註' } });
g = await call(`/orders/${O2.orderNo}?t=${O2.token}`); ok('customer sees status + shop message, not the internal note', g.json.order.status === 'shipped' && g.json.order.adminMessage.includes('黑貓') && !JSON.stringify(g.json).includes('內部備註'), g.json.order.status);
r = await call('/admin/orders', { user: ADMIN }); ok('admin list has history + token', r.json.orders.find((o) => o.orderNo === O2.orderNo)?.history.length >= 3, r.status);
r = await call('/admin/orders/NT000000999', { method: 'PATCH', user: ADMIN, body: { status: 'done' } }); ok('PATCH unknown order → 404', r.status === 404, r.status);

section('ECPay');
r = await order({ payment: 'ecpay' }); const OE = r.json; const F = OE.next.fields;
ok('ecpay → form to the stage cashier', OE.next.type === 'form' && OE.next.action === 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', OE.next?.action);
ok('form signature is valid', mac(F) === F.CheckMacValue, F.CheckMacValue);
ok('form amount = order total, trade no ≤ 20 chars', F.TotalAmount === String(OE.total) && F.MerchantTradeNo.length <= 20 && /^[A-Za-z0-9]+$/.test(F.MerchantTradeNo), [F.TotalAmount, F.MerchantTradeNo]);
ok('callbacks point at this API', F.ReturnURL === API + '/pay/ecpay/notify' && F.PaymentInfoURL === API + '/pay/ecpay/info', F.ReturnURL);
const note = (over = {}) => { const p = { MerchantID: '3002607', MerchantTradeNo: F.MerchantTradeNo, StoreID: '', RtnCode: '1', RtnMsg: 'ok', TradeNo: '2611180000000001', TradeAmt: String(OE.total), PaymentDate: '2026/11/18 12:00:00', PaymentType: 'Credit_CreditCard', PaymentTypeChargeFee: '10', TradeDate: '2026/11/18 11:59:00', SimulatePaid: '0', CustomField1: OE.orderNo, CustomField2: '', CustomField3: '', CustomField4: '', ...over }; p.CheckMacValue = mac(p); return p; };
r = await call('/pay/ecpay/notify', { method: 'POST', form: { ...note(), CheckMacValue: 'DEADBEEF' } }); ok('bad signature → rejected', r.status === 400 && r.text.startsWith('0|'), r.text);
r = await call('/pay/ecpay/notify', { method: 'POST', form: { ...note(), TradeAmt: '1' } }); ok('amount changed after signing → rejected', r.status === 400, r.text);
r = await call('/pay/ecpay/notify', { method: 'POST', form: note({ TradeAmt: '1' }) }); g = await call(`/orders/${OE.orderNo}?t=${OE.token}`);
ok('validly signed but wrong amount → NOT paid', r.text === '1|OK' && g.json.order.payment.status === 'unpaid', g.json.order.payment.status);
r = await call('/pay/ecpay/notify', { method: 'POST', form: note({ RtnCode: '10100058', RtnMsg: 'fail' }) }); g = await call(`/orders/${OE.orderNo}?t=${OE.token}`);
ok('failed payment notice → NOT paid', g.json.order.payment.status === 'unpaid', g.json.order.payment.status);
r = await call('/pay/ecpay/info', { method: 'POST', form: note({ RtnCode: '2', PaymentType: 'ATM_LAND', BankCode: '005', vAccount: '5219532500000000', ExpireDate: '2026/11/21' }) }); g = await call(`/orders/${OE.orderNo}?t=${OE.token}`);
ok('ATM number saved for the customer', g.json.order.payment.info?.account === '5219532500000000' && g.json.order.payment.info.bankCode === '005', g.json.order.payment.info);
r = await call('/pay/ecpay/notify', { method: 'POST', form: note() }); g = await call(`/orders/${OE.orderNo}?t=${OE.token}`);
ok('valid paid notice → 已付款', r.text === '1|OK' && g.json.order.payment.status === 'paid' && g.json.order.status === 'paid', g.json.order.payment.status);
await call('/pay/ecpay/notify', { method: 'POST', form: note() }); r = await call('/admin/orders', { user: ADMIN });
ok('repeated notice does not double-record', r.json.orders.find((o) => o.orderNo === OE.orderNo).history.filter((h) => /付款成功/.test(h.note)).length === 1, 'dup');
r = await call('/pay/ecpay/notify', { method: 'POST', form: note({ CustomField1: 'NT000000999' }) }); ok('notice for unknown order acknowledged, nothing breaks', r.text === '1|OK', r.text);
r = await order({ payment: 'ecpay' }); const OE2 = r.json; const F2 = OE2.next.fields;
const res2 = { ...note({ MerchantTradeNo: F2.MerchantTradeNo, TradeAmt: String(OE2.total), CustomField1: OE2.orderNo }) };
r = await call('/pay/ecpay/result?b=' + encodeURIComponent('http://127.0.0.1:8765/cart.html'), { method: 'POST', form: res2 });
ok('browser return after card payment → back to the order page (paid)', r.status === 302 && r.headers.get('location') === `http://127.0.0.1:8765/order.html?no=${OE2.orderNo}&t=${OE2.token}&pay=ok`, r.headers.get('location'));
r = await call('/pay/ecpay/result?b=' + encodeURIComponent('https://evil.example/x.html'), { method: 'POST', form: res2 });
ok('return address cannot be pointed at another site', r.status === 302 && r.headers.get('location').startsWith('http://127.0.0.1:8765/order.html'), r.headers.get('location'));
r = await order({ payment: 'ecpay' }); const OE3 = r.json;
r = await call(`/orders/${OE3.orderNo}/pay`, { method: 'POST', body: { t: OE3.token, method: 'transfer' } }); g = await call(`/orders/${OE3.orderNo}?t=${OE3.token}`);
ok('customer can switch an unpaid order to bank transfer', r.json?.next.type === 'order' && g.json.order.payment.method === 'transfer' && !!g.json.order.bank, g.json.order.payment);
r = await call(`/orders/${OE3.orderNo}/pay`, { method: 'POST', body: { t: OE3.token, method: 'ecpay' } }); ok('…and back to ECPay with a fresh trade number', r.json?.next.type === 'form' && r.json.next.fields.MerchantTradeNo !== OE3.next.fields.MerchantTradeNo, r.json?.next?.type);
r = await call(`/orders/${OE3.orderNo}/pay`, { method: 'POST', body: { t: 'wrong' } }); ok('pay with wrong token → 403', r.status === 403, r.status);

section('products: 上架 / 下架 / 售完 / 改價');
r = await call('/admin/products', { user: ADMIN }); const P = Object.fromEntries(r.json.products.map((p) => [p.id, p]));
r = await call('/admin/products/meringue-cocoa', { method: 'PUT', user: BOB, body: { ...P['meringue-cocoa'], price: 1 } }); ok('non-admin cannot edit products', r.status === 403, r.status);
r = await call('/admin/products/meringue-cocoa', { method: 'PUT', user: ADMIN, body: { ...P['meringue-cocoa'], active: false } });
r = await call('/catalog'); ok('下架 → gone from the shop', !r.json.products.some((p) => p.id === 'meringue-cocoa') && r.json.products.length === 12, r.json.products.length);
await bad('下架 product cannot be ordered', { items: [{ type: 'product', productId: 'meringue-cocoa', qty: 1 }] }, /無法訂購/);
await call('/admin/products/meringue-cocoa', { method: 'PUT', user: ADMIN, body: { ...P['meringue-cocoa'], active: true, soldOut: true } });
r = await call('/catalog'); ok('售完 → still shown, flagged sold out', r.json.products.find((p) => p.id === 'meringue-cocoa')?.soldOut === true, 'x');
await bad('售完 product cannot be ordered', { items: [{ type: 'product', productId: 'meringue-cocoa', qty: 1 }] }, /無法訂購/);
await call('/admin/products/canele-matcha', { method: 'PUT', user: ADMIN, body: { ...P['canele-matcha'], soldOut: true } });
await bad('assorted box with a sold-out flavour rejected', { items: [{ type: 'canele-assorted', mode: '3x2', flavors: A3, qty: 3 }] }, /無法訂購/);
await call('/admin/products/canele-matcha', { method: 'PUT', user: ADMIN, body: { ...P['canele-matcha'], soldOut: false } });
await call('/admin/products/meringue-cocoa', { method: 'PUT', user: ADMIN, body: { ...P['meringue-cocoa'], active: true, soldOut: false, price: 480 } });
r = await order({ items: [{ type: 'product', productId: 'meringue-cocoa', qty: 1 }] }); ok('price change applies to new orders (480+130)', r.json?.total === 610, r.json?.total);
await call('/admin/products/meringue-cocoa', { method: 'PUT', user: ADMIN, body: P['meringue-cocoa'] });
for (const [n, b] of [['no name', { category: 'meringue', name: '', price: 100 }], ['price 0', { category: 'meringue', name: 'x', price: 0 }], ['bad category', { category: 'cake', name: 'x', price: 100 }]]) { r = await call('/admin/products/qa-new', { method: 'PUT', user: ADMIN, body: b }); ok(`new product: ${n} rejected`, r.status === 400, r.status); }
r = await call('/admin/products/qa-new', { method: 'PUT', user: ADMIN, body: { category: 'meringue', name: 'QA 新口味', price: 333, unit: '罐', active: true, sort: 99 } }); ok('new product saved', r.json?.product.id === 'qa-new', r.text);
r = await order({ items: [{ type: 'product', productId: 'qa-new', qty: 2 }] }); ok('new product can be ordered (333×2+130)', r.json?.total === 796, r.json?.total);
r = await call('/admin/products/qa-new', { method: 'DELETE', user: ADMIN }); r = await call('/catalog'); ok('deleted product is gone', r.json.products.length === 13 && !r.json.products.some((p) => p.id === 'qa-new'), r.json.products.length);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await call('/admin/images', { method: 'POST', user: BOB, body: { dataUrl: png } }); ok('non-admin cannot upload photos', r.status === 403, r.status);
r = await call('/admin/images', { method: 'POST', user: ADMIN, body: { dataUrl: 'data:text/html;base64,PGI+' } }); ok('non-image upload rejected', r.status === 400, r.status);
r = await call('/admin/images', { method: 'POST', user: ADMIN, body: { dataUrl: 'data:image/png;base64,' + 'A'.repeat(400000) } }); ok('oversized photo rejected', r.status === 400, r.status);
r = await call('/admin/images', { method: 'POST', user: ADMIN, body: { dataUrl: png } }); const img = await fetch(r.json.url);
ok('photo upload → served as an image', img.status === 200 && img.headers.get('content-type') === 'image/png' && (await img.arrayBuffer()).byteLength > 50, [r.json, img.status]);

section('造型餅乾（系列・單片・最少片數・運費級距・填字）');
{
  const order2 = async (o, u) => { const x = await order(o, u); return x.status === 200 ? { status: 200, json: (await call(`/orders/${x.json.orderNo}?t=${x.json.token}`, { user: u })).json.order } : x; };
  const CK = (slug, qty, extra = {}) => ({ type: 'product', productId: `cookie-anpanman-${slug}`, qty, ...extra });
  const COOKIE = { minPieces: 6, shipping: { label: '黑貓宅配（造型餅乾）', tiers: [{ upTo: 8, fee: 130 }, { upTo: 999, fee: 170 }] } };
  let a = await call('/admin/settings', { user: ADMIN }); const SER = a.json.settings.cookie.series;
  const AP = (await call('/admin/products', { user: ADMIN })).json.products.filter((p) => p.category === 'cookie');
  const list = async (ps, on) => { for (let i = 0; i < ps.length; i += 10) await Promise.all(ps.slice(i, i + 10).map((p) => call(`/admin/products/${p.id}`, { method: 'PUT', user: ADMIN, body: { ...p, active: on } }))); };
  ok('seeded: 10 series, 117 cookies, every cookie 未上架', SER.length === 10 && SER[0].id === 'anpanman' && AP.length === 117 && AP.every((p) => !p.active), [SER.length, AP.length]);
  r = await call('/catalog'); ok('guest catalog: no cookies while nothing is 上架', !r.json.products.some((p) => p.category === 'cookie') && r.json.settings.cookie.series.length === 0, r.json.settings.cookie);
  r = await call('/catalog', { user: ADMIN }); ok('admin catalog: gets every series and all 117 cookies (preview)', r.json.products.filter((p) => p.category === 'cookie').length === 117 && r.json.settings.cookie.series[0]?.active === false, r.json.products.length);
  await bad('guest cannot order from a hidden series', { items: [CK('anpanman', 6)] }, /無法訂購/);
  r = await order2({ items: [CK('anpanman', 6)] }, ADMIN); ok('admin can place a test order from a hidden series', r.status === 200 && r.json.orderNo, r.text);
  // a series has no switch of its own: it shows as soon as one of its cookies is 上架
  await list(AP.filter((p) => p.id === 'cookie-pokemon-pikachu'), true); r = await call('/catalog');
  ok('one cookie 上架 → customers see that series, with only that cookie', r.json.settings.cookie.series.map((x) => x.id).join() === 'pokemon' && r.json.products.filter((p) => p.category === 'cookie').map((p) => p.id).join() === 'cookie-pokemon-pikachu', r.json.settings.cookie.series.map((x) => x.id));
  r = await call('/catalog', { user: ADMIN }); ok('admin still gets every series; active says whether customers see it', r.json.settings.cookie.series.length === 10 && r.json.settings.cookie.series.find((x) => x.id === 'pokemon').active === true && r.json.settings.cookie.series.find((x) => x.id === 'anpanman').active === false, r.json.settings.cookie.series.map((x) => [x.id, x.active]));
  await bad('a 未上架 cookie in a visible series still cannot be ordered by customers', { items: [{ type: 'product', productId: 'cookie-pokemon-eevee', qty: 6 }] }, /無法訂購/);
  await list(AP.filter((p) => p.id === 'cookie-pokemon-pikachu'), false); r = await call('/catalog');
  ok('下架 the last cookie → the series disappears for customers', r.json.settings.cookie.series.length === 0 && !r.json.products.some((p) => p.category === 'cookie'), r.json.settings.cookie.series);
  await list(AP, true); r = await putSettings({ cookie: { ...COOKIE, series: SER } }); ok('owner lists every cookie (全部上架)', r.status === 200, r.text);
  r = await call('/catalog'); ok('guest catalog now shows the 117 pieces and the 10 series', r.json.products.filter((p) => p.category === 'cookie').length === 117 && r.json.settings.cookie.series.length === 10 && r.json.settings.cookie.minPieces === 6, r.json.settings.cookie);
  await bad('5 pieces → 6 片起訂', { items: [CK('anpanman', 3), CK('baikinman', 2)] }, /6 片起訂/);
  r = await order2({ items: [CK('anpanman', 3), CK('baikinman', 2), CK('dokinchan', 1)] }, ALICE);
  ok('6 pieces mixed: subtotal by piece, 6–8 片 shipping $130', r.status === 200 && r.json?.subtotal === 3 * 250 + 2 * 220 + 250 && r.json?.shipping?.fee === 130 && r.json?.shipping?.parts[0].kind === 'cookie' && r.json.total === r.json.subtotal + 130, r.text);
  r = await order2({ items: [CK('anpanman', 9)] }, ALICE); ok('9 pieces → $170 (the 9+ tier)', r.status === 200 && r.json?.shipping?.fee === 170, r.json?.shipping);
  await bad('name plaque without the name', { items: [CK('anpanman', 5), CK('name-plaque', 1)] }, /請填寫寶寶名字/);
  await bad('name text longer than allowed (16)', { items: [CK('anpanman', 5), CK('name-plaque', 1, { text: '一二三四五六七八九十一二三四五六七' })] }, /最多 16 個字/);
  r = await order2({ items: [CK('anpanman', 5), CK('name-plaque', 2, { text: '  林羽澄   115.03.23 ' })] }, ALICE);
  const pl = r.json?.lines?.find((l) => l.productId === 'cookie-anpanman-name-plaque');
  ok('name plaque keeps the text (tidied) on the order line', r.status === 200 && pl?.text === '林羽澄 115.03.23' && /寶寶名字＋日期：林羽澄 115\.03\.23/.test(pl.detail) && /麵包超人系列/.test(pl.detail), pl);
  r = await order2({ items: [CK('anpanman', 5), CK('stroller', 1)] }, ALICE);
  ok('optional text (麵包推車) can be left empty — no text on the order line', r.status === 200 && !r.json?.lines?.find((l) => l.productId === 'cookie-anpanman-stroller')?.text, r.json?.lines);
  r = await order2({ items: [CK('anpanman', 5), CK('stroller', 1, { text: 'MY HOME 520' })] }, ALICE);
  ok('optional text, when given, is kept', r.status === 200 && r.json?.lines?.find((l) => l.productId === 'cookie-anpanman-stroller')?.text === 'MY HOME 520', r.json?.lines);
  await bad('a cup with a painted name (茶杯酷洛米) needs the name', { items: [CK('anpanman', 5), { type: 'product', productId: 'cookie-sanrio-kuromi-teacup', qty: 1 }] }, /無法訂購|請填寫名字/);
  r = await order2({ items: [CK('anpanman', 6), { type: 'product', productId: 'meringue-butter', qty: 1 }] }, ALICE);
  ok('cookies + meringue ship in one (large) box: always the top cookie tier, 170', r.status === 200 && r.json?.shipping?.parts.length === 1 && r.json?.shipping?.fee === 170 && /含馬林糖/.test(r.json?.shipping?.label), r.json?.shipping);
  r = await order2({ items: [CK('anpanman', 6), { type: 'product', productId: 'canele-original', qty: 1 }] }, ALICE);
  ok('cookies + canelé: frozen and cookie parcels charged separately', r.status === 200 && r.json?.shipping?.fee === 175 + 130 && r.json?.shipping?.parts.map((x) => x.kind).join() === 'frozen,cookie', r.json?.shipping);
  r = await putSettings({ cookie: { minPieces: 1, shipping: { label: 'X', tiers: [{ upTo: 9, fee: 120 }, { upTo: 999, fee: 180 }] }, series: SER.map((x) => ({ ...x, active: true })) } });
  r = await order2({ items: [CK('rattle', 1)] }, ALICE); ok('owner changes minimum to 1 and tiers → applied', r.status === 200 && r.json?.shipping?.fee === 120, r.json?.shipping);
  r = await order2({ items: [CK('rattle', 10)] }, ALICE); ok('10 pieces → new top tier $180', r.status === 200 && r.json?.shipping?.fee === 180, r.json?.shipping);
  r = await putSettings({ cookie: { ...COOKIE, shipping: { label: 'X', tiers: [] } } }); ok('cookie shipping needs at least one tier', r.status === 400, r.status);
  r = await putSettings({ cookie: { ...COOKIE, series: [...SER, { ...SER[0] }] } }); ok('duplicate series id refused', r.status === 400, r.status);
  r = await putSettings({ cookie: { ...COOKIE, series: [...SER, { id: 'x2', name: '' }] } }); ok('series without a name refused', r.status === 400, r.status);
  r = await putSettings({ cookie: { ...COOKIE, series: [...SER.map((x) => ({ ...x, active: true })), { id: 'Bday 01!', name: '慶生系列', lines: ['a', 'b', 'c', 'd'], groups: ['birthday', 'evil'], active: true }] } });
  const nb = r.json?.settings?.cookie?.series?.find((x) => x.name === '慶生系列');
  ok('new series: id cleaned, at most 3 lines, unknown home card dropped', r.status === 200 && nb?.id === 'bday01' && nb.lines.length === 3 && nb.groups.join() === 'birthday', nb);
  r = await call('/admin/products/cookie-qa-x', { method: 'PUT', user: ADMIN, body: { category: 'cookie', series: 'nope', name: 'QA', price: 100 } }); ok('cookie piece must belong to an existing series', r.status === 400, r.text);
  r = await call('/admin/products/cookie-qa-x', { method: 'PUT', user: ADMIN, body: { category: 'cookie', series: 'bday01', name: 'QA 蛋糕', price: 300, textLabel: '名字', textMax: 99, active: true } });
  ok('new cookie piece: unit 片, text limit capped at 40', r.status === 200 && r.json.product.unit === '片' && r.json.product.textMax === 40 && r.json.product.series === 'bday01', r.json?.product);
  r = await call('/catalog'); ok('the new birthday series and its piece show for guests', r.json.settings.cookie.series.some((x) => x.id === 'bday01') && r.json.products.some((p) => p.id === 'cookie-qa-x'), r.json.settings.cookie.series.map((x) => x.id));
  await call('/admin/products/cookie-qa-x', { method: 'DELETE', user: ADMIN });
  r = await putSettings({ cookie: { ...COOKIE, series: SER } }); await list(AP, false); r = await call('/catalog');
  ok('全部下架 → cookies gone from the shop, old carts can no longer order them', !r.json.products.some((p) => p.category === 'cookie') && r.json.settings.cookie.series.length === 0, r.json.settings.cookie);
  await bad('ordering a hidden series is refused', { items: [CK('anpanman', 6)] }, /無法訂購/);
}

section('客製詢問（留言＋參考照片 → LINE 討論價格）');
{
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const INQ = { purpose: '收涎', design: '寶可夢收涎餅乾，皮卡丘 2 片、寶貝球名字牌 1 片', text: '林羽澄 115.03.23', qty: 12, date: ymd(20), name: '測試 王小明', phone: '0912-345-678', photos: [PNG, PNG] };
  const send = (b, user = ALICE) => call('/inquiries', { method: 'POST', user, body: b });
  r = await call('/inquiries', { method: 'POST', body: INQ }); ok('custom request needs a LINE login', r.status === 401, r.status);
  r = await send({ ...INQ, design: ' ' }); ok('needs a design description', r.status === 400 && /圖案/.test(r.json?.error), r.json);
  r = await send({ ...INQ, phone: '12' }); ok('needs a real phone', r.status === 400, r.status);
  r = await send({ ...INQ, photos: [PNG, PNG, PNG, PNG, PNG, PNG] }); ok('at most 5 photos', r.status === 400 && /5 張/.test(r.json?.error), r.json);
  r = await send({ ...INQ, photos: ['data:text/html;base64,PHNjcmlwdD4='] }); ok('non-image upload refused', r.status === 400, r.status);
  r = await send({ ...INQ, date: '2020-01-01' }); ok('past date refused', r.status === 400, r.status);
  r = await send({ ...INQ, purpose: 'evil<script>' }); const INQ1 = r.json;
  ok('valid request → Q number + chat summary; unknown purpose becomes 其他', r.status === 200 && /^Q\d{9}$/.test(INQ1.no) && /您好，我送出了客製詢問/.test(INQ1.summary) && /用途：其他/.test(INQ1.summary), r.json);
  r = await send(INQ); const INQ2 = r.json;
  r = await call('/admin/inquiries', { user: BOB }); ok('non-admin cannot list custom requests', r.status === 403, r.status);
  r = await call('/admin/inquiries', { user: ADMIN }); const got = r.json?.inquiries?.find((x) => x.no === INQ2.no);
  ok('admin sees it with photos, text, contact and LINE name', got && got.photos.length === 2 && got.text === INQ.text && got.contact.phone === INQ.phone && got.user.name === 'Alice' && got.status === 'new' && r.json.statuses.quoted === '已報價', got);
  const img = got?.photos?.[0] || ''; let g = await fetch(img); ok('uploaded photo is served', g.status === 200 && /image\/png/.test(g.headers.get('content-type') || ''), g.status);
  r = await call(`/admin/inquiries/${INQ2.no}`, { method: 'PATCH', user: ADMIN, body: { status: 'nope' } }); ok('bad status refused', r.status === 400, r.status);
  r = await call(`/admin/inquiries/${INQ2.no}`, { method: 'PATCH', user: ADMIN, body: { status: 'quoted', quote: 3600, adminNote: '粉色系，12 片' } });
  ok('admin marks 已報價 with amount and note; history kept', r.status === 200 && r.json.inquiry.status === 'quoted' && r.json.inquiry.quote === 3600 && r.json.inquiry.history.length === 2, r.json);
  r = await call(`/admin/inquiries/${INQ2.no}`, { method: 'PATCH', user: BOB, body: { status: 'declined' } }); ok('non-admin cannot change it', r.status === 403, r.status);
  r = await call('/me', { user: ALICE }); ok('custom requests do not show up as orders in 我的訂單', r.status === 200 && !r.json.orders.some((o) => /^Q/.test(o.orderNo || '')), r.json?.orders?.length);
  const rl = []; for (let i = 0; i < 5; i++) rl.push((await send({ ...INQ, photos: [] }, BOB)).status);
  r = await send({ ...INQ, photos: [] }, BOB); ok('6 requests a day per LINE account, the 7th is refused', rl.slice(0, 5).every((x) => x === 200) && (await send({ ...INQ, photos: [] }, BOB)).status === 429, [rl, r.status]);
  r = await call(`/admin/inquiries/${INQ2.no}`, { method: 'DELETE', user: ADMIN }); g = await fetch(img);
  ok('deleting a request removes its photos too', r.status === 200 && g.status === 404, [r.status, g.status]);
}

section('dates: 公休 / 不接單 / 每日上限');
const D = ymd(12);
await putSettings({ blockedDates: [D] }); await bad('blocked date rejected', { date: D }, /不接單/);
await putSettings({ blockedDates: [], closedWeekdays: [dow(D)] }); await bad('weekly closing day rejected', { date: D }, /不接單/);
await putSettings({ closedWeekdays: [], maxOrdersPerDay: 2 }); const D2 = ymd(20);
const a1 = await order({ date: D2 }), a2 = await order({ date: D2 }), a3 = await order({ date: D2 });
ok('2 orders/day allowed, 3rd says 額滿', a1.status === 200 && a2.status === 200 && a3.status === 400 && /額滿/.test(a3.json.error), [a1.status, a2.status, a3.status, a3.json?.error]);
r = await call('/catalog'); ok('full day is listed for the calendar', r.json.fullDates.includes(D2), r.json.fullDates);
await call(`/admin/orders/${a1.json.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'cancelled' } });
r = await call('/catalog'); const a4 = await order({ date: D2 }); ok('cancelling frees the slot', !r.json.fullDates.includes(D2) && a4.status === 200, [r.json.fullDates, a4.status]);
const D3 = ymd(21); await call(`/admin/orders/${a2.json.orderNo}`, { method: 'PATCH', user: ADMIN, body: { date: D3 } });
g = await call(`/orders/${a2.json.orderNo}?t=${a2.json.token}`); const a5 = await order({ date: D2 });
ok('admin moving an order to another day frees the old day', g.json.order.date === D3 && a5.status === 200, [g.json.order.date, a5.status]);
await putSettings({ maxOrdersPerDay: 0 });

section('開店接單 / 關閉接單 / 測試模式');
await putSettings({ pauseOrders: true });
r = await call('/catalog'); ok('closed: customers see pauseOrders', r.json.settings.pauseOrders === true, r.json.settings.pauseOrders);
r = await order(); ok('closed: guest order refused', r.status === 400 && /暫停接單/.test(r.json.error), r.json);
r = await order({}, ALICE); ok('closed: member order refused', r.status === 400, r.status);
r = await order({}, ADMIN); ok('closed: admin can still test', r.status === 200, r.json);
r = await call('/catalog', { user: ADMIN }); ok('closed: admin view is open', r.json.settings.pauseOrders === false, r.json.settings.pauseOrders);
await putSettings({ pauseOrders: false, testMode: true });
r = await call('/catalog'); ok('test mode: customers get no online payment', Object.values(r.json.settings.payments).every((v) => v === false) && r.json.settings.pauseOrders === false, r.json.settings.payments);
r = await order(); ok('test mode: guest cannot create a paid order', r.status === 400, r.status);
r = await order({ payment: 'ecpay' }, ADMIN); ok('test mode: admin can', r.status === 200, r.status);
await putSettings({ testMode: false });

section('concurrency');
const many = await Promise.all(Array.from({ length: 12 }, () => order({ date: ymd(30) })));
ok('12 simultaneous orders → 12 different order numbers', many.every((x) => x.status === 200) && new Set(many.map((x) => x.json.orderNo)).size === 12, many.map((x) => x.json?.orderNo || x.status));

section('店家密碼登入');
const bearer = (t) => ({ authorization: 'Bearer ' + t });
r = await call('/admin/login', { method: 'POST', body: { pass: 'whatever' } }); ok('login before a passcode exists → 403', r.status === 403, r.status);
r = await putSettings({ newAdminPass: '123' }); ok('too-short passcode rejected', r.status === 400, r.status);
r = await putSettings({ newAdminPass: 'qa-pass-2468' });
ok('passcode set: reply carries a session, never the hash or signing secret', r.status === 200 && /^adm\./.test(r.json.token) && r.json.settings.hasAdminPass === true && !/adminPass"|sessionSecret/.test(r.text), r.text.slice(0, 120));
r = await call('/admin/login', { method: 'POST', body: { pass: 'wrong-pass' } }); ok('wrong passcode → 403', r.status === 403, r.status);
r = await call('/admin/login', { method: 'POST', body: { pass: { $ne: 1 } } }); ok('non-text passcode → 403', r.status === 403, r.status);
r = await call('/admin/login', { method: 'POST', body: { pass: 'qa-pass-2468' } }); const T = r.json?.token; ok('right passcode → session', r.status === 200 && /^adm\./.test(T || ''), r.status);
r = await call('/admin/orders', { headers: bearer(T) }); ok('session opens the admin', r.status === 200, r.status);
r = await call('/admin/orders', { headers: bearer(T.slice(0, -4) + 'AAAA') }); ok('tampered session → 401', r.status === 401, r.status);
const forged = 'adm.' + Buffer.from(JSON.stringify({ v: 2, exp: Date.now() + 9e9 })).toString('base64url') + '.' + T.split('.')[2];
r = await call('/admin/orders', { headers: bearer(forged) }); ok('forged session (edited expiry) → 401', r.status === 401, r.status);
r = await call('/me', { headers: bearer(T) }); ok('/me for a passcode session: admin, no member data', r.json?.isAdmin === true && r.json.orders.length === 0 && r.json.contact === null, r.json);
r = await call('/admin/settings', { headers: bearer(T) }); ok('settings page data has no hash / secret', r.status === 200 && r.json.settings.hasAdminPass && !/adminPass"|sessionSecret/.test(r.text), r.status);
await putSettings({ pauseOrders: true });
r = await call('/catalog', { headers: bearer(T) }); ok('closed shop: passcode session still sees it open (to test)', r.json.settings.pauseOrders === false, r.json.settings.pauseOrders);
r = await call('/orders', { method: 'POST', headers: bearer(T), body: { items: [{ type: 'product', productId: 'meringue-butter', qty: 1 }], date: ymd(10), contact, payment: 'transfer' } });
const OP = r.json; g = await call('/admin/orders', { headers: bearer(T) });
ok('passcode session can test-order while closed; the order is not tied to any LINE member', r.status === 200 && g.json.orders.find((o) => o.orderNo === OP.orderNo) && !g.json.orders.find((o) => o.orderNo === OP.orderNo).user, r.status);
await putSettings({ pauseOrders: false });
ok('order from a shop login is marked 店家測試單', g.json.orders.find((o) => o.orderNo === OP.orderNo).byShop === true && g.json.orders.find((o) => o.orderNo === O1.orderNo).byShop === false, 'flag');
r = await call('/catalog', { headers: bearer(T) }); g = await call('/catalog');
ok('only a shop login is told what customers currently see', r.json.settings.preview && r.json.settings.preview.closed === false && !('preview' in g.json.settings), [r.json.settings.preview, g.json.settings.preview]);
r = await call(`/admin/orders/${O1.orderNo}`, { method: 'DELETE', headers: bearer(T) }); ok('a normal admin cannot delete a customer order (cancel instead)', r.status === 403, r.status);
r = await call(`/admin/orders/${OP.orderNo}`, { method: 'DELETE' }); ok('deleting needs a login', r.status === 401, r.status);
r = await call(`/admin/orders/${OP.orderNo}`, { method: 'DELETE', user: ALICE }); ok('a customer cannot delete orders', r.status === 403, r.status);
r = await call(`/admin/orders/${OP.orderNo}`, { method: 'DELETE', headers: bearer(T) }); g = await call(`/orders/${OP.orderNo}?t=${OP.token}`);
ok('the shop can delete its own test order', r.status === 200 && g.status === 404, [r.status, g.status]);
g = await call('/admin/claim', { method: 'POST', headers: bearer(T), body: { invite: INVITE } }); r = await call('/admin/settings', { user: ADMIN });
ok('an invite opened with only the passcode says to use LINE, adds no fake admin', g.status === 400 && /LINE/.test(g.json.error) && !r.json.settings.admins.some((a) => a.sub === 'shop-admin'), [g.status, g.json?.error]);
section('綁定 LINE 帳號（店家密碼 → 自動認得）');
const DAVE = 'Uqa-dave|Dave';
r = await call('/admin/orders', { user: DAVE }); ok('a LINE user is not admin by default', r.status === 403, r.status);
r = await call('/admin/bind-line', { method: 'POST', user: DAVE, body: { adminToken: 'adm.fake.sig' } }); ok('binding needs a real passcode session', r.status === 403, r.status);
r = await call('/admin/bind-line', { method: 'POST', body: { adminToken: T } }); ok('binding needs a LINE identity', r.status === 401, r.status);
r = await call('/admin/bind-line', { method: 'POST', headers: bearer(T), body: { adminToken: T } }); ok('a passcode session alone cannot bind itself', r.status === 400, r.status);
r = await call('/admin/bind-line', { method: 'POST', user: DAVE, body: { adminToken: T } }); ok('LINE user + passcode session → bound', r.status === 200 && r.json.name === 'Dave', r.json);
r = await call('/admin/orders', { user: DAVE }); ok('from now on that LINE account opens the admin without the passcode', r.status === 200, r.status);
await call('/admin/bind-line', { method: 'POST', user: DAVE, body: { adminToken: T } }); r = await call('/admin/settings', { user: ADMIN });
ok('binding twice adds one admin only', r.json.settings.admins.filter((a) => a.sub === 'Uqa-dave').length === 1, r.json.settings.admins);
await putSettings({ removeAdmins: ['Uqa-dave'] }); r = await call('/admin/orders', { user: DAVE }); ok('removing the admin unbinds it', r.status === 403, r.status);

r = await putSettings({ newAdminPass: 'qa-pass-1357' }); g = await call('/admin/orders', { headers: bearer(T) }); ok('changing the passcode signs out older sessions', g.status === 401, g.status);
r = await call('/admin/login', { method: 'POST', body: { pass: 'qa-pass-2468' } }); ok('old passcode stops working', r.status === 403, r.status);
r = await call('/admin/login', { method: 'POST', body: { pass: 'qa-pass-1357' } }); ok('new passcode works', r.status === 200, r.status);

section('申請成為管理員（LINE 會員）');
const FRAN = 'Uqa-fran|Fran';
r = await call('/admin/request', { method: 'POST', body: {} }); ok('request needs a LINE identity', r.status === 401, r.status);
r = await call('/admin/request', { method: 'POST', user: FRAN, body: {} }); ok('LINE member can ask', r.json?.pending === true, r.json);
r = await call('/admin/requests', { user: FRAN }); ok('the asker cannot see or approve requests', r.status === 403, r.status);
r = await call(`/admin/requests/Uqa-fran/approve`, { method: 'POST', user: FRAN, body: {} }); ok('the asker cannot approve themselves', r.status === 403, r.status);
r = await call('/admin/requests', { user: ADMIN }); ok('admin sees the request', r.json.requests.some((x) => x.sub === 'Uqa-fran' && x.name === 'Fran'), r.json);
r = await call('/admin/orders', { user: FRAN }); ok('still no access while pending', r.status === 403, r.status);
r = await call(`/admin/requests/Uqa-fran/approve`, { method: 'POST', user: ADMIN, body: {} }); g = await call('/admin/orders', { user: FRAN });
ok('approved → straight in', r.status === 200 && g.status === 200, [r.status, g.status]);
r = await call('/admin/requests', { user: ADMIN }); ok('request is cleared after approval', !r.json.requests.some((x) => x.sub === 'Uqa-fran'), r.json);
r = await call('/admin/request', { method: 'POST', user: FRAN, body: {} }); ok('an admin asking again just gets "admin"', r.json?.admin === true, r.json);
await call('/admin/request', { method: 'POST', user: 'Uqa-gus|Gus', body: {} }); r = await call(`/admin/requests/Uqa-gus/reject`, { method: 'POST', user: ADMIN, body: {} }); g = await call('/admin/orders', { user: 'Uqa-gus|Gus' });
ok('rejected → still no access', r.status === 200 && g.status === 403, [r.status, g.status]);
await putSettings({ removeAdmins: ['Uqa-fran'] });

section('用手機號碼綁定管理員');
const HAL = 'Uqa-hal|Hal', IVY = 'Uqa-ivy|Ivy';
r = await call('/admin/settings', { method: 'PUT', user: HAL, body: { addAdminPhones: [{ phone: '0911222333' }] } }); ok('only an admin can set admin phones', r.status === 403, r.status);
r = await putSettings({ addAdminPhones: [{ phone: '12' }] }); ok('bad phone rejected', r.status === 400, r.status);
r = await putSettings({ addAdminPhones: [{ phone: '0911-222-333', label: '負責人' }] }); ok('admin phone saved (digits only)', r.json.settings.adminPhones.some((p) => p.phone === '0911222333' && p.label === '負責人' && !p.boundSub), r.json.settings.adminPhones);
r = await call('/admin/bind-phone', { method: 'POST', body: { phone: '0911222333' } }); ok('binding needs a LINE identity', r.status === 401, r.status);
r = await call('/admin/bind-phone', { method: 'POST', user: HAL, body: { phone: '0911000000' } }); ok('wrong number → refused', r.status === 403, r.status);
r = await call('/admin/orders', { user: HAL }); ok('…and no access', r.status === 403, r.status);
r = await call('/admin/bind-phone', { method: 'POST', user: HAL, body: { phone: '0911 222 333' } }); ok('right number (any format) → bound', r.status === 200 && r.json.name === 'Hal', r.json);
r = await call('/admin/orders', { user: HAL }); ok('that LINE account now opens the admin directly', r.status === 200, r.status);
r = await call('/admin/settings', { user: ADMIN }); ok('settings show the number as bound to Hal', r.json.settings.adminPhones.find((p) => p.phone === '0911222333').boundName === 'Hal', r.json.settings.adminPhones);
r = await call('/admin/bind-phone', { method: 'POST', user: IVY, body: { phone: '0911222333' } }); ok('the same number cannot make a second account admin', r.status === 403, r.status);
const ptries = []; for (let i = 0; i < 4; i++) ptries.push((await call('/admin/bind-phone', { method: 'POST', user: IVY, body: { phone: '09110000' + i + '0' } })).status);
r = await call('/admin/bind-phone', { method: 'POST', user: IVY, body: { phone: '0911000099' } }); ok('5 wrong numbers → locked 30 minutes', ptries.every((x) => x === 403) && r.status === 429, [ptries, r.status]);
await putSettings({ removeAdminPhones: ['0911222333'], removeAdmins: ['Uqa-hal'] }); r = await call('/admin/orders', { user: HAL }); ok('removing the phone + admin locks Hal out', r.status === 403, r.status);

section('負責人手機（寫死、最大權限）');
const JAY = 'Uqa-jay|Jay', KIM = 'Uqa-kim|Kim';
r = await call('/admin/settings', { user: ADMIN }); ok('settings list the owner phone first, marked fixed', r.json.settings.adminPhones[0]?.phone === '0900123456' && r.json.settings.adminPhones[0].owner === true, r.json.settings.adminPhones);
r = await putSettings({ removeAdminPhones: ['0900123456'] }); ok('the owner phone cannot be removed', r.json.settings.adminPhones.some((p) => p.phone === '0900123456' && p.owner), r.json.settings.adminPhones);
r = await call('/admin/bind-phone', { method: 'POST', user: JAY, body: { phone: '0900-123-456' } }); ok('owner phone → owner-level admin', r.json?.owner === true, r.json);
r = await call('/admin/orders', { user: JAY }); ok('owner opens the admin', r.status === 200, r.status);
r = await call('/admin/bind-phone', { method: 'POST', user: KIM, body: { phone: '0900123456' } }); g = await call('/admin/orders', { user: KIM });
ok('the owner phone works again for another LINE account (e.g. a new phone)', r.json?.owner === true && g.status === 200, [r.json, g.status]);
r = await putSettings({ removeAdmins: ['Uqa-jay'] }); ok('a normal admin cannot remove the owner', r.status === 403, r.status);
r = await call('/admin/settings', { method: 'PUT', user: JAY, body: { removeAdmins: ['Uqa-kim'] } }); g = await call('/admin/orders', { user: KIM });
ok('the owner can remove another owner account', r.status === 200 && g.status === 403, [r.status, g.status]);
r = await call('/admin/settings', { method: 'PUT', user: JAY, body: { removeAdmins: ['Uqa-jay'] } }); ok('the owner can remove themselves', r.status === 200, r.status);

section('最大管理員（寫死的 LINE 帳號）');
const BOSS = 'Uqa-boss|Boss';
r = await call('/admin/orders', { user: BOSS }); ok('the fixed LINE account is admin with no invite, phone or approval', r.status === 200, r.status);
r = await call('/admin/settings', { user: ADMIN }); const bossRow = r.json.settings.admins.find((a) => a.sub === 'Uqa-boss');
ok('listed as 最大管理員 (fixed, owner)', bossRow && bossRow.fixed && bossRow.owner && bossRow.name === 'Boss', bossRow);
r = await putSettings({ removeAdmins: ['Uqa-boss'] }); ok('nobody can remove the fixed admin', r.status === 403, r.status);
r = await call('/admin/settings', { method: 'PUT', user: BOSS, body: { removeAdmins: ['Uqa-boss'] } }); ok('not even themselves', r.status === 403, r.status);
await call('/admin/bind-phone', { method: 'POST', user: 'Uqa-lia|Lia', body: { phone: '0900123456' } });
r = await call('/admin/settings', { method: 'PUT', user: BOSS, body: { removeAdmins: ['Uqa-lia'] } }); g = await call('/admin/orders', { user: 'Uqa-lia|Lia' });
ok('the fixed admin can remove a 負責人 added by phone', r.status === 200 && g.status === 403, [r.status, g.status]);
r = await call('/admin/settings', { method: 'PUT', user: BOSS, body: { addAdminPhones: [{ phone: '0933444555', label: '幫手' }] } });
g = await call('/admin/bind-phone', { method: 'POST', user: 'Uqa-max|Max', body: { phone: '0933444555' } }); r = await call('/admin/orders', { user: 'Uqa-max|Max' });
ok('others get in only how she allows: a phone she adds', g.status === 200 && r.status === 200, [g.status, r.status]);
await putSettings({ removeAdmins: ['Uqa-max'], removeAdminPhones: ['0933444555'] });

section('刪除客人訂單（只有最大管理員）');
r = await order({}, 'Uqa-cust|Cust'); const OD = r.json;
r = await call(`/admin/orders/${OD.orderNo}`, { method: 'DELETE', user: BOSS }); ok('not cancelled yet → refused', r.status === 400 && /已取消/.test(r.json.error), [r.status, r.json?.error]);
await call(`/admin/orders/${OD.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'cancelled' } });
r = await call(`/admin/orders/${OD.orderNo}`, { method: 'DELETE', user: ADMIN }); ok('a normal admin cannot delete a customer order', r.status === 403, r.status);
r = await call('/admin/orders', { user: ADMIN }); g = await call('/admin/orders', { user: BOSS }); ok('only the fixed admin is told they may delete', r.json.canDeleteReal === false && g.json.canDeleteReal === true, [r.json.canDeleteReal, g.json.canDeleteReal]);
r = await call(`/admin/orders/${OD.orderNo}`, { method: 'DELETE', user: BOSS }); g = await call(`/orders/${OD.orderNo}?t=${OD.token}`);
ok('Irene (fixed admin) deletes a cancelled, unpaid order', r.status === 200 && g.status === 404, [r.status, g.status]);
r = await order({}, 'Uqa-cust|Cust'); const OP2 = r.json;
await call(`/admin/orders/${OP2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { markPaid: true } });
await call(`/admin/orders/${OP2.orderNo}`, { method: 'PATCH', user: ADMIN, body: { status: 'cancelled' } });
r = await call(`/admin/orders/${OP2.orderNo}`, { method: 'DELETE', user: BOSS }); ok('a paid order is never deletable, even when cancelled', r.status === 400 && /收過款/.test(r.json.error), [r.status, r.json?.error]);

section('admin invite');
r = await putSettings({ rotateInvite: true }); const NEWINV = r.json.settings.adminInvite;
ok('invite rotated', NEWINV && NEWINV !== INVITE, NEWINV);
r = await call('/admin/claim', { method: 'POST', user: BOB, body: { invite: INVITE } }); ok('old invite no longer works', r.status === 403, r.status);
r = await call('/admin/claim', { method: 'POST', user: BOB, body: { invite: NEWINV } }); r = await call('/admin/orders', { user: BOB }); ok('new invite makes Bob an admin', r.status === 200, r.status);
await putSettings({ removeAdmins: ['Uqa-bob'] }); r = await call('/admin/orders', { user: BOB }); ok('removed admin is locked out', r.status === 403, r.status);
r = await call('/admin/settings', { method: 'PUT', user: ADMIN, body: { admins: [{ sub: 'Uhacker', name: 'x' }], adminInvite: 'AAAA' } });
ok('admins / invite cannot be overwritten through settings', !r.json.settings.admins.some((a) => a.sub === 'Uhacker') && r.json.settings.adminInvite === NEWINV, r.json.settings.admins);

section('查詢鎖定（放最後）');
const lk = []; for (let i = 0; i < 7; i++) lk.push((await call('/orders/lookup', { method: 'POST', body: { no: 'NT0000000' + i, phone: '0911111111' } })).status);
r = await call('/orders/lookup', { method: 'POST', body: { no: O1.orderNo, phone: '0912345678' } });
ok('10 failed lookups → locked 15 minutes, even with the right details', lk.every((x) => x === 404) && r.status === 429, [lk, r.status]);

section('登入鎖定（放最後：這個 IP 接下來 15 分鐘會被鎖）');
const tries = []; for (let i = 0; i < 8; i++) tries.push((await call('/admin/login', { method: 'POST', body: { pass: 'guess-' + i } })).status);
r = await call('/admin/login', { method: 'POST', body: { pass: 'guess-9' } }); g = await call('/admin/login', { method: 'POST', body: { pass: 'qa-pass-1357' } });
ok('8 wrong guesses → locked for 15 minutes, even with the right passcode', tries.every((x) => x === 403) && r.status === 429 && g.status === 429, [tries, r.status, g.status]);

console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); }
console.log('INVITE_NOW=' + NEWINV);
process.exit(fail ? 1 : 0);
