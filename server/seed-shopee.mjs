// 店主 11-20 傳來的 12 個蝦皮商品：先建成「草稿」系列（還沒有選項＝客人看不到），封面用她蝦皮的照片，
// 放進她在截圖上寫的分類：2＝中國風（新分類）、3＝卡通・收涎、4＝慶生・抓週。每一片的照片和價格由店主在後台「編輯商品」裡加。
// 已經有的分類／系列不覆蓋。   node seed-shopee.mjs ntcookie-qa|ntcookie-dev
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2];
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '')) { console.error('usage: node seed-shopee.mjs ntcookie-qa|ntcookie-dev'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const P = (slug) => [`assets/cookies/shopee/${slug}.webp`];
const SERIES = [ // id, name, groups, desc (from her Shopee listing titles)
  ['chinese', '中國風金飾收涎系列', ['chinese'], '新生兒喜氣・中國風金飾・傳統仿真收涎餅乾'],
  ['plaque', '巨型匾額收涎', ['chinese'], '超大片匾額收涎餅乾（10×18 公分）'],
  ['peppa', '佩佩豬系列', ['character'], '佩佩豬收涎餅乾・慶生餅乾・收口水'],
  ['snoopy', '史努比系列', ['character'], '史努比收涎餅乾・史努比・查理布朗'],
  ['chiikawa', '吉伊卡哇系列', ['character'], '大片款・吉伊卡哇收涎餅乾'],
  ['kimetsu', '鬼滅之刃系列', ['character'], '全身款・衣服升級需補差額'],
  ['dino', '恐龍系列', ['character'], '超大片・恐龍收涎餅乾・恐龍造型餅乾'],
  ['shinchan', '蠟筆小新系列', ['character'], '蠟筆小新收涎餅乾・小白・小葵・野原新之助'],
  ['animal', '動物派對系列', ['birthday'], '動物餅乾・慶生餅乾・週歲餅乾 party'],
  ['labubu', 'Labubu 拉布布系列', ['birthday'], '拉布布收涎餅乾・盲盒餅乾\n顏色客製請先私訊'],
  ['lotso', '熊抱哥・毛怪系列', ['birthday'], '熊抱哥・毛怪・怪獸電力公司・大眼仔\n慶生・收涎'],
  ['rilakkuma', '拉拉熊系列', ['birthday'], '拉拉熊收涎餅乾・慶生餅乾・收口水'],
];
const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' } }))).Item;
if (!s?.cookie?.series) throw new Error('no cookie settings yet');
const cookie = s.cookie;
const groups = cookie.groups?.length ? cookie.groups : [{ id: 'character', name: '卡通・收涎' }, { id: 'birthday', name: '慶生・抓週' }];
let gAdded = 0;
if (!groups.some((g) => g.id === 'chinese')) { groups.push({ id: 'chinese', name: '中國風' }); gAdded++; }
const have = new Set(cookie.series.map((x) => x.id));
let sort = Math.max(0, ...cookie.series.map((x) => x.sort || 0));
const names = new Set(cookie.series.map((x) => x.name)); // the owner may already have made a series with the same name by hand
const add = SERIES.filter(([id, name]) => !have.has(id) && !names.has(name)).map(([id, name, g, desc]) => ({ id, name, desc, lines: ['可單片選購・自由搭配'], photo: P(id)[0], photos: P(id), groups: g, sort: (sort += 10) }));
if (add.length || gAdded || !cookie.groups) {
  cookie.groups = groups; cookie.series = [...cookie.series, ...add];
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET #c = :c', ExpressionAttributeNames: { '#c': 'cookie' }, ExpressionAttributeValues: { ':c': cookie } }));
}
console.log(`groups added ${gAdded}, draft series added ${add.length} (already there ${SERIES.length - add.length})`);
