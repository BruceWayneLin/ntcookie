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
  NTC.shopTileArt = (key, photo) => {
    const lines = captions[key];
    if (!lines) return photo;
    return `<span class="shop-tile-art" data-art="${key}" aria-hidden="true">
      ${photo}
      <span class="shop-tile-title">${lines.map(line => `<span>${line}</span>`).join('')}</span>
    </span>`;
  };
})();
