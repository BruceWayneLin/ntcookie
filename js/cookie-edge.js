// Clean the edge of a cut-out cookie before it goes on the shop's pink card.
// The cut keeps the outermost pixels of the cookie, and those are a mix of cookie and the old background
// (white paper, a grey shadow, another pink). On the pink card that mix shows as a pale line round the cookie.
// Here each edge pixel is un-mixed: how much of it is cookie (its opacity) and what the cookie's own colour is,
// using the background and the cookie right next to it. Nothing is ever added outside the cut, only cleaned or thinned.
(function () {
  const NTC = (window.NTC = window.NTC || {});

  // mean of a masked plane over a (2r+1)² window: box blur of value×mask and of mask, done in place
  function box(plane, w, h, r, line) {
    for (let y = 0; y < h; y++) { // rows
      const o = y * w; let sum = 0;
      for (let x = 0; x <= r && x < w; x++) sum += plane[o + x];
      for (let x = 0; x < w; x++) {
        line[x] = sum;
        if (x + r + 1 < w) sum += plane[o + x + r + 1];
        if (x - r >= 0) sum -= plane[o + x - r];
      }
      for (let x = 0; x < w; x++) plane[o + x] = line[x];
    }
    for (let x = 0; x < w; x++) { // columns
      let sum = 0;
      for (let y = 0; y <= r && y < h; y++) sum += plane[y * w + x];
      for (let y = 0; y < h; y++) {
        line[y] = sum;
        if (y + r + 1 < h) sum += plane[(y + r + 1) * w + x];
        if (y - r >= 0) sum -= plane[(y - r) * w + x];
      }
      for (let y = 0; y < h; y++) plane[y * w + x] = line[y];
    }
  }

  // how many pixels each pixel of `from` is away from the nearest pixel of the other kind (1…cap), 0 for the other kind
  function depth(from, w, h, cap) {
    const n = w * h, d = new Uint8Array(n); let front = [];
    for (let i = 0; i < n; i++) {
      if (!from[i]) continue;
      const x = i % w;
      if ((x && !from[i - 1]) || (x < w - 1 && !from[i + 1]) || (i >= w && !from[i - w]) || (i < n - w && !from[i + w]) || !x || x === w - 1 || i < w || i >= n - w) { d[i] = 1; front.push(i); }
    }
    for (let k = 2; k <= cap && front.length; k++) {
      const next = [];
      for (const i of front) {
        const x = i % w;
        if (x && from[i - 1] && !d[i - 1]) { d[i - 1] = k; next.push(i - 1); }
        if (x < w - 1 && from[i + 1] && !d[i + 1]) { d[i + 1] = k; next.push(i + 1); }
        if (i >= w && from[i - w] && !d[i - w]) { d[i - w] = k; next.push(i - w); }
        if (i < n - w && from[i + w] && !d[i + w]) { d[i + w] = k; next.push(i + w); }
      }
      front = next;
    }
    for (let i = 0; i < n; i++) if (from[i] && !d[i]) d[i] = cap + 1; // deeper than we looked
    return d;
  }

  // source: the whole picture (opaque). subject: the same picture with everything but the cookie made transparent.
  NTC.cookieEdge = function (source, subject) {
    try {
      const W = source.width, H = source.height;
      if (subject === source || subject.width !== W || subject.height !== H) return subject;
      const cut = subject.getContext('2d').getImageData(0, 0, W, H).data;
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cut[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < x0) return subject;
      const band = Math.max(2, Math.min(7, Math.round(Math.max(W, H) / 540 * 2.2))); // how deep the mixed pixels can reach (the cut was made on a 540 px copy)
      const reach = band * 2 + 2, pad = reach + 2;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
      const px = source.getContext('2d').getImageData(x0, y0, w, h).data;
      const a0 = new Uint8Array(n), solid = new Uint8Array(n), clear = new Uint8Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, a = cut[((y + y0) * W + x + x0) * 4 + 3];
        a0[i] = a; solid[i] = a >= 128 ? 1 : 0; clear[i] = a === 0 ? 1 : 0;
      }
      const inDepth = depth(solid, w, h, band + 1), outDepth = depth(clear, w, h, 3);
      // the colours of the cookie proper (deeper than the band) and of the plain background (clear of the cut) near each pixel:
      // the mean over a window, kept as bytes so the four working planes can be used twice (a phone has little memory to spare)
      const pw = new Float32Array(n), pr = new Float32Array(n), pg = new Float32Array(n), pb = new Float32Array(n), line = new Float32Array(Math.max(w, h));
      const near = (pick) => {
        for (let i = 0; i < n; i++) { const p = i * 4; if (pick(i)) { pw[i] = 1; pr[i] = px[p]; pg[i] = px[p + 1]; pb[i] = px[p + 2]; } else { pw[i] = 0; pr[i] = 0; pg[i] = 0; pb[i] = 0; } }
        for (const plane of [pw, pr, pg, pb]) box(plane, w, h, reach, line);
        const has = new Uint8Array(n), mean = new Uint8Array(n * 3);
        for (let i = 0; i < n; i++) if (pw[i] >= .5) { has[i] = 1; mean[i * 3] = pr[i] / pw[i]; mean[i * 3 + 1] = pg[i] / pw[i]; mean[i * 3 + 2] = pb[i] / pw[i]; }
        return { has, mean };
      };
      const F = near((i) => inDepth[i] > band), B = near((i) => outDepth[i] >= 3);
      const out = new ImageData(w, h), o = out.data;
      const alpha = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = i * 4, a = a0[i];
        if (!a) continue; // outside the cut: stays empty
        o[p] = px[p]; o[p + 1] = px[p + 1]; o[p + 2] = px[p + 2];
        if (inDepth[i] > band) { alpha[i] = 1; continue; } // the cookie proper
        const soft = a / 255;
        if (!F.has[i] || !B.has[i]) { alpha[i] = soft; continue; } // nothing to compare with nearby: leave as cut
        const Fr = F.mean[i * 3], Fg = F.mean[i * 3 + 1], Fb = F.mean[i * 3 + 2], Br = B.mean[i * 3], Bg = B.mean[i * 3 + 1], Bb = B.mean[i * 3 + 2];
        const dr = Fr - Br, dg = Fg - Bg, db = Fb - Bb, len = dr * dr + dg * dg + db * db;
        if (len < 34 * 34) { alpha[i] = soft; continue; } // cookie and background look alike here (white icing on white): the colours cannot tell them apart
        // how far this pixel has gone from the background towards the cookie
        let t = ((px[p] - Br) * dr + (px[p + 1] - Bg) * dg + (px[p + 2] - Bb) * db) / len;
        // a pixel that is not on the line between the two (another icing colour at the edge) is cookie, not a mix
        const er = px[p] - (Br + dr * t), eg = px[p + 1] - (Bg + dg * t), eb = px[p + 2] - (Bb + db * t);
        if (er * er + eg * eg + eb * eb > 38 * 38) t = 1;
        t = t < .08 ? 0 : t > .92 ? 1 : (t - .08) / .84;
        const al = Math.min(t, a < 128 ? soft * 1.6 : 1); // the outermost ring of the cut can only get thinner
        alpha[i] = al;
        if (al > 0 && al < 1) { // take the background's share out of the colour
          if (al >= .4) { o[p] = Math.max(0, Math.min(255, (px[p] - (1 - al) * Br) / al)); o[p + 1] = Math.max(0, Math.min(255, (px[p + 1] - (1 - al) * Bg) / al)); o[p + 2] = Math.max(0, Math.min(255, (px[p + 2] - (1 - al) * Bb) / al)); }
          else { o[p] = Fr; o[p + 1] = Fg; o[p + 2] = Fb; }
        }
      }
      for (let i = 0; i < n; i++) o[i * 4 + 3] = Math.round(alpha[i] * 255);
      const result = Object.assign(document.createElement('canvas'), { width: W, height: H });
      result.getContext('2d').putImageData(out, x0, y0);
      return result;
    } catch (e) { return subject; } // never lose a picture over the clean-up
  };
})();
