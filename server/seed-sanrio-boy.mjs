// 店主 11-20：新增「三麗鷗系列（男寶）」＝人魚漢頓那組＋酷企鵝／漢頓／雙子星那組（兩台一樣的嬰兒車只放一台）；
// 兩片雙子星也放進「三麗鷗系列（女寶）」(sanrio)。每片照片是從她的照片去背做的；價格她還沒給 → 全部「未上架」、先放 $250，
// 她在後台改好價格再上架。已經有的系列／餅乾不覆蓋。   node seed-sanrio-boy.mjs ntcookie-qa|ntcookie-dev
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2];
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '')) { console.error('usage: node seed-sanrio-boy.mjs ntcookie-qa|ntcookie-dev'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const D = 'assets/cookies/sanrio-boy/';
const BOY = { id: 'sanrio-boy', name: '三麗鷗系列（男寶）', desc: '人魚漢頓・酷企鵝・雙子星', lines: ['可單片選購・自由搭配', '收涎・生日・派對・送禮'],
  photo: `${D}hero-hangyodon.webp`, photos: [`${D}hero-hangyodon.webp`, `${D}hero-set.webp`], groups: ['character'] };
const T = { name: { textLabel: '寶寶名字', textMax: 6 }, date: { textLabel: '日期', textMax: 10 }, cart: { textLabel: '推車上的字', textMax: 12, textOptional: true }, month: { textLabel: '月份文字', textMax: 12, textOptional: true } };
const PIECES = [ // slug, name, text
  ['hy-tongue', '漢頓（吐舌頭）'], ['hy-octopus', '漢頓（抱章魚）'], ['hy-wave', '漢頓（揮手）'], ['bs-hangyodon', '漢頓（全身）'], ['bs-badtz', '酷企鵝'],
  ['twin-stars', '雙子星'], ['twin-star-4m', '雙子星（4 months 星星）', 'month'], ['hy-plaque', '名字牌（雲朵）', 'name'], ['bs-plaque', '酷企鵝名字牌', 'name'],
  ['hy-pacifier', '漢頓奶嘴（日期）', 'date'], ['bs-pacifier', '酷企鵝奶嘴（日期）', 'date'], ['hy-bottle', '漢頓奶瓶'], ['bs-bottle', '雙子星奶瓶'],
  ['hy-stroller', '漢頓嬰兒車', 'cart'], ['hy-hat', '漢頓毛帽（4 months）', 'month'], ['hy-onesie', '包屁衣'], ['hy-bib', '圍兜'], ['hy-medal', '平安獎牌'], ['hy-omamori', '健康御守'],
];
const GIRL_TWINS = ['twin-stars', 'twin-star-4m']; // 雙子星：男寶、女寶兩邊都放

const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' } }))).Item;
if (!s?.cookie?.series) throw new Error('no cookie settings yet');
const cookie = s.cookie; const series = cookie.series;
let boy = series.find((x) => x.id === BOY.id || x.name === BOY.name);
if (!boy) {
  const girl = series.find((x) => x.id === 'sanrio'); const at = girl ? (girl.sort ?? 40) + 1 : Math.max(0, ...series.map((x) => x.sort || 0)) + 10;
  boy = { ...BOY, sort: at };
  // append only (the owner may be saving in the admin right now: never rewrite the whole list)
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET #c.#s = list_append(#c.#s, :n)',
    ExpressionAttributeNames: { '#c': 'cookie', '#s': 'series' }, ExpressionAttributeValues: { ':n': [boy] } }));
  console.log('series added:', boy.name);
} else console.log('series already there:', boy.id, boy.name);
const now = new Date().toISOString(); let added = 0, kept = 0;
const add = async (sid, slug, name, text, sort) => {
  const id = `cookie-${sid}-${slug}`;
  const item = { pk: 'PRODUCT', sk: id, id, category: 'cookie', series: sid, name, price: 250, unit: '片', photo: `${D}${slug}.webp`, sort, active: false, soldOut: false, createdAt: now, updatedAt: now, ...(text ? T[text] : {}) };
  try { await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(pk)' })); added++; }
  catch (e) { if (e.name === 'ConditionalCheckFailedException') kept++; else throw e; }
};
for (const [i, [slug, name, text]] of PIECES.entries()) await add(boy.id, slug, name, text, (i + 1) * 10);
if (series.some((x) => x.id === 'sanrio')) for (const [i, slug] of GIRL_TWINS.entries()) { const [, name, text] = PIECES.find((p) => p[0] === slug); await add('sanrio', slug, name, text, 800 + i * 10); }
console.log(`pieces: added ${added}, already there ${kept} (all 未上架, $250 until the owner sets prices)`);
