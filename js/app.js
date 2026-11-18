/* N.T Cookie × N.T Canelé — shared shop code: LINE login (LIFF), API, cart, sheets, calendar */
(function () {
  const CFG = window.NTC_CONFIG || {};
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
    if (!window.liff) {
      await new Promise((ok) => { const s = document.createElement('script'); s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
    }
    if (!window.liff) return null;
    try { await window.liff.init({ liffId: CFG.liffId }); return window.liff; } catch (e) { console.warn('liff.init', e); return null; }
  })());
  NTC.inLine = () => !!(window.liff && window.liff.isInClient && window.liff.isInClient());
  NTC.isDev = () => !!(sess.get('ntc-devkey') && sess.get('ntc-devuser'));
  NTC.loggedIn = async () => { if (NTC.isDev()) return true; const l = await NTC.liff(); return !!(l && l.isLoggedIn()); };
  NTC.idToken = async () => { const l = await NTC.liff(); return l && l.isLoggedIn() ? l.getIDToken() : null; };
  NTC.lineProfile = async () => {
    if (NTC.isDev()) { const [sub, name] = sess.get('ntc-devuser').split('|'); return { sub, name: name || '測試', picture: '' }; }
    const l = await NTC.liff(); if (!l || !l.isLoggedIn()) return null;
    const t = l.getDecodedIDToken(); return t ? { sub: t.sub, name: t.name, picture: t.picture } : null;
  };
  NTC.login = async () => {
    const l = await NTC.liff();
    if (!l) { NTC.toast('LINE 登入還沒開通，請先用一般方式填寫'); return; }
    l.login({ redirectUri: location.href });
  };
  NTC.chatUrl = (text) => 'https://line.me/R/oaMessage/' + encodeURIComponent(CFG.lineId || '@ntcookie') + '/' + (text ? '?' + encodeURIComponent(text) : '');
  NTC.open = (url, external) => {
    if (window.liff && NTC.inLine() && (external || /^https?:/.test(url) && !url.startsWith(location.origin))) { window.liff.openWindow({ url, external: !!external }); return; }
    location.href = url;
  };

  // ---------------- API
  NTC.api = async (path, { method = 'GET', body } = {}) => {
    const h = {};
    if (body !== undefined) h['content-type'] = 'application/json';
    if (NTC.isDev()) { h['x-dev-key'] = sess.get('ntc-devkey'); h['x-dev-user'] = encodeURIComponent(sess.get('ntc-devuser')); }
    else { const t = await NTC.idToken().catch(() => null); if (t) h.authorization = 'Bearer ' + t; }
    let r;
    try { r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error('網路連線不穩，請再試一次'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || '系統忙碌中，請稍後再試'); e.status = r.status; throw e; }
    return data;
  };
  let catP = null;
  NTC.catalog = () => (catP ||= NTC.api('/catalog').then((c) => { c.byId = Object.fromEntries(c.products.map((p) => [p.id, p])); return c; }));

  // ---------------- cart (kept in this browser)
  const CK = 'ntc-cart-v1';
  const keyOf = (i) => i.type === 'canele-assorted' ? `a|${i.mode}|${[...i.flavors].sort().join(',')}` : `p|${i.productId}`;
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

  // price the cart with the live catalog (the server prices it again when the order is placed)
  NTC.priceCart = (items, cat) => {
    const s = cat.settings; const lines = [];
    items.forEach((it, idx) => {
      if (it.type === 'product') {
        const p = cat.byId[it.productId];
        const ok = p && !p.soldOut;
        const isC = p && p.category === 'canele';
        lines.push({
          idx, it, ok, photo: p ? (p.photo || p.card) : '', price: p ? p.price : 0,
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
          idx, it, ok, photo: fl[0] ? fl[0].photo : '', price: s.canele.assortedPrice, unit: '盒',
          name: mode ? `綜合口味禮盒（任選 ${mode.flavors} 種）` : '綜合口味禮盒',
          detail: fl.map((p) => (p ? p.name : '已下架口味')).join('、') + (mode ? `｜每種 ${mode.each} 顆` : ''),
          min: mode ? mode.minBoxes : 1,
          error: !ok ? '裡面有口味已下架或售完，請移除後重新組合' : '',
        });
      }
    });
    lines.forEach((l) => { l.qty = l.it.qty; l.subtotal = l.price * l.qty; if (!l.error && l.qty < l.min) l.error = `這個禮盒 ${l.min} 盒起訂`; });
    const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
    return { lines, subtotal, count: lines.reduce((a, l) => a + l.qty, 0), valid: lines.length > 0 && lines.every((l) => !l.error) };
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

  // ---------------- warm up LINE login on every page (non-blocking)
  NTC.liff();
})();
