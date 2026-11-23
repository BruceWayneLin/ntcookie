/* N.T Cookie × N.T Canelé — shared shop code: LINE login (LIFF), API, cart, sheets, calendar */
(function () {
  const CFG = window.NTC_CONFIG || {};

  // Keep the pastry visible briefly on fast page loads. The page stays interactive.
  let openingTimer;
  function showPageOpening() {
    const root = document.documentElement;
    root.classList.add('page-opening');
    clearTimeout(openingTimer);
    requestAnimationFrame(() => {
      openingTimer = setTimeout(() => root.classList.remove('page-opening'), 650);
    });
  }
  showPageOpening();
  window.addEventListener('pageshow', (event) => { if (event.persisted) showPageOpening(); });

  // Stale-page guard: LINE's browser can keep an old copy of a page for ~10 minutes after an update.
  // Every page load asks the server for the current version (a ~300-byte file); if this copy is older, reload it once
  // under a fresh URL. The reload is remembered per page + version, so it can never loop.
  // A copy that may have come from that cache is kept invisible until the check is done (the `vchk` class set by the
  // little script in each page's <head>), so customers never see the old page flash first.
  // Links inside the site always ask for the newest copy (a `_v` in the URL the browser has not cached), so moving
  // between pages never shows an old one.
  const show = () => document.documentElement.classList.remove('vchk');
  let latestV = (CFG.version || '').replace(/\s+/g, '');
  function checkVersion() {
    fetch('js/config.js?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((t) => {
      const latest = (/version:\s*'([^']+)'/.exec(t) || [])[1];
      if (!latest || latest === CFG.version) return show();
      latestV = latest.replace(/\s+/g, '');
      const key = latest + '|' + location.pathname;
      try { if (sessionStorage.getItem('ntc-vreload') === key) return show(); sessionStorage.setItem('ntc-vreload', key); } catch (e) { return show(); }
      const u = new URL(location.href); u.searchParams.set('_v', latestV);
      location.replace(u.toString());
    }).catch(show);
  }
  checkVersion();
  if (location.pathname.endsWith('/shop.html')) {
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) checkVersion();
    });
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const raw = a.getAttribute('href') || ''; if (!raw || raw[0] === '#') return;
    let u; try { u = new URL(raw, location.href); } catch (x) { return; }
    if (u.origin !== location.origin || !/\.html$/.test(u.pathname) || !latestV) return;
    u.searchParams.set('_v', latestV); a.href = u.toString(); // the browser then follows the updated link as usual
  });
  const NTC_CONFIG_LIFF = () => !!CFG.liffId;
  const NTC = (window.NTC = {});
  const $ = (s, el = document) => el.querySelector(s);
  NTC.$ = $;
  NTC.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  NTC.money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  NTC.HOME = CFG.home || 'index.html';
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('a[href="index.html"]').forEach((a) => a.setAttribute('href', NTC.HOME)));
  NTC.asset = (u) => (!u ? '' : /^https?:|^data:/.test(u) ? u : (CFG.base || '') + u);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const sess = { // tester flags live on this device so they survive LINE opening each link in a new tab
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // test-only: ?devkey=…&devuser=Uxxx|名字 (only honoured by the dev API)
  const qs = new URLSearchParams(location.search);
  if (qs.get('devkey')) sess.set('ntc-devkey', qs.get('devkey'));
  if (qs.get('devuser')) sess.set('ntc-devuser', qs.get('devuser'));
  if (qs.get('api')) sess.set('ntc-api', qs.get('api'));
  const API = sess.get('ntc-api') || CFG.api;

  // ---------------- toast / loading
  let toastEl, toastTimer;
  NTC.toast = (msg, ms = 2200) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };
  let coverEl;
  NTC.loading = (on, msg = '處理中…') => {
    if (!coverEl) { coverEl = document.createElement('div'); coverEl.className = 'loading-cover'; coverEl.innerHTML = '<div class="spinner"></div><div class="m"></div>'; document.body.appendChild(coverEl); }
    coverEl.querySelector('.m').textContent = msg; coverEl.classList.toggle('show', !!on);
  };

  // ---------------- LINE (LIFF)
  let liffP = null;
  NTC.liff = () => (liffP ||= (async () => {
    if (!CFG.liffId) return null;
    if (window.__liffGo) return new Promise(() => {}); // this page is only LINE's doorway to another page: index.html's own early init is already taking us there
    if (!window.liff) {
      await new Promise((ok) => { const s = document.createElement('script'); s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
    }
    if (!window.liff) return null;
    try { await window.liff.init({ liffId: CFG.liffId }); return window.liff; } catch (e) { console.warn('liff.init', e); return null; }
  })());
  NTC.inLine = () => !!(window.liff && window.liff.isInClient && window.liff.isInClient());
  NTC.inLineApp = () => NTC.inLine() || / Line\//i.test(navigator.userAgent); // LINE's own browser (LIFF or a link tapped in a chat)
  NTC.isAdminHere = () => { try { return localStorage.getItem('ntc-is-admin') === '1'; } catch (e) { return false; } };
  NTC.markAdmin = (yes) => { try { yes ? localStorage.setItem('ntc-is-admin', '1') : localStorage.removeItem('ntc-is-admin'); } catch (e) { /* ignore */ } };
  NTC.isDev = () => !!(sess.get('ntc-devkey') && sess.get('ntc-devuser'));
  // a LINE login only counts while its ID token is still valid (LINE's token lasts about an hour outside the LINE app)
  NTC.idToken = async () => {
    const l = await NTC.liff(); if (!l || !l.isLoggedIn()) return null;
    const t = l.getIDToken(); const d = l.getDecodedIDToken();
    if (t && d && d.exp * 1000 > Date.now() + 60e3) return t;
    const at = l.getAccessToken(); // LINE's own browser sometimes gives no ID token: the access token still identifies the user
    if (at) return 'lat.' + at;
    try { l.logout(); } catch (e) { /* ignore */ }
    return null;
  };
  // tiny, token-free note sent with API calls so login problems show up in the server log
  NTC.diag = () => { const l = window.liff; if (!l || !l.isLoggedIn) return 'noliff'; try { return `in=${l.isInClient() ? 1 : 0};li=${l.isLoggedIn() ? 1 : 0};id=${l.getIDToken() ? 1 : 0};at=${l.getAccessToken() ? 1 : 0};ua=${/ Line\//i.test(navigator.userAgent) ? 'line' : 'other'}`; } catch (e) { return 'err'; } };
  NTC.loggedIn = async () => (NTC.isDev() ? true : !!(await NTC.idToken()));
  NTC.lineProfile = async () => {
    if (NTC.isDev()) { const [sub, name] = sess.get('ntc-devuser').split('|'); return { sub, name: name || '測試', picture: '' }; }
    const l = await NTC.liff(); if (!l || !l.isLoggedIn()) return null;
    const t = l.getDecodedIDToken(); if (t) return { sub: t.sub, name: t.name, picture: t.picture };
    try { const p = await l.getProfile(); return { sub: p.userId, name: p.displayName, picture: p.pictureUrl || '' }; } catch (e) { return null; }
  };
  NTC.login = async () => {
    const l = await NTC.liff();
    if (!l) { NTC.toast('LINE 登入暫時無法使用，請稍後再試'); return; }
    l.login({ redirectUri: location.href.split('#')[0] });
  };
  NTC.logout = async () => { const l = await NTC.liff(); if (l && l.isLoggedIn()) l.logout(); NTC.markAdmin(false); };
  NTC.chatUrl = (text) => 'https://line.me/R/oaMessage/' + encodeURIComponent(CFG.lineId || '@ntcookie') + '/' + (text ? '?' + encodeURIComponent(text) : '');
  NTC.open = (url, external) => {
    if (window.liff && NTC.inLine() && (external || /^https?:/.test(url) && !url.startsWith(location.origin))) { window.liff.openWindow({ url, external: !!external }); return; }
    location.href = url;
  };

  // ---------------- API
  // 店家密碼登入：通行證存在這支裝置，後台頁優先用它；其他頁沒有 LINE 登入時才用（讓店家關店時也能自己測試下單）
  NTC.adminToken = () => sess.get('ntc-admin') || '';
  NTC.setAdminToken = (t) => { try { t ? localStorage.setItem('ntc-admin', t) : localStorage.removeItem('ntc-admin'); } catch (e) { /* ignore */ } };
  NTC.api = async (path, { method = 'GET', body, asLine = false } = {}) => {
    const h = {};
    if (body !== undefined) h['content-type'] = 'application/json';
    if (NTC_CONFIG_LIFF()) h['x-ntc-diag'] = NTC.diag();
    const adm = NTC.adminToken();
    if (NTC.isDev()) { h['x-dev-key'] = sess.get('ntc-devkey'); h['x-dev-user'] = encodeURIComponent(sess.get('ntc-devuser')); }
    else if (adm && NTC.preferAdmin && !asLine) h.authorization = 'Bearer ' + adm;
    else { const t = await NTC.idToken().catch(() => null); if (t) h.authorization = 'Bearer ' + t; else if (adm) h.authorization = 'Bearer ' + adm; }
    // A phone's network often drops an idle connection without telling anyone: the request goes out and no answer ever comes.
    // Reading (GET): give up on that connection after 8 s and ask once more on a new one. Writing: stop after 45 s and say so (never sent twice).
    const send = async (ms) => {
      const ac = typeof AbortController === 'function' ? new AbortController() : null; const timer = ac ? setTimeout(() => ac.abort(), ms) : 0;
      try { return await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ac ? ac.signal : undefined }); }
      finally { clearTimeout(timer); }
    };
    let r;
    try { r = await send(method === 'GET' ? 8000 : 45000); }
    catch (e) {
      if (method !== 'GET') throw new Error(e && e.name === 'AbortError' ? '連線太久沒有回應。請重新整理看看剛剛的有沒有存好，再試一次' : '網路連線不穩，請再試一次');
      try { r = await send(15000); } catch (e2) { throw new Error('網路連線不穩，請再試一次'); }
    }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && adm && h.authorization === 'Bearer ' + adm) NTC.setAdminToken(''); // passcode session expired or the passcode changed
    if (!r.ok) { const e = new Error(data.error || '系統忙碌中，請稍後再試'); e.status = r.status; throw e; }
    return data;
  };
  let catP = null;
  NTC.catalog = () => (catP ||= NTC.api('/catalog').then((c) => { c.byId = Object.fromEntries(c.products.map((p) => [p.id, p])); return c; })
    .catch((e) => { catP = null; throw e; })); // a failed load is not remembered: the next call asks again

  // ---------------- cart (kept in this browser)
  const CK = 'ntc-cart-v1';
  const keyOf = (i) => i.type === 'canele-assorted' ? `a|${i.mode}|${[...i.flavors].sort().join(',')}` : `p|${i.productId}|${i.text || ''}`;
  NTC.cart = {
    items: () => store.get(CK, []),
    save(items) { store.set(CK, items); NTC.refreshCart(); },
    add(item) {
      const items = this.items(); const k = keyOf(item); const ex = items.find((i) => keyOf(i) === k);
      if (ex) ex.qty += item.qty; else items.push(item);
      this.save(items);
    },
    setQty(idx, q) { const items = this.items(); if (!items[idx]) return; items[idx].qty = Math.max(1, Math.min(200, q)); this.save(items); },
    remove(idx) { const items = this.items(); items.splice(idx, 1); this.save(items); },
    clear() { this.save([]); },
    qtyOf(productId) { return this.items().filter((i) => i.type === 'product' && i.productId === productId).reduce((a, i) => a + i.qty, 0); },
  };
  NTC.date = { get: () => store.get('ntc-date', ''), set: (v) => store.set('ntc-date', v || '') };

  // shipping — keep in sync with calcShipping in server/index.mjs
  NTC.shipping = (lines, subtotal, s) => {
    const sh = s.shipping; const parts = [];
    if (!sh) return { fee: 0, parts, label: '' };
    const boxes = lines.filter((l) => l.temp === 'frozen').reduce((a, l) => a + l.qty, 0);
    if (boxes) {
      const tiers = [...(sh.frozen.tiers || [])].sort((a, b) => a.upTo - b.upTo);
      const max = Math.max(1, sh.frozen.maxPerParcel || (tiers.length ? tiers[tiers.length - 1].upTo : boxes));
      const feeFor = (n) => (tiers.find((t) => n <= t.upTo) || tiers[tiers.length - 1] || { fee: 0 }).fee;
      let left = boxes; let fee = 0; let parcels = 0;
      while (left > 0) { const n = Math.min(left, max); fee += feeFor(n); left -= n; parcels++; }
      parts.push({ kind: 'frozen', label: sh.frozen.label, units: boxes, parcels, fee, max });
    }
    const jars = lines.filter((l) => l.temp === 'ambient').reduce((a, l) => a + l.qty, 0);
    const pieces = lines.filter((l) => l.temp === 'cookie').reduce((a, l) => a + l.qty, 0);
    if (pieces && s.cookie) { // 造型餅乾：依片數級距；馬林糖跟餅乾同一箱（運費取較高的）
      const cs = s.cookie.shipping; const tiers = [...(cs.tiers || [])].sort((a, b) => a.upTo - b.upTo);
      const fee = (tiers.find((t) => pieces <= t.upTo) || tiers[tiers.length - 1] || { fee: 0 }).fee;
      // cookies + meringue share one (large) box: the top cookie tier
      parts.push(jars ? { kind: 'cookie', label: `${cs.label}（含${lines.some((l) => l.temp === 'ambient' && l.line) ? '常溫商品' : '馬林糖'}）`, units: pieces, parcels: 1, fee: Math.max(fee, ...tiers.map((t) => t.fee)) } : { kind: 'cookie', label: cs.label, units: pieces, parcels: 1, fee });
    } else if (jars) { // meringue alone: by the number of jars
      const at = [...(sh.ambient.tiers && sh.ambient.tiers.length ? sh.ambient.tiers : [{ upTo: 999, fee: sh.ambient.fee || 0 }])].sort((a, b) => a.upTo - b.upTo);
      parts.push({ kind: 'ambient', label: sh.ambient.label, units: jars, parcels: 1, fee: (at.find((t) => jars <= t.upTo) || at[at.length - 1]).fee });
    }
    if (s.freeShippingOver > 0 && subtotal >= s.freeShippingOver) parts.forEach((p) => { p.fee = 0; });
    return { fee: parts.reduce((a, p) => a + p.fee, 0), parts, label: parts.map((p) => p.label + (p.parcels > 1 ? `（${p.parcels} 件）` : '')).join('＋') };
  };

  // price the cart with the live catalog (the server prices it again when the order is placed)
  NTC.priceCart = (items, cat) => {
    const s = cat.settings; const lines = [];
    items.forEach((it, idx) => {
      if (it.type === 'product' && cat.byId[it.productId]?.category === 'cookie') {
        const p = cat.byId[it.productId]; const se = (s.cookie?.series || []).find((x) => x.id === p.series);
        lines.push({
          idx, it, ok: !p.soldOut && !!se, temp: 'cookie', single: !!(se && se.single), photo: p.photo || '', price: p.price, unit: p.unit || '片', min: 1,
          name: p.name, detail: (se ? se.name : '') + (p.textLabel && (it.text || !p.textOptional) ? `｜${p.textLabel}：${it.text || '（未填）'}` : ''),
          error: !se ? '這個系列目前沒有開放訂購，請移除' : p.soldOut ? '這片目前售完，請移除' : p.textLabel && !p.textOptional && !it.text ? `請移除後重新加入，並填寫${p.textLabel}` : '',
        });
      } else if (it.type === 'product') {
        const p = cat.byId[it.productId];
        const ok = p && !p.soldOut;
        const isC = p && p.category === 'canele';
        lines.push({
          idx, it, ok, temp: isC || (p && (s.categories || []).find((k) => k.id === p.category)?.temp === 'frozen') ? 'frozen' : 'ambient', photo: p ? (p.photo || p.card) : '', price: p ? p.price : 0, // 店主自己開的分類可以選冷凍
          line: p && !['canele', 'meringue'].includes(p.category) ? p.category : undefined,
          name: p ? (isC ? `${p.name}・單一口味禮盒` : p.name) : '已下架的商品',
          detail: isC ? '每盒 6 顆・皆為相同口味' : '', unit: p ? (p.unit || (isC ? '盒' : '個')) : '',
          min: isC ? (s.canele.singleMinBoxes || 1) : 1,
          error: !p ? '這個商品已下架，請移除' : p.soldOut ? '這個商品目前售完，請移除' : '',
        });
      } else {
        const mode = s.canele.modes.find((m) => m.id === it.mode);
        const fl = (it.flavors || []).map((id) => cat.byId[id]);
        const ok = !!mode && fl.every((p) => p && !p.soldOut) && fl.length === mode.flavors;
        lines.push({
          idx, it, ok, temp: 'frozen', photo: fl[0] ? fl[0].photo : '', price: s.canele.assortedPrice, unit: '盒',
          name: mode ? `綜合口味禮盒（任選 ${mode.flavors} 種）` : '綜合口味禮盒',
          detail: fl.map((p) => (p ? p.name : '已下架口味')).join('、') + (mode ? `｜每種 ${mode.each} 顆` : ''),
          min: mode ? mode.minBoxes : 1,
          error: !ok ? '裡面有口味已下架或售完，請移除後重新組合' : '',
        });
      }
    });
    lines.forEach((l) => { l.qty = l.it.qty; l.subtotal = l.price * l.qty; if (!l.error && l.qty < l.min) l.error = `這個禮盒 ${l.min} 盒起訂`; });
    const ck = lines.filter((l) => l.temp === 'cookie'); const pieces = ck.reduce((a, l) => a + l.qty, 0); const minP = s.cookie?.minPieces || 1;
    if (pieces && pieces < minP && !ck.some((l) => l.single) && !ck[ck.length - 1].error) ck[ck.length - 1].error = `造型餅乾 ${minP} 片起訂（可跨系列搭配），目前 ${pieces} 片，還差 ${minP - pieces} 片`;
    const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
    const shipping = NTC.shipping(lines.filter((l) => l.ok), subtotal, s);
    return { lines, subtotal, shipping, total: subtotal + shipping.fee, count: lines.reduce((a, l) => a + l.qty, 0), valid: lines.length > 0 && lines.every((l) => !l.error) };
  };

  const CART_SVG = '<svg viewBox="0 0 24 24"><path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L21 8H6.2"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>';
  NTC.CART_SVG = CART_SVG;
  NTC.refreshCart = async () => {
    const items = NTC.cart.items();
    const n = items.reduce((a, i) => a + i.qty, 0);
    document.querySelectorAll('[data-cart-count]').forEach((b) => { b.textContent = n || ''; b.dataset.n = n; });
    const bar = $('.cartbar');
    if (bar) {
      bar.classList.toggle('show', n > 0);
      document.body.classList.toggle('has-cartbar', n > 0);
      if (n) {
        try {
          const cat = await NTC.catalog(); const pc = NTC.priceCart(items, cat);
          bar.querySelector('.sum').innerHTML = `${NTC.money(pc.subtotal)}<small>${pc.count} 件商品${NTC.date.get() ? '・' + NTC.date.get().slice(5).replace('-', '/') + ' 到貨' : ''}</small>`;
        } catch (e) { /* offline: keep the count only */ }
      }
    }
    document.dispatchEvent(new CustomEvent('ntc:cart'));
  };
  NTC.mountCartBar = () => {
    const bar = document.createElement('div');
    bar.className = 'cartbar';
    bar.innerHTML = `<a href="cart.html"><span class="ico">${CART_SVG}<span class="badge" data-cart-count></span></span><span class="sum"></span><span class="go">去結帳 ›</span></a>`;
    document.body.appendChild(bar);
    NTC.refreshCart();
  };
  window.addEventListener('storage', (e) => { if (e.key === CK) NTC.refreshCart(); });
  window.addEventListener('pageshow', () => NTC.refreshCart());

  // ---------------- bottom sheet
  NTC.sheet = (html) => {
    const mask = document.createElement('div'); mask.className = 'sheet-mask';
    const el = document.createElement('div'); el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="grab"></div><button class="close" aria-label="關閉">✕</button>${html}`;
    document.body.append(mask, el);
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { mask.classList.add('show'); el.classList.add('show'); });
    const close = () => {
      mask.classList.remove('show'); el.classList.remove('show'); document.body.style.overflow = prevOverflow;
      setTimeout(() => { mask.remove(); el.remove(); }, 260);
    };
    mask.addEventListener('click', close); el.querySelector('.close').addEventListener('click', close);
    return { el, close };
  };
  NTC.stepper = (el, { value = 1, min = 1, max = 200, onChange }) => {
    el.classList.add('stepper');
    el.innerHTML = '<button type="button" aria-label="減少">−</button><output></output><button type="button" aria-label="增加">＋</button>';
    const [minus, plus] = el.querySelectorAll('button'); const out = el.querySelector('output');
    const api = {
      get value() { return value; },
      set(v, silent) { value = Math.max(min, Math.min(max, v)); out.textContent = value; minus.disabled = value <= min; plus.disabled = value >= max; if (!silent && onChange) onChange(value); },
      setMin(m) { min = m; api.set(Math.max(value, m)); },
    };
    minus.onclick = () => api.set(value - 1); plus.onclick = () => api.set(value + 1);
    api.set(value, true);
    return api;
  };

  // ---------------- calendar (Taiwan dates, YYYY-MM-DD)
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  NTC.addDays = addDays;
  NTC.dateRules = (s, fullDates = []) => {
    const min = addDays(s.today, s.leadDays || 0); const max = addDays(s.today, s.maxDays || 60);
    const why = (ymd) => {
      if (ymd < min) return 'early';
      if (ymd > max) return 'late';
      if ((s.blockedDates || []).includes(ymd)) return '公休';
      if ((s.closedWeekdays || []).includes(new Date(ymd + 'T00:00:00Z').getUTCDay())) return '公休';
      if (fullDates.includes(ymd)) return '額滿';
      return '';
    };
    return { min, max, why, ok: (ymd) => !!ymd && !why(ymd) };
  };
  NTC.fmtDate = (ymd) => { if (!ymd) return ''; const d = new Date(ymd + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日一二三四五六'[d.getUTCDay()]}）`; };
  // ---------------- 購物須知 (shop page + admin). Each note is written from the shop's settings, so it always matches the rules;
  // in the admin the owner can rewrite a note (shopNotes.over), hide it (off) or add her own (extra). Plain text only.
  NTC.shopNotes = (S) => {
    const m = NTC.money;
    const tiers = (t, unit, from1 = 1) => { const a = [...t].sort((x, y) => x.upTo - y.upTo); if (a.length === 1) return `一律 ${m(a[0].fee)}`;
      return a.map((x, i) => { const lo = i ? a[i - 1].upTo + 1 : from1; return (i === a.length - 1 && x.upTo >= 99 ? `${lo} ${unit}以上` : lo >= x.upTo ? `${x.upTo} ${unit}` : `${lo}～${x.upTo} ${unit}`) + ` ${m(x.fee)}`; }).join('、'); };
    const amb = S.shipping.ambient.tiers && S.shipping.ambient.tiers.length ? S.shipping.ambient.tiers : [{ upTo: 999, fee: S.shipping.ambient.fee || 0 }];
    const pay = [S.payments.transfer && '銀行轉帳', S.payments.linepay && 'LINE Pay', S.payments.ecpay && '信用卡／ATM／超商'].filter(Boolean);
    const auto = [
      ['date', '到貨日', `每一份都是接單後手工製作，最早可選 ${NTC.fmtDate(NTC.dateRules(S).min)} 到貨。${S.dateNote || ''}`],
      ['cookie', '造型餅乾', `${S.cookie.minPieces} 片起訂，可跨系列搭配。${S.cookie.shipping.label}：${tiers(S.cookie.shipping.tiers, '片', S.cookie.minPieces)}。`],
      ['canele', '可麗露', `每盒 6 顆。${S.shipping.frozen.label}：${tiers(S.shipping.frozen.tiers, '盒')}；一件最多 ${S.shipping.frozen.maxPerParcel} 盒，會與常溫商品分開寄。`],
      ['meringue', '馬林糖一口酥', `${S.shipping.ambient.label}：${tiers(amb, '罐')}。和造型餅乾一起訂會裝同一箱，運費 ${m(Math.max(...S.cookie.shipping.tiers.map((t) => t.fee)))}。`],
      ['pay', '付款', pay.length ? `${pay.join('、')}。確認收到款項後開始製作。` : '下單後會用 LINE 跟您確認付款方式。'],
      ['custom', '客製造型', '系列裡沒有的圖案，請到「聊聊客製需求」留言並附參考照片，我們報價後再製作。'],
      // 防詐騙警語（店主 11-19）：also shown under the bank details on the order page
      ['fraud', '防詐騙提醒', `我們不會打電話或傳訊息要求您操作 ATM、網路銀行、「解除分期付款」，也不會索取信用卡號或簡訊驗證碼。訂單與付款資訊請以本站「我的訂單」和 LINE 官方帳號 ${CFG.lineId || '@ntcookie'} 為準；接到可疑來電請撥 165 反詐騙專線查證。`],
    ];
    const n = S.shopNotes || {}; const over = n.over || {}; const off = n.off || [];
    return [...auto.map(([key, title, text]) => ({ key, title, auto: text, text: over[key] || text, custom: !!over[key], hidden: off.includes(key) })),
      ...(n.extra || []).map((x, i) => ({ key: 'x' + i, title: x.title, text: x.text, extra: true }))];
  };
  NTC.calendar = (el, { settings, fullDates, value, onChange }) => {
    const rules = NTC.dateRules(settings, fullDates);
    let sel = rules.ok(value) ? value : '';
    let month = (sel || rules.min).slice(0, 7);
    const render = () => {
      const [y, m] = month.split('-').map(Number);
      const first = `${month}-01`; const startDow = new Date(first + 'T00:00:00Z').getUTCDay();
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let cells = '';
      for (let i = 0; i < startDow; i++) cells += '<span class="pad"></span>';
      for (let d = 1; d <= days; d++) {
        const ymd = `${month}-${String(d).padStart(2, '0')}`; const w = rules.why(ymd);
        const tag = w === '公休' || w === '額滿' ? `<small>${w}</small>` : '';
        cells += `<button type="button" data-d="${ymd}" class="${ymd === sel ? 'on' : ''} ${ymd === settings.today ? 'today' : ''}" ${w ? 'disabled' : ''} aria-label="${NTC.fmtDate(ymd)}${w && w.length < 3 ? ' ' + w : ''}">${d}${tag}</button>`;
      }
      const prevOk = month > rules.min.slice(0, 7); const nextOk = month < rules.max.slice(0, 7);
      el.innerHTML = `<div class="cal"><div class="hd"><button type="button" data-nav="-1" ${prevOk ? '' : 'disabled'} aria-label="上個月">‹</button><b>${y} 年 ${m} 月</b><button type="button" data-nav="1" ${nextOk ? '' : 'disabled'} aria-label="下個月">›</button></div>
        <div class="wk">${'日一二三四五六'.split('').map((c) => `<span>${c}</span>`).join('')}</div><div class="days">${cells}</div></div>`;
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.nav) { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.nav), 1)); month = d.toISOString().slice(0, 7); render(); return; }
      if (b.dataset.d) { sel = b.dataset.d; render(); onChange && onChange(sel); }
    });
    render();
    return { get value() { return sel; } };
  };

  // ---------------- image fallback for slices (webp → png)
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && /\.webp$/.test(img.src) && !img.dataset.fb) { img.dataset.fb = 1; img.src = img.src.replace(/\.webp$/, '.png'); }
  }, true);

  // ---------------- 商店頁的分類（11-23 j）：網站原本的六格＋店主自己開的造型餅乾分類、其他商品分類，照她在後台排的順序。
  // 商店頁、☰ 選單、後台都用這一份。key＝g-<造型餅乾分類 id>、meringue、canele、custom、c-<其他商品分類 id>；settings.tiles[key]＝{ sort, hidden, name, sub }
  NTC.TILE0 = { meringue: { name: '馬林糖一口酥', sub: ['送禮小點'] }, canele: { name: 'N.T Canelé', sub: ['可麗露專區'] }, custom: { name: '客製專區', sub: ['寵物・精品', '紀念造型'] } };
  NTC.TILE_ORDER = ['g-character', 'g-birthday', 'meringue', 'canele', 'g-chinese', 'custom']; // 還沒排過的時候：網站原本的順序，新開的排在後面
  NTC.shopTiles = (S, products = []) => {
    S = S || {}; const T = S.tiles || {}; const banners = S.banners || {}; const ck = S.cookie || {}; const series = ck.series || [];
    const liveS = new Set(products.filter((p) => p.category === 'cookie' && p.active).map((p) => p.series));
    const out = [];
    const add = (key, o) => { const t = T[key] || {}; const d = NTC.TILE0[key] || {};
      out.push({ banner: typeof banners[key] === 'string' ? banners[key] : '', ...o, key, name: o.name || t.name || d.name || '', sub: Array.isArray(t.sub) ? t.sub : o.sub || d.sub || [], hidden: !!t.hidden, sort: t.sort, i: out.length }); };
    for (const g of ck.groups || []) { const mine = series.filter((x) => (x.groups || []).includes(g.id) && liveS.has(x.id)); const c = mine.find((x) => x.photo || (x.photos && x.photos[0]));
      add(`g-${g.id}`, { kind: 'cookie', id: g.id, name: g.name, sub: ['造型餅乾'], href: `cookies.html?g=${encodeURIComponent(g.id)}`, collection: 'cookie',
        live: g.id === 'character' || g.id === 'birthday' || mine.length > 0, cover: c ? c.photo || c.photos[0] : '' }); }
    add('meringue', { kind: 'meringue', href: 'meringue.html', collection: 'gift', live: true });
    add('canele', { kind: 'canele', href: 'canele.html', collection: 'canele', live: true });
    add('custom', { kind: 'custom', href: 'custom.html', collection: 'cookie', live: true });
    for (const c of S.categories || []) { const mine = products.filter((p) => p.category === c.id && p.active);
      add(`c-${c.id}`, { kind: 'line', id: c.id, name: c.name, sub: [], href: `category.html?c=${encodeURIComponent(c.id)}`, collection: c.temp === 'frozen' ? 'frozen' : 'gift',
        live: mine.length > 0, banner: c.photo || '', cover: (mine.find((p) => p.photo) || {}).photo || '' }); }
    const rank = (t) => (t.sort != null ? t.sort : NTC.TILE_ORDER.includes(t.key) ? (NTC.TILE_ORDER.indexOf(t.key) + 1) * 10 : 100000 + t.i);
    return out.sort((a, b) => rank(a) - rank(b) || a.i - b.i);
  };
  NTC.tileShown = (t) => !t.hidden && t.live; // 客人看不看得到這一格
  NTC.tileLabel = (t) => (t.kind === 'cookie' ? (/餅乾$/.test(t.name) ? t.name : `${t.name}造型餅乾`) : t.kind === 'custom' ? `${t.name}（詢問報價）` : t.kind === 'canele' ? `${t.name} ${t.sub[0] || ''}`.trim() : t.name);

  // ---------------- 網站上的字、圖、連結（11-23 k）：店主在網頁上直接改（後台 → 網站 → 打開那一頁）。
  // data-edit="key"（字）、data-edit-img="key"（圖）、data-edit-href="key"（按鈕連到哪）；沒改過的維持網站原本的。這支手機記住上次的，下次打開直接是新的
  const SITE_IMG = /^(https:\/\/[^\s"'<>]+|assets\/[\w./-]+)$/;
  const SITE_LINK = /^(https?:\/\/[^\s"'<>]+|[a-z0-9-]+\.html(\?[^\s"'<>]*)?(#[\w-]*)?|line(:[^\n]{0,200})?)$/;
  NTC.site = (() => { try { const m = JSON.parse(localStorage.getItem('ntc-site') || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } })();
  NTC.linkHref = (v) => (v === 'line' ? NTC.chatUrl('') : v.startsWith('line:') ? NTC.chatUrl(v.slice(5)) : v);
  const siteOrig = new WeakMap();
  NTC.applySite = (map) => {
    if (map && typeof map === 'object') { NTC.site = map; try { localStorage.setItem('ntc-site', JSON.stringify(map)); } catch (e) { /* this phone cannot remember */ } }
    const m = NTC.site || {};
    document.querySelectorAll('[data-edit]').forEach((el) => {
      if (!siteOrig.has(el)) siteOrig.set(el, { html: el.innerHTML, n: el.style.getPropertyValue('--n') });
      const v = m[el.dataset.edit]; const o = siteOrig.get(el);
      if (typeof v === 'string' && v.trim()) {
        if (el.getAttribute('data-edit-own') === v) return;
        if (el.hasAttribute('data-edit-heart')) { const ch = [...v.trim()]; const tail = ch.splice(-2).join(''); el.innerHTML = `${NTC.esc(ch.join(''))}<span class="store-title-end">${NTC.esc(tail)}<span class="store-title-heart" aria-hidden="true">♥&#xfe0e;</span></span>`; }
        else el.textContent = v;
        if (o.n) el.style.setProperty('--n', String(Math.max(...v.split('\n').map((l) => [...l].length))));
        el.style.whiteSpace = 'pre-line'; el.setAttribute('data-edit-own', v);
      } else if (el.hasAttribute('data-edit-own')) { el.innerHTML = o.html; if (o.n) el.style.setProperty('--n', o.n); el.style.whiteSpace = ''; el.removeAttribute('data-edit-own'); }
    });
    document.querySelectorAll('[data-edit-img]').forEach((el) => {
      if (!siteOrig.has(el)) siteOrig.set(el, { src: el.getAttribute('src'), width: el.getAttribute('width'), height: el.getAttribute('height') });
      const v = m[el.dataset.editImg]; const o = siteOrig.get(el);
      if (typeof v === 'string' && SITE_IMG.test(v)) { if (el.getAttribute('data-edit-own') !== v) { el.removeAttribute('width'); el.removeAttribute('height'); el.src = NTC.asset(v); el.setAttribute('data-edit-own', v); } }
      else if (el.hasAttribute('data-edit-own')) { el.src = o.src; for (const a of ['width', 'height']) if (o[a]) el.setAttribute(a, o[a]); el.removeAttribute('data-edit-own'); }
    });
    document.querySelectorAll('[data-edit-href]').forEach((el) => {
      if (!siteOrig.has(el)) siteOrig.set(el, { href: el.getAttribute('href') });
      const v = m[el.dataset.editHref]; const base = el.dataset.href0 || siteOrig.get(el).href;
      if (typeof v === 'string' && SITE_LINK.test(v)) { el.setAttribute('href', NTC.linkHref(v)); el.setAttribute('data-edit-own', v); }
      else if (el.hasAttribute('data-edit-own')) { if (base) el.setAttribute('href', base); el.removeAttribute('data-edit-own'); }
    });
  };
  const siteBoot = () => {
    const tagged = () => document.querySelector('[data-edit], [data-edit-img], [data-edit-href], [data-edit-ban]');
    if (tagged()) { NTC.applySite(); NTC.catalog().then((c) => NTC.applySite((c.settings && c.settings.site) || {})).catch(() => {}); }
    // 編輯模式：後台「網站」打開 ?edit=1；換頁也一直開著，按「完成」才關（只有店家帳號存得了）
    try {
      if (/[?&]edit=1(&|$)/.test(location.search)) sessionStorage.setItem('ntc-site-edit', '1');
      if (sessionStorage.getItem('ntc-site-edit') === '1' && !/admin\.html$/.test(location.pathname)) { const s = document.createElement('script'); s.src = 'js/site-edit.js?v=1123k'; document.body.appendChild(s); }
    } catch (e) { /* no session storage: no edit mode */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', siteBoot); else siteBoot();

  // ---------------- warm up LINE login on every page (non-blocking)
  NTC.liff();
})();
