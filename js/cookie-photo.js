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

  async function load(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url;
      try { await img.decode(); }
      catch { throw new Error('這張照片讀不到，請換一張'); }
      const scale = Math.min(1, 1500 / Math.max(img.naturalWidth, img.naturalHeight));
      const result = createCanvas(Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)));
      result.getContext('2d').drawImage(img, 0, 0, result.width, result.height);
      return result;
    } finally { URL.revokeObjectURL(url); }
  }

  const median = (numbers) => numbers.sort((a, b) => a - b)[numbers.length >> 1];

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
    if (transparent > 6) return source;
    const [r, g, b] = rgb.map(median);
    // Reduce the influence of lightness so soft shadows stay with the discarded background.
    const distance = (p) => {
      const dr = pixels[p] - r, dg = pixels[p + 1] - g, db = pixels[p + 2] - b;
      return Math.hypot((dr + dg + db) / 4.5, (dr - dg) * .9, (db - dg) * .9);
    };
    const spread = fringe.map(distance).sort((a, b) => a - b);
    const drift = spread[Math.floor(spread.length * .8)];
    if (drift > 30) return null;
    const threshold = Math.max(14, drift * 1.7 + 6);
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
    const sw = right - left + 1, sh = bottom - top + 1, size = 900;
    const ratio = Math.min(size * .85 / sw, size * .65 / sh);
    const output = createCanvas(size, size), ctx = output.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.shadowColor = 'rgba(106, 57, 67, .20)'; ctx.shadowBlur = 11; ctx.shadowOffsetY = 6;
    ctx.drawImage(subject, left, top, sw, sh, (size - sw * ratio) / 2, (size - sh * ratio) / 2, sw * ratio, sh * ratio);
    return output;
  }

  function encode(canvas) {
    for (const quality of [.94, .88, .80, .72]) {
      const webp = canvas.toDataURL('image/webp', quality);
      if (webp.startsWith('data:image/webp') && webp.length < 370000) return webp;
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.length < 370000) return jpeg;
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
    // The same function serves new options, existing replacements and catalog preparation.
    async prepare(file, { allowTrace = true } = {}) {
      const source = await load(file), subject = mask(source);
      const canvas = (subject && card(subject)) || (allowTrace ? await trace(source) : null);
      return canvas ? encode(canvas) : null;
    },
  };
})();
