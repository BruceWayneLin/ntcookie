// 造型餅乾的「分類」和整頁「編輯商品」(PUT /admin/cookie-series/:id)。QA stage only; run after qa/api.test.mjs (or any seeded QA table).
//   node qa/series.test.mjs <apiUrl> <devKey>
const [API, DEVKEY] = process.argv.slice(2);
if (!/-qa|localhost|wvlfrj/.test(API)) { console.error('refusing: not a QA api'); process.exit(2); }
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; fails.push(name + (got !== undefined ? ' → ' + JSON.stringify(got).slice(0, 300) : '')); console.log('  ✗', name); } };
const call = async (path, { method = 'GET', body, user } = {}) => {
  const h = {}; if (user) { h['x-dev-key'] = DEVKEY; h['x-dev-user'] = encodeURIComponent(user); }
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text };
};
const ADMIN = 'Uqa-admin|QA店長', BOB = 'Uqa-bob|Bob';
const SID = `qa${Date.now().toString(36)}`;

let r = await call('/admin/settings', { user: ADMIN });
const before = r.json.settings;
ok('settings has the two default categories', JSON.stringify(before.cookie.groups.map((g) => g.id)) === '["character","birthday"]', before.cookie.groups);
r = await call('/catalog'); ok('public catalog sends the categories', r.json.settings.cookie.groups?.length === 2, r.json.settings.cookie.groups);

// categories: add one, junk entries are dropped
r = await call('/admin/settings', { method: 'PUT', user: ADMIN, body: { cookie: { ...before.cookie, groups: [...before.cookie.groups, { id: 'chinese', name: '中國風' }, { id: '', name: 'x' }, { id: 'nameless', name: '' }, { id: 'chinese', name: 'dup' }] } } });
ok('add category 中國風', r.status === 200 && JSON.stringify(r.json.settings.cookie.groups) === JSON.stringify([...before.cookie.groups, { id: 'chinese', name: '中國風' }]), r.json?.settings?.cookie?.groups || r.text);
r = await call('/admin/settings', { method: 'PUT', user: ADMIN, body: { cookie: { ...before.cookie, groups: [] } } });
ok('cannot remove every category', r.status === 400, r.status);

// non-admins can't touch series
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: BOB, body: { series: { name: 'x', groups: ['chinese'] } } });
ok('non-admin → 403', r.status === 403, r.status);
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', body: { series: { name: 'x' } } });
ok('no login → 401', r.status === 401, r.status);

// a new product (series) with two options, a bogus category and a bad photo url
const ids = [`cookie-${SID}-a`, `cookie-${SID}-b`];
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: {
  series: { name: '  QA 中國風系列 ', desc: '第一行\r\n第二行', photos: ['assets/cookies/shopee/chinese.webp', 'javascript:alert(1)', 'https://example.com/a.webp'], groups: ['chinese', 'bogus'] },
  products: [{ id: ids[0], name: '長命鎖', price: 280, active: true, photo: 'assets/cookies/shopee/chinese.webp' }, { id: ids[1], name: '平安符', price: 300, active: false }],
} });
let se = r.json?.settings?.cookie?.series?.find((x) => x.id === SID);
ok('create → 200', r.status === 200, r.text);
ok('name trimmed, desc keeps line breaks', se?.name === 'QA 中國風系列' && se?.desc === '第一行\n第二行', se);
ok('bad photo url dropped, cover = first photo', JSON.stringify(se?.photos) === '["assets/cookies/shopee/chinese.webp","https://example.com/a.webp"]' && se?.photo === 'assets/cookies/shopee/chinese.webp', se);
ok('unknown category dropped', JSON.stringify(se?.groups) === '["chinese"]', se?.groups);
const mine = (ps) => ps.filter((p) => p.series === SID);
ok('two options saved in order', JSON.stringify(mine(r.json.products).map((p) => [p.name, p.price, p.active, p.sort])) === '[["長命鎖",280,true,10],["平安符",300,false,20]]', mine(r.json.products));
r = await call('/catalog');
se = r.json.settings.cookie.series.find((x) => x.id === SID);
ok('guest sees the new series (one option 上架) with photos/desc/groups', se?.active && se.photos.length === 2 && se.groups[0] === 'chinese' && se.desc.includes('\n'), se);
ok('guest sees only the 上架 option', JSON.stringify(r.json.products.filter((p) => p.series === SID).map((p) => p.name)) === '["長命鎖"]', r.json.products.filter((p) => p.series === SID));

// rename + reorder + edit price, keep the series' place
r = await call('/admin/settings', { user: ADMIN }); const sortBefore = r.json.settings.cookie.series.find((x) => x.id === SID).sort;
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: {
  series: { name: 'QA 改名了', groups: ['chinese', 'birthday'], photos: ['https://example.com/a.webp'] },
  products: [{ id: ids[1], name: '平安符', price: 320, active: true }, { id: ids[0], name: '長命鎖', price: 280, active: true }],
} });
se = r.json?.settings?.cookie?.series?.find((x) => x.id === SID);
ok('rename works', se?.name === 'QA 改名了' && JSON.stringify(se.groups) === '["chinese","birthday"]' && se.photo === 'https://example.com/a.webp', se);
ok('series keeps its sort', se?.sort === sortBefore, [se?.sort, sortBefore]);
ok('options reordered and repriced', JSON.stringify(mine(r.json.products).map((p) => [p.name, p.price, p.sort])) === '[["平安符",320,10],["長命鎖",280,20]]', mine(r.json.products));
ok('desc kept when not sent', se?.desc === '第一行\n第二行', se?.desc);

// validation
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: { series: { name: 'QA 改名了', groups: ['chinese'] }, products: [{ id: `cookie-${SID}-c`, name: '沒價格', price: 0, active: true }] } });
ok('option without a price → 400 naming it', r.status === 400 && r.json.error.includes('沒價格'), r.text);
r = await call('/admin/products', { user: ADMIN });
ok('…and nothing was saved', !r.json.products.some((p) => p.id === `cookie-${SID}-c`), mine(r.json.products).length);
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: { series: { name: '   ' } } });
ok('empty name → 400', r.status === 400, r.text);
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: { series: { name: 'QA' }, products: [{ id: 'meringue-butter', name: '偷改', price: 1, active: true }] } });
ok('cannot take over a non-cookie product', r.status === 400, r.text);
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: { series: { name: 'QA' }, products: [{ id: ids[0], name: 'a', price: 1 }, { id: ids[0], name: 'b', price: 2 }] } });
ok('duplicate option ids → 400', r.status === 400, r.text);

// remove one option; an id from another series in "remove" is ignored
r = await call('/admin/products', { user: ADMIN }); const other = r.json.products.find((p) => p.category === 'cookie' && p.series !== SID);
r = await call(`/admin/cookie-series/${SID}`, { method: 'PUT', user: ADMIN, body: { series: { name: 'QA 改名了' }, products: [{ id: ids[1], name: '平安符', price: 320, active: true }], remove: [ids[0], other.id] } });
ok('remove → option deleted', r.status === 200 && JSON.stringify(mine(r.json.products).map((p) => p.id)) === JSON.stringify([ids[1]]), mine(r.json?.products || []));
ok('remove ignores other series', r.json.products.some((p) => p.id === other.id), other.id);

// clean up: delete the series and its option, drop the test category
r = await call(`/admin/products/${ids[1]}`, { method: 'DELETE', user: ADMIN });
r = await call('/admin/settings', { user: ADMIN });
r = await call('/admin/settings', { method: 'PUT', user: ADMIN, body: { cookie: { ...r.json.settings.cookie, groups: before.cookie.groups, series: r.json.settings.cookie.series.filter((x) => x.id !== SID) } } });
ok('cleanup', r.status === 200 && !r.json.settings.cookie.series.some((x) => x.id === SID) && r.json.settings.cookie.groups.length === 2, r.text.slice(0, 200));
r = await call('/admin/settings', { user: ADMIN });
ok('old series untouched (count back to before)', r.json.settings.cookie.series.length === before.cookie.series.length, [r.json.settings.cookie.series.length, before.cookie.series.length]);

console.log(`\n${pass} passed, ${fail} failed`); if (fails.length) console.log('FAILED:\n - ' + fails.join('\n - '));
process.exit(fail ? 1 : 0);
