/* 11-23 k: 編輯模式 — the owner changes the words, pictures and links of the site on the page itself.
   Opened from the admin (網站 → 編輯這一頁, which adds ?edit=1); stays on while she moves between pages; 「完成」 turns it off.
   Everything with data-edit (words), data-edit-img (a picture), data-edit-href (where a button goes) or data-edit-ban (a page's big
   picture, kept with the shop banners) gets a dashed frame; a tap opens a small sheet. Only a shop admin can save (the server checks). */
(function () {
  if (window.__ntcSiteEdit) return; window.__ntcSiteEdit = true;
  const { esc } = NTC;
  const FLAG = 'ntc-site-edit';
  const EDITABLE = '[data-edit], [data-edit-img], [data-edit-href], [data-edit-ban]';
  const FILE = location.pathname.split('/').pop() || 'index.html';
  const PAGE = { 'index.html': '首頁', 'shop.html': '線上商店', 'canele.html': '可麗露', 'meringue.html': '馬林糖', 'meringue-bags.html': '馬林糖', 'custom.html': '客製專區', 'reserve.html': '預約／訂購', 'category.html': '分類頁' }[FILE]
    || (document.title.split('｜')[0] || '').trim() || FILE; // the page's name in admin → 網站 → 改過的地方
  let site = {}; // key → { t, v, l, p } as the admin sees it
  const css = document.createElement('style');
  css.textContent = `
    html.se-on [data-edit], html.se-on [data-edit-img], html.se-on [data-edit-href], html.se-on [data-edit-ban] { outline: 2px dashed rgba(200, 86, 44, .95) !important; outline-offset: 2px; cursor: pointer; }
    html.se-on [data-edit], html.se-on [data-edit-img], html.se-on [data-edit-href], html.se-on [data-edit-ban] { scroll-margin-bottom: 90px; } /* never stops under the bar */
    html.se-on [data-edit-own] { outline-style: solid !important; outline-color: rgba(47, 122, 67, .95) !important; }
    html.se-on a[data-edit-href].hot { background: rgba(255, 255, 255, .22); }
    html.se-on .cartbar, html.se-on .cm-bar, html.se-on .ckd-bar { display: none !important; }
    html.se-on body { padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px)) !important; }
    .se-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; /* above the page, under the sheets (50) and the toast */ display: flex; align-items: center; gap: 8px; padding: 9px 12px calc(9px + env(safe-area-inset-bottom, 0px));
      background: #3b2116; color: #fff; font: 600 13px/1.35 system-ui, -apple-system, "PingFang TC", sans-serif; box-shadow: 0 -4px 16px rgba(0, 0, 0, .25); }
    .se-bar b { flex: none; padding: 4px 8px; border-radius: 8px; background: #c8562c; font-weight: 800; }
    .se-bar span { flex: 1; min-width: 0; }
    .se-bar a, .se-bar button { flex: none; min-height: 40px; padding: 0 12px; border: 0; border-radius: 10px; background: #fff; color: #3b2116; font: 800 14px system-ui, -apple-system, "PingFang TC", sans-serif; text-decoration: none; display: inline-flex; align-items: center; cursor: pointer; }
    .se-bar a { background: transparent; color: #fff; border: 1.5px solid rgba(255, 255, 255, .55); }
    .se-sheet .se-pv { display: block; width: 100%; max-height: 220px; object-fit: contain; margin: 0 0 12px; border-radius: 12px; background: #f3e3d8; }
    .se-sheet textarea { width: 100%; min-height: 96px; box-sizing: border-box; padding: 10px 12px; border: 1.5px solid #e3cdbf; border-radius: 12px; font: 500 16px/1.6 var(--sans, system-ui); }
    .se-sheet select, .se-sheet input[type=url] { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1.5px solid #e3cdbf; border-radius: 12px; font: 500 16px var(--sans, system-ui); background: #fff; }
    .se-sheet .se-where { margin: -4px 0 12px; font: 600 12.5px/1.5 var(--sans, system-ui); color: #8a6f62; }
    .se-sheet .btn { margin-top: 10px; }`;
  document.head.appendChild(css);
  document.documentElement.classList.add('se-on');
  const bar = document.createElement('div'); bar.className = 'se-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '編輯模式');
  bar.innerHTML = '<b>編輯模式</b><span>點虛線框起來的字、圖、按鈕就可以改（綠框＝改過的）</span><a href="admin.html?tab=site">後台</a><button type="button">完成</button>';
  document.body.appendChild(bar);
  const stop = (go) => { try { sessionStorage.removeItem(FLAG); } catch (e) { /* */ } if (go) { const u = new URL(location.href); u.searchParams.delete('edit'); location.replace(u.href); } };
  bar.querySelector('button').onclick = () => stop(true);

  // only a shop admin: anyone else gets the page back as it was
  // (only a real 「not an admin」 turns the edit mode off: a request cut short by moving to the next page, or a bad connection, just skips this page)
  let leaving = false; window.addEventListener('pagehide', () => { leaving = true; }); window.addEventListener('beforeunload', () => { leaving = true; });
  const ready = NTC.api('/admin/settings').then((r) => { site = r.settings.site || {}; return true; }).catch((e) => {
    if (leaving) return false;
    const notAdmin = !!(e && (e.status === 401 || e.status === 403));
    if (notAdmin) stop(false);
    bar.remove(); css.remove(); document.documentElement.classList.remove('se-on');
    NTC.toast(notAdmin ? '編輯模式要先用店家的 LINE 帳號登入後台' : '連線不穩，這一頁先不能編輯，重新整理再試一次', 4200); return false; });

  const publicMap = () => Object.fromEntries(Object.entries(site).map(([k, x]) => [k, x.v]));
  const labelOf = (el) => el.dataset.editLabel || '這個地方';
  const shrink = async (file, max = 1600) => {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('這張照片讀不到，請換一張')); i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.86, 0.76, 0.64, 0.52]) { const d = c.toDataURL('image/webp', q); if (d.startsWith('data:image/webp') && d.length < 370000) return d; const j = c.toDataURL('image/jpeg', q); if (j.length < 370000) return j; }
    throw new Error('照片太大，請換一張');
  };
  const save = async (key, t, value, el) => {
    const r = await NTC.api(`/admin/site/${encodeURIComponent(key)}`, { method: 'PUT', body: { t, value, l: el ? labelOf(el) : '', p: PAGE } });
    site = r.settings.site || {}; NTC.applySite(publicMap());
  };
  const sheet = (html) => { const s = NTC.sheet(html, { page: true }); s.el.classList.add('se-sheet'); return s; }; // 一整頁，不是蓋在上面的一層：iPhone 鍵盤收起來之後，蓋在上面那一層會點不準

  function editText(el) {
    const key = el.dataset.edit; const own = !!site[key];
    const { el: sh, close } = sheet(`<h2>改字</h2><p class="se-where">${esc(labelOf(el))}</p>
      <textarea id="se-v" maxlength="800">${esc(own ? site[key].v : el.innerText.trim())}</textarea>
      <p class="note" style="margin:6px 0 0">要換行就直接按換行。改好按「儲存」，客人馬上看得到。</p>
      <button type="button" class="btn block" id="se-ok">儲存</button>${own ? '<button type="button" class="btn ghost block" id="se-back">用回原本的字</button>' : ''}`);
    const ta = sh.querySelector('#se-v'); setTimeout(() => ta.focus(), 300);
    sh.querySelector('#se-ok').onclick = async () => { const v = ta.value.replace(/\s+$/, ''); if (!v.trim()) return NTC.toast('不能空白；要用回原本的字，按「用回原本的字」');
      NTC.loading(true, '儲存中…'); try { await save(key, 'text', v, el); close(); NTC.toast('改好了，客人現在就看得到', 2600); } catch (e) { NTC.toast(e.message, 3500); } finally { NTC.loading(false); } };
    const back = sh.querySelector('#se-back'); if (back) back.onclick = async () => { NTC.loading(true, '儲存中…'); try { await save(key, 'text', '', el); close(); NTC.toast('用回原本的字了', 2400); } catch (e) { NTC.toast(e.message, 3500); } finally { NTC.loading(false); } };
  }

  // a picture: her own (data-edit-img, kept with the site's words) or a page's big picture (data-edit-ban, kept with the shop banners)
  function editImage(el, ban) {
    const key = ban ? el.dataset.editBan : el.dataset.editImg;
    const img = ban ? (el.querySelector('img.cm-own') || el.querySelector('img')) : el;
    const own = ban ? !!(NTC.catalogBanners || {})[key] : !!site[key];
    const now = img && img.currentSrc ? img.currentSrc : img ? img.src : '';
    const { el: sh, close } = sheet(`<h2>換圖</h2><p class="se-where">${esc(labelOf(el))}</p>
      ${now ? `<img class="se-pv" src="${esc(now)}" alt="">` : ''}
      <p class="note" style="margin:0">${esc(el.dataset.editHint || '圖上的字是圖的一部分：換成你的圖之後，要的字請寫在圖上。')}</p>
      <p class="note" id="se-wait" hidden style="margin:10px 0 0;color:#9a4f08;font-weight:700">新的圖還沒存：上面是換上去的樣子，確定 OK 再按「確定更新」，客人才看得到。</p>
      <button type="button" class="btn block" id="se-ok" hidden>確定更新</button>
      <label class="btn block" id="se-pick">${own ? '換一張' : '換成自己的圖'}<input type="file" accept="image/*" hidden></label>
      <button type="button" class="btn ghost block" id="se-undo" hidden>不要這張，換回剛剛的</button>${own ? '<button type="button" class="btn ghost block" id="se-back">用回原本的圖</button>' : ''}`);
    // 換了圖先放在這裡給她看，按「確定更新」才存（店主 11-26：要跟商品照片一樣，不要一換就上線）
    let pending = ''; const pv0 = now;
    const pvEl = () => { let p = sh.querySelector('.se-pv'); if (!p) { p = document.createElement('img'); p.className = 'se-pv'; p.alt = ''; sh.querySelector('.se-where').after(p); } return p; };
    const mark = () => { const w = !!pending; sh.querySelector('#se-wait').hidden = !w; sh.querySelector('#se-ok').hidden = !w; sh.querySelector('#se-undo').hidden = !w;
      const pk = sh.querySelector('#se-pick'); pk.firstChild.textContent = w ? '再換一張' : own ? '換一張' : '換成自己的圖'; pk.classList.toggle('ghost', w);
      const bk = sh.querySelector('#se-back'); if (bk) bk.hidden = w; };
    sh.querySelector('.close').addEventListener('click', (e) => { if (pending && !confirm('新的圖還沒存，確定離開？（按「取消」留下來，再按「確定更新」）')) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    sh.querySelector('#se-undo').onclick = () => { pending = ''; if (pv0) pvEl().src = pv0; else { const p = sh.querySelector('.se-pv'); if (p) p.remove(); } mark(); };
    sh.querySelector('#se-ok').onclick = async () => { if (!pending) return; NTC.loading(true, '儲存中…');
      try { const u = pending; await done(u, '更新好了，客人現在就看得到'); pending = ''; } catch (err) { NTC.toast(err.message || '沒有存成功，請再按一次「確定更新」', 3500); } finally { NTC.loading(false); } };
    const done = async (value, msg) => {
      if (ban) { const r = await NTC.api(`/admin/banners/${key}`, { method: 'PUT', body: { photo: value } }); try { localStorage.setItem('ntc-banners', JSON.stringify(r.settings.banners || {})); } catch (e) { /* */ } close(); NTC.toast(msg, 2000); setTimeout(() => location.reload(), 700); return; }
      await save(key, 'img', value, el); close(); NTC.toast(msg, 2600);
    };
    sh.querySelector('#se-pick input').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      NTC.loading(true, '上傳照片…');
      try { const dataUrl = await shrink(f); pending = (await NTC.api('/admin/images', { method: 'POST', body: { dataUrl } })).url; pvEl().src = dataUrl; mark(); sh.querySelector('.se-pv').scrollIntoView({ block: 'center' });
        NTC.toast('圖放上來了，還沒存：看過 OK 按「確定更新」', 3600); }
      catch (err) { NTC.toast(err.message || '照片上傳失敗，請再試一次', 3500); } finally { NTC.loading(false); } };
    const back = sh.querySelector('#se-back'); if (back) back.onclick = async () => { NTC.loading(true, '儲存中…'); try { await done('', '用回原本的圖了'); } catch (e) { NTC.toast(e.message, 3500); } finally { NTC.loading(false); } };
  }

  // where a button goes: a page of the shop (every category she has), LINE, or any https:// address
  async function editLink(el) {
    const key = el.dataset.editHref; const cur = site[key] ? site[key].v : el.dataset.href0 || el.getAttribute('href') || '';
    let tiles = []; try { const c = await NTC.catalog(); tiles = NTC.shopTiles(c.settings, c.products).filter(NTC.tileShown); } catch (e) { /* the fixed pages are enough */ }
    const pages = [['shop.html', '線上商店'], ...tiles.map((t) => [t.href, NTC.tileLabel(t)]), ['reserve.html', '預約／訂購（選日期）'], ['orders.html', '我的訂單'], ['cart.html', '購物車'], ['index.html', '首頁'], ['line', 'LINE 聊天（聯絡我們）']];
    const curPage = pages.find(([u]) => u === cur || NTC.linkHref(u) === cur);
    const block = el.closest('.blk'); const blockImg = block && block.querySelector('[data-edit-img]');
    const { el: sh, close } = sheet(`<h2>這個按鈕連到哪裡</h2><p class="se-where">${esc(labelOf(el))}</p>
      <select id="se-to">${pages.map(([u, n]) => `<option value="${esc(u)}" ${curPage && curPage[0] === u ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__url" ${curPage ? '' : 'selected'}>其他網址（https://…）</option></select>
      <div id="se-urlbox" ${curPage ? 'hidden' : ''} style="margin-top:10px"><input type="url" id="se-url" inputmode="url" placeholder="https://www.instagram.com/…" value="${esc(curPage ? '' : cur)}"></div>
      <button type="button" class="btn block" id="se-ok">儲存</button>${site[key] ? '<button type="button" class="btn ghost block" id="se-back">用回原本的連結</button>' : ''}
      ${blockImg ? '<button type="button" class="btn ghost block" id="se-img">換這一整塊的圖</button>' : ''}`);
    const to = sh.querySelector('#se-to'); const box = sh.querySelector('#se-urlbox');
    to.onchange = () => { box.hidden = to.value !== '__url'; if (!box.hidden) sh.querySelector('#se-url').focus(); };
    sh.querySelector('#se-ok').onclick = async () => {
      let v = to.value; if (v === '__url') { v = sh.querySelector('#se-url').value.trim(); if (!/^https?:\/\/\S+$/.test(v)) return NTC.toast('網址要用 https:// 開頭'); }
      NTC.loading(true, '儲存中…'); try { await save(key, 'link', v, el); close(); NTC.toast('改好了，客人點這裡就會到新的地方', 2800); } catch (e) { NTC.toast(e.message, 3500); } finally { NTC.loading(false); } };
    const back = sh.querySelector('#se-back'); if (back) back.onclick = async () => { NTC.loading(true, '儲存中…'); try { await save(key, 'link', '', el); close(); NTC.toast('用回原本的連結了', 2400); } catch (e) { NTC.toast(e.message, 3500); } finally { NTC.loading(false); } };
    const im = sh.querySelector('#se-img'); if (im) im.onclick = () => { close(); setTimeout(() => editImage(blockImg, false), 280); };
  }

  // a tap on something with a frame opens its sheet; buttons inside a framed picture (返回, 購物車…) still work as usual.
  // The listener sits on each framed element itself: Safari on the iPhone only turns a tap into a click on an element that listens for one.
  const onTap = async (e) => {
    const el = e.currentTarget;
    if (!document.documentElement.classList.contains('se-on')) return;
    const ctl = e.target.closest('a, button, input, select, textarea, label');
    if (ctl && ctl !== el && el.contains(ctl)) return;
    e.preventDefault(); e.stopPropagation();
    if (!(await ready)) return;
    if (el.hasAttribute('data-edit-href')) return editLink(el);
    if (el.hasAttribute('data-edit-ban')) return editImage(el, true);
    if (el.hasAttribute('data-edit-img')) return editImage(el, false);
    return editText(el);
  };
  const arm = () => document.querySelectorAll(EDITABLE).forEach((el) => { if (el.__seArmed || el.closest('.se-bar, .sheet')) return; el.__seArmed = true; el.addEventListener('click', onTap); });
  arm(); new MutationObserver(arm).observe(document.body, { childList: true, subtree: true }); // pages that draw their words later (客製專區)
  NTC.catalog().then((c) => { NTC.catalogBanners = c.settings.banners || {}; }).catch(() => {});
})();
