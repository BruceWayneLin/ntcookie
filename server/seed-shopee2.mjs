// 店主 11-20 下午傳來的 6 個蝦皮商品 → 草稿系列（全部「未上架」，她看過名稱和價格再上架）。
// 閃電麥坤／Crybaby／星之卡比：每片照片從她蝦皮的照片去背；瑪利歐／海賊王：照片在木頭和烤網上分不出來，只放封面，單片由她自己加；
// 單身派對：她說「丟慶生派對」→ 慶生・抓週；三種（內衣／內褲／丁丁）用照片裁切。價格：蝦皮單一價的直接用（卡比 230、Crybaby 250、派對 150），
// 有範圍的（閃電麥坤 200～280）先放 250。已經有的系列（同代號或同名）／餅乾不覆蓋；系列只用 list_append 加，不改到店主正在編的東西。
//   node seed-shopee2.mjs ntcookie-qa|ntcookie-dev
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2];
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '')) { console.error('usage: node seed-shopee2.mjs ntcookie-qa|ntcookie-dev'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const D = 'assets/cookies/shopee2/';
const T = { name: { textLabel: '寶寶名字', textMax: 6 }, namedate: { textLabel: '寶寶名字＋日期', textMax: 16 }, month: { textLabel: '月份文字', textMax: 12, textOptional: true }, words: { textLabel: '餅乾上的字', textMax: 12, textOptional: true }, cart: { textLabel: '推車上的字', textMax: 12, textOptional: true }, num: { textLabel: '數字', textMax: 2, textOptional: true } };
const SERIES = [ // id, name, groups, desc, price, pieces [slug, name, text]
  ['mcqueen', '閃電麥坤系列', ['character', 'birthday'], '閃電麥坤餅乾・慶生餅乾・車子', 250, [['mq-red', '閃電麥坤（紅）'], ['mq-blue', '閃電麥坤（藍）'], ['mq-yellow', '克魯茲（黃）'], ['mq-black', '暴風傑克森（黑）'], ['mq-rusteze', 'Rust-eze 圓牌'], ['mq-5', '數字 5', 'num']]],
  ['crybaby', 'Crybaby 系列（大片款）', ['birthday'], '泡泡瑪特 crybaby・大片款', 250, [['cb-bunny', '兔兔（粉紅）'], ['cb-bee', '小蜜蜂（咖啡）'], ['cb-frog', '青蛙（綠）'], ['cb-bear', '小熊（咖啡）'], ['cb-alice', '愛麗絲（藍）'], ['cb-duck', '小鴨（黃）']]],
  ['kirby', '星之卡比系列', ['character'], '星之卡比餅乾・收涎', 230, [['kb-cap', '卡比（紅帽）'], ['kb-hat', '毛帽'], ['kb-medal', '平安獎牌'], ['kb-plaque', '名字牌', 'name'], ['kb-pacifier', '奶嘴'], ['kb-bottle', '奶瓶'], ['kb-bib', '圍兜'], ['kb-onesie', '包屁衣'], ['kb-shoes', '鞋子（一雙）'], ['kb-cake', '生日蛋糕'], ['kb-stroller', '嬰兒車', 'cart']]],
  // 16:15 她說耀西「可以跟瑪利歐系列全部都在一起」→ 耀西那組放進瑪利歐系列（價格先 250）
  ['mario', '瑪利歐系列', ['character'], '瑪利歐收涎餅乾・瑪利歐賽車・瑪利兄弟・蘑菇人・耀西', 250, [['yo-yoshi', '耀西'], ['yo-plaque', '名字牌（Switch・耀西）', 'namedate'],
    ['yo-pacifier', '耀西奶嘴'], ['yo-bottle', '耀西奶瓶'], ['yo-bib', '耀西圍兜'], ['yo-onesie', '耀西包屁衣'], ['yo-hat', '耀西毛帽（4 months）', 'month'],
    ['yo-medal', '耀西平安獎牌'], ['yo-stroller', '耀西嬰兒車', 'cart']]],
  ['onepiece', '海賊王系列', ['character'], '海賊王收涎餅乾・魯夫・娜美・喬巴', 0, []],
  ['party', '單身派對系列', ['birthday'], '單身派對・派對餅乾・內衣餅乾・情趣餅乾・婚禮小物', 150, [['pt-bra', '內衣'], ['pt-pants', '內褲'], ['pt-ding', '丁丁']]],
  ['perry', '鴨嘴獸泰瑞系列', ['character'], '飛哥與小佛・糖霜餅乾', 220, [['pe-agent', '特務泰瑞（帽子）'], ['pe-heart', '泰瑞（愛心）'], ['pe-round-squint', '泰瑞（圓・瞇眼）'],
    ['pe-round-eyes', '泰瑞（圓・大眼）'], ['pe-square-squint', '泰瑞（方・瞇眼）'], ['pe-square-eyes', '泰瑞（方・大眼）']]],
  ['teletubbies', '天線寶寶系列', ['character'], '天線寶寶收涎餅乾・丁丁・迪西・拉拉・小波', 280, [['tt-tinky-heart', '丁丁（愛心）', 'words'], ['tt-tinky-round', '丁丁（圓形）', 'words'],
    ['tt-dipsy', '迪西（愛心）'], ['tt-laalaa', '拉拉（圓形）', 'words'], ['tt-po-hi', '小波（愛心・Hi）'], ['tt-po-round', '小波（圓形）']]],
  ['moomin', '嚕嚕米系列', ['character'], '姆明嚕嚕米・嚕嚕米收涎餅乾・小不點', 0, []], // 烤網上分不出單片：只放封面
  // 16:22 那批：文青少女、吉娃娃有單片；獨角獸／魷魚遊戲／阿奇／三眼怪在木頭或烤網上 → 只放封面；客製毛小孩＝聊聊附照片報價，只放她的範例照片
  ['girly', '文青少女繽紛收涎系列', ['character'], '文青少女・繽紛收涎餅乾', 220, [['gl-plaque', '名字牌', 'name'], ['gl-heart', '愛心日期牌', 'words'], ['gl-balloon', '熱氣球（4 months）', 'month'],
    ['gl-moon', '月亮'], ['gl-star', '星星'], ['gl-tutu', '芭蕾舞裙'], ['gl-horse', '搖搖馬'], ['gl-pacifier', '奶嘴'], ['gl-bottle', '奶瓶'], ['gl-bib', '圍兜'], ['gl-stroller', '嬰兒車', 'cart'], ['gl-omamori', '健康御守']]],
  ['chihuahua', '變種吉娃娃系列', ['character'], '變種吉娃娃・LINE 貼圖', 220, [['ch-square-shout', '吉娃娃（方・大叫）'], ['ch-square-yellow', '吉娃娃（方・黃）'], ['ch-square-cap', '吉娃娃（方・浴帽）'],
    ['ch-round-pink', '吉娃娃（圓・粉）'], ['ch-round-yellow', '吉娃娃（圓・黃）'], ['ch-round-blue', '吉娃娃（圓・藍）']]],
  ['unicorn', '獨角獸系列', ['character'], '獨角獸收涎餅乾・慶生餅乾', 0, []],
  ['squid', '魷魚遊戲系列', ['character'], '魷魚遊戲・椪糖餅乾・123 木頭人・紅士兵', 0, []],
  ['duggee', '阿奇幼幼園系列', ['character', 'birthday'], '阿奇幼幼園・慶生餅乾（此款尺寸偏小）', 0, []],
  ['aliens', '三眼怪系列', ['character'], '三眼怪・收涎餅乾・慶生餅乾・蛋糕裝飾', 0, []],
  ['pets', '客製毛小孩餅乾', ['character'], '照您的毛小孩照片手繪。請先到「客製詢問」附上照片，我們報價後再製作。', 0, [], ['pet0', 'pet1', 'pet2', 'pet3', 'pet4', 'pet5']],
  // 16:27 那批（都在烤網上 → 只放封面）；冰雪奇緣她說「慶生的」
  ['sakura', '庫洛魔法使系列', ['character'], '庫洛魔法使・小櫻・小可・法杖', 0, []],
  ['tsum', 'TSUM 公主系列', ['character'], '公主收涎餅乾・tsum・女寶收涎餅乾', 0, []],
  ['marimekko', 'marimekko 罌粟花系列', ['birthday'], 'marimekko 罌粟花・慶生餅乾', 0, []],
  ['frozen', '冰雪奇緣系列', ['birthday'], '冰雪奇緣・艾莎公主・安娜公主・雪寶・慶生餅乾', 0, []],
  ['totoro', '龍貓系列', ['character'], '龍貓收涎餅乾・慶生餅乾・豆豆龍・宮崎駿・龍貓車', 0, []], // 木頭＋烤網上分不出單片：只放封面
  // 16:08 她說「也是中國風，價錢你都先寫單片 250，我到時候再自己改」；兩片一樣的春斗方、兩個一樣的錢幣各放一個
  ['newyear', '過年系列', ['chinese'], '過年餅乾・過年糖霜餅乾・伴手禮', 250, [['ny-spring', '春'], ['ny-fu', '福'], ['ny-spring-r', '春 斗方'], ['ny-cloud', '旺年雲朵牌（2018）'],
    ['ny-dog', '臘腸狗（2018）'], ['ny-firecracker', '鞭炮（發）'], ['ny-lantern', '燈籠（春）'], ['ny-omamori', '招財御守'], ['ny-coin1', '招財進寶錢幣'],
    ['ny-ingot-wang', '元寶（旺）'], ['ny-ingot-cai', '元寶（財）'], ['ny-zhong', '麻將・中'], ['ny-fa', '麻將・發'], ['ny-dice2', '骰子（二點）'], ['ny-dice5', '骰子（五點）']]],
];
const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' } }))).Item;
if (!s?.cookie?.series) throw new Error('no cookie settings yet');
const have = s.cookie.series; let sort = Math.max(0, ...have.map((x) => x.sort || 0));
const groupIds = new Set((s.cookie.groups?.length ? s.cookie.groups : [{ id: 'character' }, { id: 'birthday' }]).map((g) => g.id));
const add = []; const ids = {};
for (const [id, name, groups, desc, , , gallery] of SERIES) {
  const old = have.find((x) => x.id === id || x.name === name);
  if (old) { ids[id] = old.id; continue; }
  ids[id] = id;
  const photos = (gallery || [id]).map((g) => `${D}hero-${g}.webp`);
  add.push({ id, name, desc, lines: ['可單片選購・自由搭配'], photo: photos[0], photos, groups: groups.filter((g) => groupIds.has(g)), sort: (sort += 10) });
}
if (add.length) await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET #c.#s = list_append(#c.#s, :n)',
  ExpressionAttributeNames: { '#c': 'cookie', '#s': 'series' }, ExpressionAttributeValues: { ':n': add } }));
console.log(`series added ${add.length} (already there ${SERIES.length - add.length})`);
const now = new Date().toISOString(); let n = 0, kept = 0;
for (const [id, , , , price, pieces] of SERIES) for (const [i, [slug, name, text]] of pieces.entries()) {
  const pid = `cookie-${id}-${slug}`;
  const item = { pk: 'PRODUCT', sk: pid, id: pid, category: 'cookie', series: ids[id], name, price, unit: '片', photo: `${D}${slug}.webp`, sort: (i + 1) * 10, active: false, soldOut: false, createdAt: now, updatedAt: now, ...(text ? T[text] : {}) };
  try { await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(pk)' })); n++; }
  catch (e) { if (e.name === 'ConditionalCheckFailedException') kept++; else throw e; }
}
console.log(`pieces added ${n}, already there ${kept} (all 未上架)`);
