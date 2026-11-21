/* product grids drawn inside the design + add-to-cart sheets */
(function () {
  const { esc, money, asset } = NTC;
  const U = (n) => `calc(${n} * var(--u))`;

  // design coordinates (px of the designer's canvas) for each row shape
  const LAYOUT = {
    meringue: {
      top: 6, gap: 11, bottom: 6,
      rows: { 3: { h: 454, kind: 'small', slots: [[18, 304], [326, 298], [626, 300]] }, 2: { h: 471, kind: 'wide', slots: [[18, 450], [474, 453]] }, 1: { h: 471, kind: 'wide', slots: [[245, 450]] } },
      split(n) { if (n <= 2) return [n]; const r = []; let left = n; while (left > 4) { r.push(3); left -= 3; } if (left === 4) r.push(2, 2); else r.push(left); return r; },
    },
    canele: {
      top: 2, gap: 4, bottom: 4,
      rowH: (i) => (i === 0 ? 259 : 248),
      slots: [[32, 288], [325, 274], [604, 275], [882, 285]],
      split(n) { const r = []; for (let i = 0; i < n; i += 4) r.push(Math.min(4, n - i)); return r; },
    },
  };

  function bakedOk(p, kind) {
    if (!p.card || p.cardName !== p.name) return false;
    if (p.cardPrice != null && p.cardPrice !== p.price) return false;
    if (kind && p.cardKind && p.cardKind !== kind) return false;
    return true;
  }

  function cardHtml(p, cat, w, h, kind) {
    const labelSize = Math.min(kind === 'small' ? 33 : 36, (w - 24) / ([...p.name].length + (p.icon ? 1.8 : 0)));
    const inner = bakedOk(p, kind)
      ? `<img class="baked" src="${esc(asset(p.card))}" alt="" loading="lazy">`
      : cat === 'canele'
        ? `<div class="dyn"><div class="ph" style="height:${U(h - 59)}"><img src="${esc(asset(p.photo))}" alt="" loading="lazy"></div>
             <div class="nm" style="top:${U(h - 52)};height:${U(44)};font-size:${U(30)}">${p.icon ? `<img src="${esc(asset(p.icon))}" alt="">` : ''}${esc(p.name)}</div></div>`
        : `<div class="dyn"><div class="ph" style="height:${U(kind === 'small' ? 298 : 313)}"><img src="${esc(asset(p.photo))}" alt="" loading="lazy"></div>
             <div class="nm" style="top:${U(kind === 'small' ? 318 : 334)};height:${U(48)};font-size:${U(labelSize)}">${esc(p.name)}${p.icon ? `<img src="${esc(asset(p.icon))}" alt="">` : ''}</div>
             <div class="pr" style="top:${U(kind === 'small' ? 378 : 394)};height:${U(54)};font-size:${U(38)}">${money(p.price)}<small>/ ${esc(p.unit || '罐')}</small><i></i></div></div>`;
    const so = p.soldOut ? '<div class="so"><span>售完</span></div>' : '';
    const label = `${p.name}${cat === 'canele' ? ' 單一口味禮盒' : ''} ${money(p.price)}／${p.unit || ''}${p.soldOut ? '（售完）' : ''}`;
    return `<button type="button" class="pcard" data-id="${esc(p.id)}" aria-label="${esc(label)}" style="width:${U(w)};height:${U(h)}">${inner}${so}<span class="qty-badge" hidden></span></button>`;
  }

  NTC.renderGrid = (el, cat, products) => {
    const L = LAYOUT[cat];
    const rows = products.length ? L.split(products.length) : [];
    let y = L.top; let i = 0; let html = '';
    rows.forEach((n, r) => {
      const shape = cat === 'meringue' ? L.rows[n] : { h: L.rowH(r), slots: L.slots };
      const h = shape.h;
      for (let k = 0; k < n; k++, i++) {
        const [x, w] = shape.slots[k];
        html += cardHtml(products[i], cat, w, h, shape.kind).replace('style="', `style="left:${U(x)};top:${U(y)};`);
      }
      y += h + (r < rows.length - 1 ? L.gap : 0);
    });
    y += L.bottom;
    if (!rows.length) { html = '<p style="position:absolute;inset:0;display:grid;place-items:center;margin:0;font:700 16px var(--serif);color:var(--ink2)">目前沒有上架的口味，敬請期待</p>'; y = 300; }
    el.style.height = U(y);
    el.innerHTML = html;
    el.querySelectorAll('.pcard').forEach((b) => b.addEventListener('click', () => {
      const p = products.find((x) => x.id === b.dataset.id);
      if (p.soldOut) { NTC.toast(`「${p.name}」目前售完，下次請早 ♡`); return; }
      cat === 'canele' ? NTC.openCaneleSingle(p) : NTC.openProduct(p);
    }));
    const badges = () => el.querySelectorAll('.pcard').forEach((b) => {
      const q = NTC.cart.qtyOf(b.dataset.id); const s = b.querySelector('.qty-badge');
      s.hidden = !q; s.textContent = q ? `×${q}` : '';
    });
    badges(); document.addEventListener('ntc:cart', badges);
  };

  function added(msg) { NTC.toast(msg); NTC.refreshCart(); }

  // ---- simple products (馬林糖 jars)
  NTC.openProduct = (p) => {
    const { el, close } = NTC.sheet(`
      <div class="hero"><img src="${esc(asset(p.photo || p.card))}" alt="">
        <div><h2>${esc(p.name)}</h2><div class="price">${money(p.price)} <small>/ ${esc(p.unit || '罐')}</small></div>${p.desc ? `<p class="sub" style="margin:8px 0 0">${esc(p.desc)}</p>` : ''}</div></div>
      <div class="row" style="margin:6px 0 16px"><span style="font-weight:700">數量</span><span class="sp"></span><div class="qty"></div></div>
      <button class="btn block add">加入購物車・<span class="tt"></span></button>`);
    const tt = el.querySelector('.tt');
    const st = NTC.stepper(el.querySelector('.qty'), { value: 1, onChange: (v) => (tt.textContent = money(v * p.price)) });
    tt.textContent = money(p.price);
    el.querySelector('.add').onclick = () => { NTC.cart.add({ type: 'product', productId: p.id, qty: st.value }); close(); added(`已加入 ${p.name} ×${st.value}`); };
  };

  // ---- 可麗露 single-flavour box
  NTC.openCaneleSingle = async (p) => {
    const cat = await NTC.catalog(); const min = cat.settings.canele.singleMinBoxes || 1;
    const { el, close } = NTC.sheet(`
      <div class="hero"><img src="${esc(asset(p.photo || p.card))}" alt="">
        <div><h2>${esc(p.name)}</h2><p class="sub" style="margin:2px 0 8px">單一口味禮盒・每盒 6 顆・皆為相同口味<br>❄️ 冷凍宅配寄送</p>
        <div class="price">${money(p.price)} <small>/ 盒</small></div></div></div>
      <div class="row" style="margin:6px 0 16px"><span style="font-weight:700">盒數</span><span class="note">（${min} 盒起訂）</span><span class="sp"></span><div class="qty"></div></div>
      <button class="btn block add">加入購物車・<span class="tt"></span></button>
      <button class="btn block ghost mix" style="margin-top:10px">想要多種口味？改選綜合口味禮盒 ›</button>`);
    const tt = el.querySelector('.tt');
    const st = NTC.stepper(el.querySelector('.qty'), { value: min, min, onChange: (v) => (tt.textContent = money(v * p.price)) });
    tt.textContent = money(st.value * p.price);
    el.querySelector('.add').onclick = () => { NTC.cart.add({ type: 'product', productId: p.id, qty: st.value }); close(); added(`已加入 ${p.name} 禮盒 ×${st.value}`); };
    el.querySelector('.mix').onclick = () => { close(); setTimeout(() => NTC.openAssorted([p.id]), 270); };
  };

  NTC.openCanelePicker = async () => {
    const cat = await NTC.catalog(); const fl = cat.products.filter((p) => p.category === 'canele');
    const { el, close } = NTC.sheet(`<h2>單一口味禮盒</h2><p class="sub">每盒 6 顆・皆為相同口味。請選一種口味：</p>
      <div class="chips">${fl.map((p) => `<button class="chip" data-id="${esc(p.id)}" ${p.soldOut ? 'disabled' : ''}>${p.icon ? `<img src="${esc(asset(p.icon))}" alt="">` : ''}${esc(p.name)} <b>${money(p.price)}</b>${p.soldOut ? '（售完）' : ''}</button>`).join('')}</div>`);
    el.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { close(); setTimeout(() => NTC.openCaneleSingle(fl.find((p) => p.id === c.dataset.id)), 270); }));
  };

  // ---- 可麗露 assorted box builder
  NTC.openAssorted = async (pre = []) => {
    const cat = await NTC.catalog(); const s = cat.settings.canele;
    const fl = cat.products.filter((p) => p.category === 'canele');
    let mode = s.modes[0]; let chosen = pre.filter((id) => fl.some((p) => p.id === id && !p.soldOut));
    const { el, close } = NTC.sheet(`
      <h2>綜合口味禮盒 <span class="price" style="font-size:20px">${money(s.assortedPrice)} <small>/ 盒</small></span></h2>
      <p class="sub">手工製作，每種口味最低製作量為 6 顆，因此綜合禮盒設有最低訂購盒數。❄️ 冷凍宅配寄送。</p>
      <div class="modes">${s.modes.map((m) => `<button type="button" class="opt" data-m="${m.id}"><span class="dot"></span><span class="t">任選 ${m.flavors} 種<small>每種口味 ${m.each} 顆，共 ${m.flavors * m.each} 顆・${m.minBoxes} 盒起訂</small></span></button>`).join('')}</div>
      <div class="row" style="margin:6px 0 8px"><b>選口味</b><span class="sp"></span><span class="note cnt"></span></div>
      <div class="chips fl">${fl.map((p) => `<button type="button" class="chip" data-id="${esc(p.id)}" ${p.soldOut ? 'disabled' : ''}>${p.icon ? `<img src="${esc(asset(p.icon))}" alt="">` : ''}${esc(p.name)}${p.soldOut ? '（售完）' : ''}</button>`).join('')}</div>
      <div class="row" style="margin:16px 0"><span style="font-weight:700">盒數</span><span class="note minnote"></span><span class="sp"></span><div class="qty"></div></div>
      <button class="btn block add" disabled>加入購物車・<span class="tt"></span></button>`);
    const tt = el.querySelector('.tt');
    const st = NTC.stepper(el.querySelector('.qty'), { value: mode.minBoxes, min: mode.minBoxes, onChange: () => paint() });
    const paint = () => {
      el.querySelectorAll('.opt').forEach((o) => o.classList.toggle('on', o.dataset.m === mode.id));
      if (chosen.length > mode.flavors) chosen = chosen.slice(0, mode.flavors);
      el.querySelectorAll('.fl .chip').forEach((c) => {
        const on = chosen.includes(c.dataset.id); c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', on);
      });
      el.querySelector('.cnt').textContent = `已選 ${chosen.length} / ${mode.flavors}`;
      el.querySelector('.minnote').textContent = `（${mode.minBoxes} 盒起訂）`;
      tt.textContent = money(st.value * s.assortedPrice);
      el.querySelector('.add').disabled = chosen.length !== mode.flavors;
    };
    el.querySelectorAll('.opt').forEach((o) => (o.onclick = () => { // each set starts at its own minimum (3 → 6 → back to 3)
      if (o.dataset.m === mode.id) return;
      mode = s.modes.find((m) => m.id === o.dataset.m); st.setMin(1); st.set(mode.minBoxes, true); st.setMin(mode.minBoxes); paint();
    }));
    el.querySelectorAll('.fl .chip').forEach((c) => (c.onclick = () => {
      const id = c.dataset.id;
      if (chosen.includes(id)) chosen = chosen.filter((x) => x !== id);
      else if (chosen.length < mode.flavors) chosen.push(id);
      else NTC.toast(`最多選 ${mode.flavors} 種，先取消一種再選`);
      paint();
    }));
    el.querySelector('.add').onclick = () => {
      NTC.cart.add({ type: 'canele-assorted', mode: mode.id, flavors: [...chosen], qty: st.value }); close();
      added(`已加入綜合口味禮盒 ×${st.value}`);
    };
    paint();
  };

  // ---- menu sheet (☰)
  NTC.openMenu = () => {
    const row = ([u, t]) => `<a class="opt" href="${u}" style="text-decoration:none"><span class="t">${t}</span><span class="r">›</span></a>`;
    const fixed = [['custom.html', '客製造型餅乾（詢問報價）'], ['canele.html', 'N.T Canelé 可麗露專區'], ['meringue.html', '馬林糖一口酥']];
    const { el } = NTC.sheet(`<h2>選單</h2><div style="margin-top:12px">${row([NTC.HOME, '首頁'])}
      <div id="menu-shop">${[['cookies.html?g=character', '卡通・收涎造型餅乾'], ['cookies.html?g=birthday', '慶生・抓週造型餅乾'], ...fixed].map(row).join('')}</div>
      ${[['reserve.html', '預約／訂購（選日期）'], ['cart.html', '購物車'], ['orders.html', '我的訂單']].map(row).join('')}
      <a class="opt" href="${NTC.chatUrl('您好，我想詢問')}" style="text-decoration:none"><span class="t">聯絡客服（LINE 聊天）</span><span class="r">›</span></a></div>`);
    // what the shop sells follows the live catalog: every cookie group with something on sale, then the product lines the owner opened herself (admin → 商品 → ＋ 新增分類)
    NTC.catalog().then((c) => {
      const live = (c.settings.cookie?.series || []).filter((x) => x.active);
      const groups = (c.settings.cookie?.groups || []).filter((g) => live.some((x) => (x.groups || []).includes(g.id)));
      const cats = (c.settings.categories || []).filter((k) => c.products.some((p) => p.category === k.id));
      const box = el.querySelector('#menu-shop'); if (!box) return;
      box.innerHTML = [...groups.map((g) => [`cookies.html?g=${encodeURIComponent(g.id)}`, esc(/餅乾$/.test(g.name) ? g.name : `${g.name}造型餅乾`)]), ...fixed,
        ...cats.map((k) => [`category.html?c=${encodeURIComponent(k.id)}`, esc(k.name)])].map(row).join('');
    }).catch(() => {});
    return el;
  };
  // 馬林糖兩種包裝的名稱：頁面上「選擇包裝」那兩顆（第一顆＝罐、第二顆＝包）和大包裝橫幅上的字，照店主在後台設定的換掉
  NTC.applyPackNames = (settings) => {
    const p = settings && settings.packs; const nav = document.querySelector('.pack-nav'); if (!p || !nav) return;
    [...nav.children].forEach((el, i) => { const k = i ? p.bag : p.jar; if (!k) return;
      const first = el.firstChild; if (first && first.nodeType === 3) first.nodeValue = k.name; else el.insertBefore(document.createTextNode(k.name), first);
      let note = el.querySelector('span'); if (!note && k.note) { note = document.createElement('span'); el.appendChild(note); } if (note) { note.textContent = k.note; note.hidden = !k.note; }
      let extra = el.querySelector('small'); if (!extra && k.extra) { extra = document.createElement('small'); el.appendChild(extra); } if (extra) { extra.textContent = k.extra; extra.hidden = !k.extra; } });
    const w = document.querySelector('.bag-banner-weight'); if (w && p.bag) w.textContent = `${p.bag.name} ${p.bag.note}`.trim();
  };
  if (document.querySelector('.pack-nav')) NTC.catalog().then((c) => NTC.applyPackNames(c.settings)).catch(() => {});
  NTC.back = () => { if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) history.back(); else location.href = NTC.HOME; };
})();
