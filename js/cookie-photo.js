/* Product option photos use the shop's preset background. Keep the original subject pixels. */
(function () {
  const background = window.NTC_CONFIG.cookiePhotoBackground;
  const createCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
  const neighbors = (i, w, n, visit) => {
    if (i % w) visit(i - 1);
    if (i % w < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < n) visit(i + w);
  };

  async function load(file, maxSide = 1500) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url;
      try { await img.decode(); }
      catch { throw new Error('這張照片讀不到，請換一張'); }
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const result = createCanvas(Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)));
      result.getContext('2d').drawImage(img, 0, 0, result.width, result.height);
      return result;
    } finally { URL.revokeObjectURL(url); }
  }

  const median = (numbers) => numbers.sort((a, b) => a - b)[numbers.length >> 1];

  // Pictures saved from a phone often carry a plain border around the real picture (white bars, a screenshot's margin).
  // Left in, the inner picture's own background would be taken for the subject and land on the card as a box.
  // An inner picture has ruler-straight sides; a cookie on a plain background does not, so that one is left alone.
  function trim(source) {
    const scale = Math.min(1, 600 / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
    if (Math.min(w, h) < 60) return source;
    const sample = createCanvas(w, h), ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    for (let pass = 0; pass < 3; pass++) {
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      if (Math.min(cw, ch) < 60) break;
      const band = Math.max(2, Math.round(Math.min(cw, ch) * .015));
      let plain = null, outer = null;
      for (const sides of ['lrtb', 'lr', 'tb']) { // a border all round, or bars on two opposite sides only
        const ring = [];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if ((sides.includes('l') && x < x0 + band) || (sides.includes('r') && x > x1 - band) || (sides.includes('t') && y < y0 + band) || (sides.includes('b') && y > y1 - band)) ring.push((y * w + x) * 4);
        }
        const tone = [0, 1, 2].map((c) => median(ring.map((p) => px[p + c])));
        const test = (p) => px[p + 3] > 16 && Math.abs(px[p] - tone[0]) <= 16 && Math.abs(px[p + 1] - tone[1]) <= 16 && Math.abs(px[p + 2] - tone[2]) <= 16;
        if (ring.filter(test).length >= ring.length * .94) { plain = test; outer = tone; break; }
      }
      if (!plain) break;
      const rows = new Int32Array(h), cols = new Int32Array(w);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!plain((y * w + x) * 4)) { rows[y]++; cols[x]++; }
      let top = y0, bottom = y1, left = x0, right = x1;
      const row = Math.max(3, cw * .02), col = Math.max(3, ch * .02);
      while (top <= bottom && rows[top] < row) top++;
      while (bottom >= top && rows[bottom] < row) bottom--;
      while (left <= right && cols[left] < col) left++;
      while (right >= left && cols[right] < col) right--;
      const iw = right - left + 1, ih = bottom - top + 1;
      if (iw < cw * .3 || ih < ch * .3 || iw * ih > cw * ch * .97) break;
      const hit = (x, y) => !plain((y * w + x) * 4);
      const moved = { l: left > x0, r: right < x1, t: top > y0, b: bottom < y1 }; // only the sides that had a border are checked
      let miss = 0, total = 0;
      for (let y = top + Math.round(ih * .03); y <= bottom - Math.round(ih * .03); y++) {
        if (moved.l) { total++; if (!(hit(left, y) || hit(left + 1, y) || hit(left + 2, y))) miss++; }
        if (moved.r) { total++; if (!(hit(right, y) || hit(right - 1, y) || hit(right - 2, y))) miss++; }
      }
      for (let x = left + Math.round(iw * .03); x <= right - Math.round(iw * .03); x++) {
        if (moved.t) { total++; if (!(hit(x, top) || hit(x, top + 1) || hit(x, top + 2))) miss++; }
        if (moved.b) { total++; if (!(hit(x, bottom) || hit(x, bottom - 1) || hit(x, bottom - 2))) miss++; }
      }
      if (!total || miss > total * .02) break;
      // The inner picture must have a plain background of its own right up to its edge: a square cookie has an outline or a
      // baked edge there (darker than both sides), and a photo is not plain. Those stay as they are.
      const thick = Math.max(2, Math.round(Math.min(iw, ih) * .015));
      const inside = (inset) => {
        const out = [], ax = left + 1 + inset, ay = top + 1 + inset, bx = right - 1 - inset, by = bottom - 1 - inset;
        for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
          if (y >= ay + thick && y <= by - thick && x === ax + thick) x = bx - thick + 1;
          out.push((y * w + x) * 4);
        }
        return out;
      };
      const edge = inside(0), deep = inside(Math.round(Math.min(iw, ih) * .04));
      const inner = [0, 1, 2].map((c) => median(edge.map((p) => px[p + c]))), deeper = [0, 1, 2].map((c) => median(deep.map((p) => px[p + c])));
      const near = (p) => Math.abs(px[p] - inner[0]) <= 16 && Math.abs(px[p + 1] - inner[1]) <= 16 && Math.abs(px[p + 2] - inner[2]) <= 16;
      if (edge.filter(near).length < edge.length * .92 || inner.some((v, c) => Math.abs(v - deeper[c]) > 14)) break;
      const light = (r, g, b) => r * .3 + g * .59 + b * .11, floor = Math.min(light(...outer), light(...inner)) - 25;
      let dark = 0, seen = 0;
      const zone = (x, y) => { const p = (y * w + x) * 4; seen++; if (light(px[p], px[p + 1], px[p + 2]) < floor) dark++; };
      for (let y = top + Math.round(ih * .03); y <= bottom - Math.round(ih * .03); y++) for (let k = 0; k < 3; k++) {
        if (moved.l) zone(left + k, y);
        if (moved.r) zone(right - k, y);
      }
      for (let x = left + Math.round(iw * .03); x <= right - Math.round(iw * .03); x++) for (let k = 0; k < 3; k++) {
        if (moved.t) zone(x, top + k);
        if (moved.b) zone(x, bottom - k);
      }
      if (dark > seen * .1) break;
      x0 = left + 1; y0 = top + 1; x1 = right - 1; y1 = bottom - 1;
    }
    if (!x0 && !y0 && x1 === w - 1 && y1 === h - 1) return source;
    const inset = Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) / scale * .006));
    const sx = Math.round(x0 / scale) + inset, sy = Math.round(y0 / scale) + inset;
    const sw = Math.round((x1 - x0 + 1) / scale) - inset * 2, sh = Math.round((y1 - y0 + 1) / scale) - inset * 2;
    if (sw < 60 || sh < 60) return source;
    const result = createCanvas(sw, sh);
    result.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return result;
  }

  function mask(source) {
    const scale = Math.min(1, 540 / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
    if (Math.min(w, h) < 36) return null;
    const sample = createCanvas(w, h), ctx = sample.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data, n = w * h;
    const rgb = [[], [], []], fringe = [];
    let transparent = 0;
    for (const x of [.075, .125, .2, .8, .875, .925]) for (const y of [.075, .125, .875, .925]) {
      const p = (Math.floor(y * h) * w + Math.floor(x * w)) * 4;
      if (pixels[p + 3] <= 16) transparent++;
      else { fringe.push(p); rgb.forEach((channel, c) => channel.push(pixels[p + c])); }
    }
    if (transparent === 24) return source;
    if (transparent > 6) return null;
    const [r, g, b] = rgb.map(median);
    // Reduce the influence of lightness so soft shadows stay with the discarded background.
    const distance = (p) => {
      const dr = pixels[p] - r, dg = pixels[p + 1] - g, db = pixels[p + 2] - b;
      return Math.hypot((dr + dg + db) / 4.5, (dr - dg) * .9, (db - dg) * .9);
    };
    const spread = fringe.map(distance).sort((a, b) => a - b);
    const drift = spread[Math.floor(spread.length * .8)];
    if (drift > 30) return null;
    const threshold = drift < 4 ? 6 : Math.max(14, drift * 1.7 + 6);
    const foreground = new Uint8Array(n);
    for (let i = 0; i < n; i++) foreground[i] = pixels[i * 4 + 3] > 16 && distance(i * 4) > threshold;
    const stack = new Int32Array(n), label = new Int32Array(n), parts = [null];
    for (let i = 0; i < n; i++) {
      if (!foreground[i] || label[i]) continue;
      const id = parts.length;
      let top = 0, count = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      const push = (j) => { if (foreground[j] && !label[j]) { label[j] = id; stack[top++] = j; } };
      push(i);
      while (top) {
        const j = stack[--top], x = j % w, y = (j / w) | 0;
        count++; x0 = Math.min(x, x0); x1 = Math.max(x, x1); y0 = Math.min(y, y0); y1 = Math.max(y, y1);
        neighbors(j, w, n, push);
      }
      parts.push({ count, x0, x1, y0, y1 });
    }
    const good = parts.map((part, i) => {
      if (!part || part.count < n * .003) return 0;
      const { x0, x1, y0, y1 } = part;
      const wide = x1 - x0 > w * .84, tall = y1 - y0 > h * .84;
      const middle = (x0 + x1) / (2 * w), center = (y0 + y1) / (2 * h);
      return !(wide && tall) && middle > .12 && middle < .88 && center > .11 && center < .89 ? part.count : 0;
    });
    const biggest = good.reduce((a, v) => Math.max(a, v), 0);
    if (biggest < n * .022 || biggest > n * .74) return null;
    const keep = good.map((v) => v >= biggest * .065);
    // Fill enclosed icing. A separate shape such as the space between two cookies remains transparent.
    const outside = new Uint8Array(n);
    let length = 0;
    const queue = (j) => { if (!keep[label[j]] && !outside[j]) { outside[j] = 1; stack[length++] = j; } };
    for (let x = 0; x < w; x++) { queue(x); queue((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { queue(y * w); queue(y * w + w - 1); }
    for (let i = 0; i < length; i++) neighbors(stack[i], w, n, queue);
    const output = ctx.createImageData(w, h);
    for (let i = 0; i < n; i++) {
      if (outside[i]) continue;
      let edge = false;
      neighbors(i, w, n, (j) => { if (outside[j]) edge = true; });
      output.data[i * 4 + 3] = edge ? 110 : 255;
    }
    ctx.putImageData(output, 0, 0);
    const isolated = createCanvas(source.width, source.height), cut = isolated.getContext('2d');
    cut.drawImage(source, 0, 0);
    cut.globalCompositeOperation = 'destination-in';
    cut.drawImage(sample, 0, 0, isolated.width, isolated.height);
    return isolated;
  }

  function card(subject) {
    const { width: w, height: h } = subject;
    const data = subject.getContext('2d').getImageData(0, 0, w, h).data;
    let left = w, right = 0, top = h, bottom = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 110) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right <= left || bottom <= top) return null;
    const sw = right - left + 1, sh = bottom - top + 1, size = window.NTC_CONFIG.cookiePhotoSize;
    const ratio = Math.min(size * .85 / sw, size * .65 / sh);
    const output = createCanvas(size, size), ctx = output.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.shadowColor = 'rgba(106, 57, 67, .20)'; ctx.shadowBlur = 11; ctx.shadowOffsetY = 6;
    ctx.drawImage(subject, left, top, sw, sh, (size - sw * ratio) / 2, (size - sh * ratio) / 2, sw * ratio, sh * ratio);
    return output;
  }

  function encode(canvas, allowDownsize = false) {
    for (const quality of [.94, .88, .80, .72]) {
      const webp = canvas.toDataURL('image/webp', quality);
      if (webp.startsWith('data:image/webp') && webp.length < 370000) return webp;
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.length < 370000) return jpeg;
    }
    if (allowDownsize && Math.max(canvas.width, canvas.height) > 640) {
      const smaller = createCanvas(Math.max(1, Math.round(canvas.width * .75)), Math.max(1, Math.round(canvas.height * .75)));
      const ctx = smaller.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      return encode(smaller, true);
    }
    throw new Error('圖片太大，請換一張');
  }

  function trace(source) {
    return new Promise((resolve) => {
      const { el, close } = NTC.sheet(`
        <h2>圈選餅乾</h2>
        <p class="note">照片背景比較複雜。沿著餅乾外緣點選至少三點，再按「套用粉紅底」。</p>
        <div class="cookie-photo-outline"></div>
        <div class="row" style="gap:8px;margin-top:12px">
          <button type="button" class="btn ghost outline-undo">退一步</button>
          <button type="button" class="btn outline-save" disabled>套用粉紅底</button>
        </div>`);
      el.setAttribute('aria-label', '圈選餅乾');
      const preview = createCanvas(source.width, source.height);
      Object.assign(preview.style, { display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '52vh', margin: '8px auto', cursor: 'crosshair' });
      el.querySelector('.cookie-photo-outline').append(preview);
      const undo = el.querySelector('.outline-undo'), save = el.querySelector('.outline-save');
      const points = [], ctx = preview.getContext('2d');
      const path = (g) => { g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
      function paint() {
        ctx.clearRect(0, 0, preview.width, preview.height);
        ctx.drawImage(source, 0, 0);
        if (points.length) {
          path(ctx);
          ctx.strokeStyle = '#f52d70'; ctx.lineWidth = Math.max(2, preview.width / 180); ctx.stroke();
          for (const [x, y] of points) { ctx.beginPath(); ctx.arc(x, y, Math.max(3, preview.width / 125), 0, Math.PI * 2); ctx.fillStyle = '#f52d70'; ctx.fill(); }
        }
        save.disabled = points.length < 3; undo.disabled = !points.length;
      }
      preview.addEventListener('click', (event) => {
        const bounds = preview.getBoundingClientRect();
        points.push([(event.clientX - bounds.left) * preview.width / bounds.width, (event.clientY - bounds.top) * preview.height / bounds.height]);
        paint();
      });
      undo.onclick = () => { points.pop(); paint(); };
      save.onclick = () => {
        const subject = createCanvas(source.width, source.height), g = subject.getContext('2d');
        path(g); g.clip(); g.drawImage(source, 0, 0);
        const result = card(subject);
        if (!result) { NTC.toast('請多圈幾個餅乾外緣的點'); return; }
        close(); resolve(result);
      };
      el.querySelector('.close').addEventListener('click', () => resolve(null));
      el.previousElementSibling.addEventListener('click', () => resolve(null));
      paint();
    });
  }

  NTC.cookiePhoto = {
    async prepareSeries(file) {
      // The storefront crops the preview to 4:3. Keep the full scene for gallery zoom.
      const source = await load(file, 1200);
      const ctx = source.getContext('2d');
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fffaf7';
      ctx.fillRect(0, 0, source.width, source.height);
      return encode(source, true);
    },
    // The same function serves new options, existing replacements and catalog preparation.
    async prepare(file, { allowTrace = true } = {}) {
      const full = await load(file), inner = trim(full);
      let source = inner, subject = mask(inner);
      if (!subject && inner !== full) { source = full; subject = mask(full); } // trimming did not help: carry on with the whole picture
      const canvas = (subject && card(subject)) || (allowTrace ? await trace(source) : null);
      return canvas ? encode(canvas) : null;
    },
  };
})();
