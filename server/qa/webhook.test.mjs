// Local test of the LINE webhook (auto-replies) and push notifications against the QA table, with LINE's API mocked.
//   TABLE=ntcookie-qa AWS_REGION=ap-northeast-1 node qa/webhook.test.mjs
import crypto from 'node:crypto';
process.env.LINE_MESSAGING_SECRET = 'qa-webhook-secret'; process.env.LINE_MESSAGING_TOKEN = 'qa-token';
process.env.DEV_KEY = 'qa-local'; process.env.OWNER_LINE_IDS = 'U' + 'b'.repeat(32); process.env.SITE_URL = 'https://brucewaynelin.github.io/ntcookie/';
if (!/-qa$/.test(process.env.TABLE || '')) { console.error('refusing: TABLE must be a -qa table'); process.exit(2); }
const sent = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.line.me/v2/bot/message/')) { sent.push({ kind: String(url).split('/').pop(), body: JSON.parse(opts.body) }); return new Response('{}', { status: 200 }); }
  return realFetch(url, opts);
};
const { handler } = await import('../index.mjs');
let pass = 0, fail = 0; const ok = (n, c, g) => { if (c) pass++; else { fail++; console.log('  ✗', n, JSON.stringify(g)?.slice(0, 300)); } };
const CAROL = 'U' + 'c'.repeat(32), DAN = 'U' + 'd'.repeat(32);
const api = (method, path, body, user) => handler({ requestContext: { http: { method, sourceIp: '127.0.0.9' } }, rawPath: path, rawQueryString: '', headers: { 'content-type': 'application/json', ...(user ? { 'x-dev-key': 'qa-local', 'x-dev-user': encodeURIComponent(user) } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => ({ status: r.statusCode, json: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() }));
const hook = (events, secret = 'qa-webhook-secret') => { const raw = JSON.stringify({ destination: 'x', events }); const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64'); return handler({ requestContext: { http: { method: 'POST' } }, rawPath: '/line/webhook', headers: { 'x-line-signature': sig, 'content-type': 'application/json' }, body: raw }); };
const msg = (text, uid) => ({ type: 'message', replyToken: 'rt-' + Math.random(), source: { type: 'user', userId: uid }, message: { type: 'text', text } });
const ymd = (n) => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await api('PUT', '/admin/settings', { pauseOrders: false, testMode: false, leadDays: 5, payments: { linepay: false, ecpay: false, transfer: true }, bank: { name: 'QA', code: '999', account: '111', holder: 'QA' } }, 'Uqa-admin|QA');
sent.length = 0;
const o = (await api('POST', '/orders', { items: [{ type: 'product', productId: 'meringue-butter', qty: 2 }], date: ymd(10), contact: { name: '卡蘿', phone: '0912345678', address: '台北市' }, note: '', payment: 'transfer' }, CAROL + '|Carol')).json;
ok('order placed by a LINE member', !!o.orderNo, o);
ok('new order → LINE push to the fixed admin (not to fake test IDs)', sent.some((m) => m.kind === 'push' && m.body.to === process.env.OWNER_LINE_IDS && /新訂單/.test(m.body.messages[0].text)) && sent.every((m) => /^U[0-9a-f]{32}$/.test(m.body.to)), sent.map((m) => m.body.to));

let r = await hook([msg('hi', CAROL)], 'wrong-secret'); ok('bad signature → 401, nothing sent', r.statusCode === 401, r.statusCode);
r = await hook([]); ok('LINE "Verify" (empty events) → 200', r.statusCode === 200, r.statusCode);
sent.length = 0; await hook([msg(`您好，我想詢問訂單 ${o.orderNo.toLowerCase()}`, CAROL)]);
const reply1 = sent.find((m) => m.kind === 'reply')?.body.messages[0].text || '';
ok('owner asks with the order number → full status reply (status, payment, date, total)', reply1.includes(o.orderNo) && /待付款/.test(reply1) && /請匯款 \$930/.test(reply1) && /合計：\$930/.test(reply1), reply1);
sent.length = 0; await hook([msg(o.orderNo, DAN)]);
const reply2 = sent.find((m) => m.kind === 'reply')?.body.messages[0].text || '';
ok('someone else asking about that number → status only, no amount/date/name', /待付款/.test(reply2) && !/\$930|卡蘿|台北/.test(reply2), reply2);
sent.length = 0; await hook([msg('我的訂單進度？', CAROL)]);
const reply3 = sent.find((m) => m.kind === 'reply')?.body.messages[0].text || '';
ok('「訂單進度」 from the member → lists their recent orders', reply3.includes(o.orderNo) && /最近的訂單/.test(reply3), reply3);
sent.length = 0; await hook([msg('查詢訂單', DAN)]);
ok('「查詢訂單」 from someone with no orders → how-to message', /請直接傳「訂單編號」/.test(sent[0]?.body.messages[0].text || ''), sent);
sent.length = 0; await hook([msg('請問可麗露可以冷藏嗎', CAROL)]);
ok('ordinary chat messages get no auto-reply (the shop answers)', sent.length === 0, sent);
sent.length = 0; await hook([msg('NT000000999', CAROL)]);
ok('unknown order number → "找不到"', /找不到這筆訂單/.test(sent[0]?.body.messages[0].text || ''), sent);
sent.length = 0; await hook([{ type: 'follow', replyToken: 'x', source: { userId: CAROL } }, { type: 'message', replyToken: 'y', source: { userId: CAROL }, message: { type: 'sticker' } }]);
ok('follow / sticker events are ignored', sent.length === 0, sent);

sent.length = 0; await api('POST', `/orders/${o.orderNo}/transfer`, { t: o.token, last5: '13579' });
ok('customer reports transfer → admins get a LINE push', sent.some((m) => m.kind === 'push' && /回報已轉帳/.test(m.body.messages[0].text)), sent.map((m) => m.body.messages[0].text));
sent.length = 0; await api('PATCH', `/admin/orders/${o.orderNo}`, { markPaid: true }, 'Uqa-admin|QA');
ok('shop confirms payment → customer gets 已付款 push', sent.some((m) => m.kind === 'push' && m.body.to === CAROL && /付款成功/.test(m.body.messages[0].text)), sent.map((m) => [m.body.to.slice(0, 5), m.body.messages[0].text]));
sent.length = 0; await api('PATCH', `/admin/orders/${o.orderNo}`, { status: 'shipped', adminMessage: '黑貓 1234-5678' }, 'Uqa-admin|QA');
ok('status → 已出貨 → customer gets a push', sent.some((m) => m.kind === 'push' && m.body.to === CAROL && /已出貨/.test(m.body.messages[0].text)), sent.map((m) => m.body.messages[0].text));
sent.length = 0; await hook([msg(o.orderNo, CAROL)]);
ok('after shipping, the auto-reply shows 已出貨 + the shop message', /已出貨/.test(sent[0]?.body.messages[0].text || '') && /黑貓 1234-5678/.test(sent[0]?.body.messages[0].text || ''), sent[0]?.body.messages[0].text);
const o2 = (await api('POST', '/orders', { items: [{ type: 'product', productId: 'meringue-butter', qty: 1 }], date: ymd(10), contact: { name: '卡蘿', phone: '0912345678', address: '台北市' }, note: '', payment: 'transfer' }, CAROL + '|Carol')).json;
sent.length = 0; await api('PATCH', `/admin/orders/${o2.orderNo}`, { status: 'cancelled', adminMessage: '那天檔期滿了' }, 'Uqa-admin|QA');
const cx = sent.find((m) => m.kind === 'push' && m.body.to === CAROL)?.body.messages[0].text || '';
ok('shop cancels → the LINE customer is told, with the reason and 請聯絡客服', /已由店家取消/.test(cx) && cx.includes(o2.orderNo) && /那天檔期滿了/.test(cx) && /請聯絡客服/.test(cx), cx);
const guest = (await api('POST', '/orders', { items: [{ type: 'product', productId: 'meringue-butter', qty: 1 }], date: ymd(10), contact: { name: 'G', phone: '0912000000', address: 'x' }, note: '', payment: 'transfer' })).json;
sent.length = 0; await api('PATCH', `/admin/orders/${guest.orderNo}`, { status: 'cancelled' }, 'Uqa-admin|QA');
ok('guest order (no LINE account) → no customer push attempted', !sent.some((m) => m.body.to !== process.env.OWNER_LINE_IDS), sent.map((m) => m.body.to));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
