// 11-23 l: a deleted cookie series can be put back, stray cookies move in one go, a settings save never drops a series, parallel saves lose nothing.
// QA stage only; run on a seeded QA table.   node trash.test.mjs <apiUrl> <devKey>
const [API, DEVKEY] = process.argv.slice(2);
if (!/-qa|localhost|wvlfrj/.test(API)) { console.error('refusing: not a QA api'); process.exit(2); }
let pass = 0; let fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (got !== undefined ? '  → ' + JSON.stringify(got).slice(0, 400) : '')); } };
const call = async (path, { method = 'GET', body, user = 'Uqa-admin|QA店長' } = {}) => {
  const h = {}; if (user) { h['x-dev-key'] = DEVKEY; h['x-dev-user'] = encodeURIComponent(user); }
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  return { s: r.status, j };
};
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const settings = async () => (await call('/admin/settings')).j.settings;
const products = async () => (await call('/admin/products')).j.products;
const tag = Date.now().toString(36);

const ADMIN = 'Uqa-admin|QA店長'; // an admin on every seeded QA table (qa/api.test.mjs joins with the invite)
{ const r0 = await call('/admin/settings'); if (r0.s !== 200) { console.error('ERR the QA admin is not an admin on this table: run qa/api.test.mjs first', r0.s); process.exit(1); } }
const A = (path, o = {}) => call(path, { ...o, user: ADMIN });

const s0 = (await A('/admin/settings')).j.settings; const n0 = s0.cookie.series.length; const t0 = (s0.cookie.trash || []).length; // another suite may have left a deleted series in the trash
const photo = (await A('/admin/images', { method: 'POST', body: { dataUrl: IMG } })).j.url;

// ---- a series with three cookies
const sid = `qt${tag}`;
const mk = (i, extra = {}) => ({ id: `cookie-${sid}-${i}`, name: `測試餅乾${i}`, price: 200 + i * 10, active: i < 2, photo, ...extra });
let r = await A(`/admin/cookie-series/${sid}`, { method: 'PUT', body: { series: { name: '回收測試系列', groups: ['character'], photos: [photo], desc: '說明文字', lines: ['第一行'], single: true }, products: [mk(0), mk(1), mk(2)] } });
ok('a new series with three cookies is saved', r.s === 200 && r.j.settings.cookie.series.some((x) => x.id === sid), r.j);
const before = r.j.settings.cookie.series.find((x) => x.id === sid);

// ---- delete: gone from the list and from the shop, kept in the trash, cookies untouched
r = await A(`/admin/cookie-series/${sid}`, { method: 'DELETE' });
ok('delete answers 200', r.s === 200, r.j);
ok('…the series is off the list', !r.j.settings.cookie.series.some((x) => x.id === sid));
ok('…and waits in the trash with its name, photos, text and a date', (() => { const t = (r.j.settings.cookie.trash || []).find((x) => x.id === sid); return t && t.name === '回收測試系列' && t.photos.length === 1 && t.desc === '說明文字' && t.single === true && !!t.deletedAt; })(), r.j.settings.cookie.trash);
ok('…its three cookies are still there, still on that series', r.j.products.filter((p) => p.series === sid).length === 3);
let cat = (await call('/catalog', { user: null })).j;
ok('customers do not see the deleted series, its cookies or the trash', !cat.settings.cookie.series.some((x) => x.id === sid) && !cat.products.some((p) => p.series === sid) && cat.settings.cookie.trash === undefined, Object.keys(cat.settings.cookie));

// ---- a settings save keeps the trash
r = await A('/admin/settings', { method: 'PUT', body: { cookie: { ...s0.cookie, series: undefined, groups: undefined, minPieces: s0.cookie.minPieces } } });
ok('saving the settings keeps the trash', r.s === 200 && (r.j.settings.cookie.trash || []).some((x) => x.id === sid), r.j?.settings?.cookie?.trash);

// ---- restore: exactly as it was
r = await A(`/admin/cookie-series/${sid}/restore`, { method: 'POST' });
const after = r.j?.settings?.cookie?.series?.find((x) => x.id === sid);
ok('restore puts the series back', r.s === 200 && !!after, r.j);
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); // the same fields with the same values, whatever order the database gives them back in
ok('…with the same name, photos, text, categories, order and 一片可訂', after && canon(after) === canon(before), { before, after });
ok('…and empties the trash', !(r.j.settings.cookie.trash || []).some((x) => x.id === sid));
ok('…the three cookies are back in it (two on sale)', r.j.products.filter((p) => p.series === sid).length === 3 && r.j.products.filter((p) => p.series === sid && p.active).length === 2);
cat = (await call('/catalog', { user: null })).j;
ok('customers see the series again with its two cookies on sale', cat.settings.cookie.series.some((x) => x.id === sid) && cat.products.filter((p) => p.series === sid).length === 2);
r = await A(`/admin/cookie-series/${sid}/restore`, { method: 'POST' });
ok('restoring twice is refused, nothing doubles', r.s === 400 && (await settings()).cookie.series.filter((x) => x.id === sid).length === 1, r.j);

// ---- stray cookies (their series is gone and not in the trash any more): one request moves them all
const sid2 = `qu${tag}`;
await A(`/admin/cookie-series/${sid2}`, { method: 'PUT', body: { series: { name: '搬家目的地', groups: ['character'], photos: [photo] }, products: [{ id: `cookie-${sid2}-a`, name: '原本的', price: 300, active: true, photo }] } });
await A(`/admin/cookie-series/${sid}`, { method: 'DELETE' });
r = await A(`/admin/cookie-series/${sid2}/adopt`, { method: 'POST', body: { from: sid } });
ok('adopt moves every stray cookie in one request', r.s === 200 && r.j.moved === 3 && r.j.products.filter((p) => p.series === sid2).length === 4 && !r.j.products.some((p) => p.series === sid), r.j?.moved);
ok('…after the cookies that were already there, names prices photos and 上架 unchanged', (() => { const ps = r.j.products.filter((p) => p.series === sid2).sort((a, b) => a.sort - b.sort); return ps[0].name === '原本的' && ps.slice(1).map((p) => p.name).join() === '測試餅乾0,測試餅乾1,測試餅乾2' && ps.slice(1).map((p) => p.price).join() === '200,210,220' && ps.slice(1).map((p) => p.active).join() === 'true,true,false' && ps.every((p) => p.photo === photo); })(), r.j.products.filter((p) => p.series === sid2));
ok('…and the empty deleted series leaves the trash', !(r.j.settings.cookie.trash || []).some((x) => x.id === sid));
r = await A(`/admin/cookie-series/${sid2}/adopt`, { method: 'POST', body: { from: s0.cookie.series[0].id } });
ok('adopt refuses to empty a series that still exists', r.s === 400, r.j);
r = await A('/admin/cookie-series/nope-nope/adopt', { method: 'POST', body: { from: sid } });
ok('adopt refuses a target that does not exist', r.s === 400, r.j);

// ---- throw a deleted series away for good, with its cookies
await A(`/admin/cookie-series/${sid2}`, { method: 'DELETE' });
r = await A(`/admin/cookie-trash/${s0.cookie.series[0].id}`, { method: 'DELETE' });
ok('永久刪除 refuses a series that is still on the list', r.s === 400 && (await products()).some((p) => p.series === s0.cookie.series[0].id), r.j);
r = await A(`/admin/cookie-trash/${sid2}`, { method: 'DELETE' });
ok('永久刪除 removes the deleted series and its four cookies', r.s === 200 && r.j.removed === 4 && !r.j.products.some((p) => p.series === sid2) && !(r.j.settings.cookie.trash || []).some((x) => x.id === sid2), r.j?.removed);
ok('…and nothing else', r.j.settings.cookie.series.length === n0 && r.j.products.length === (await products()).length);

// ---- a settings save cannot drop a series (an old page sends a short list), nor bring a deleted one back
const sNow = await settings(); const list = sNow.cookie.series;
r = await A('/admin/settings', { method: 'PUT', body: { cookie: { ...sNow.cookie, groups: undefined, series: list.slice(1) } } });
ok('a settings save with one series missing keeps that series', r.s === 200 && r.j.settings.cookie.series.length === list.length && r.j.settings.cookie.series.some((x) => x.id === list[0].id), r.j?.settings?.cookie?.series?.length);
r = await A('/admin/settings', { method: 'PUT', body: { cookie: { ...sNow.cookie, groups: undefined, series: [] } } });
ok('…and with all of them missing keeps all of them', r.s === 200 && r.j.settings.cookie.series.length === list.length, r.j?.settings?.cookie?.series?.length);
const sid3 = `qv${tag}`; // deleted, still in the trash: a page opened before the delete still has it in its list
await A(`/admin/cookie-series/${sid3}`, { method: 'PUT', body: { series: { name: '刪掉的系列', groups: ['character'], photos: [photo] }, products: [] } });
await A(`/admin/cookie-series/${sid3}`, { method: 'DELETE' });
r = await A('/admin/settings', { method: 'PUT', body: { cookie: { ...sNow.cookie, groups: undefined, series: [...list, { id: sid3, name: '刪掉的系列', groups: ['character'] }] } } });
ok('…and does not bring back a series that was deleted', r.s === 200 && !r.j.settings.cookie.series.some((x) => x.id === sid3) && (r.j.settings.cookie.trash || []).some((x) => x.id === sid3), r.j?.settings?.cookie?.series?.length);
await A(`/admin/cookie-trash/${sid3}`, { method: 'DELETE' });
const reordered = [...list].reverse().map((x, i) => ({ ...x, sort: (i + 1) * 10 }));
r = await A('/admin/settings', { method: 'PUT', body: { cookie: { ...sNow.cookie, groups: undefined, series: reordered } } });
ok('reordering still works', r.s === 200 && [...r.j.settings.cookie.series].sort((a, b) => a.sort - b.sort)[0].id === list[list.length - 1].id);
await A('/admin/settings', { method: 'PUT', body: { cookie: { ...sNow.cookie, groups: undefined, series: list } } });

// ---- six changes to the settings at the same moment: none is lost
const ids = [0, 1, 2].map((i) => `qp${tag}${i}`);
const rs = await Promise.all([
  ...ids.map((id, i) => A(`/admin/cookie-series/${id}`, { method: 'PUT', body: { series: { name: `同時新增${i}`, groups: ['character'], photos: [photo] }, products: [{ id: `cookie-${id}-a`, name: '一片', price: 100, active: false, photo }] } })),
  A('/admin/tiles/canele', { method: 'PUT', body: { sub: [`同時${tag}`] } }),
  A('/admin/site/shop.lead', { method: 'PUT', body: { t: 'text', value: `同時改的字 ${tag}`, l: '小字', p: '線上商店' } }),
  A('/admin/settings', { method: 'PUT', body: { notice: `同時公告 ${tag}` } }),
]);
ok('six admin changes sent at the same moment all answer 200', rs.every((x) => x.s === 200), rs.map((x) => x.s));
const sEnd = await settings();
ok('…all three new series are there', ids.every((id) => sEnd.cookie.series.some((x) => x.id === id)), sEnd.cookie.series.map((x) => x.id).filter((x) => x.startsWith('qp')));
ok('…and the category line, the page text and the notice too', (sEnd.tiles?.canele?.sub || [])[0] === `同時${tag}` && sEnd.site?.['shop.lead']?.v === `同時改的字 ${tag}` && sEnd.notice === `同時公告 ${tag}`, [sEnd.tiles?.canele, sEnd.site?.['shop.lead'], sEnd.notice]);

// ---- read back right after a write: always the new value
let stale = 0;
for (let i = 0; i < 8; i++) { const v = `馬上讀 ${tag} ${i}`; await A('/admin/settings', { method: 'PUT', body: { notice: v } }); if ((await settings()).notice !== v) stale++; }
ok('eight times: save, read back at once, get what was just saved', stale === 0, stale);
const pid = `cookie-${ids[0]}-a`; let stale2 = 0;
for (let i = 0; i < 8; i++) { await A(`/admin/products/${pid}`, { method: 'PUT', body: { id: pid, category: 'cookie', series: ids[0], name: '一片', price: 100 + i, photo } }); const rr = await A(`/admin/products/${pid}`, { method: 'PUT', body: { id: pid, photo } }); if (rr.j?.product?.price !== 100 + i) stale2++; }
ok('eight times: change a price, then change only the photo, the price stays', stale2 === 0, stale2);

// ---- clean up what this test made
for (const id of ids) { await A(`/admin/cookie-series/${id}`, { method: 'DELETE' }); await A(`/admin/cookie-trash/${id}`, { method: 'DELETE' }); }
await A('/admin/tiles/canele', { method: 'PUT', body: { sub: null } }); await A('/admin/site/shop.lead', { method: 'PUT', body: { t: 'text', value: '' } }); await A('/admin/settings', { method: 'PUT', body: { notice: s0.notice || '' } });
const sClean = await settings();
ok('clean: the QA table has the series and the trash it started with', sClean.cookie.series.length === n0 && (sClean.cookie.trash || []).length === t0, [sClean.cookie.series.length, n0, (sClean.cookie.trash || []).length, t0]);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
