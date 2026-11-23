// The six house banners use the same live type. An uploaded banner is a complete design.
(() => {
  const captions = {
    'g-character': ['卡通・收涎', '造型餅乾'],
    'g-birthday': ['慶生・抓週', '造型餅乾'],
    meringue: ['馬林糖一口酥', '送禮小點'],
    canele: ['N.T Canelé', '可麗露專區'],
    'g-chinese': ['中國風', '造型餅乾'],
    custom: ['客製專區', '寵物・精品', '紀念造型'],
  };
  // a name longer than the house ones gets smaller type, so it still fits beside the picture (11-23 j)
  const fit = (lines) => { const w = Math.max(...lines.map((l) => [...String(l)].reduce((n, ch) => n + (/[\x20-\x7e]/.test(ch) ? 0.56 : 1), 0)));
    return w > 6.2 ? ` style="font-size:${(39 / (w * 1.04)).toFixed(2)}cqw"` : ''; };
  NTC.shopTileArt = (key, photo, own) => { // own: the owner's name and small lines (admin → 商品 → 分類設定)
    if (!captions[key]) return photo;
    const lines = own && own.length ? own : captions[key];
    return `<span class="shop-tile-art" data-art="${key}" aria-hidden="true">
      ${photo}
      <span class="shop-tile-title"${fit(lines)}>${lines.map(line => `<span>${line}</span>`).join('')}</span>
    </span>`;
  };
})();
