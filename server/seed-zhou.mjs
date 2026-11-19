// 抓週餅乾（店主 11-19）：兩個系列「抓週・男寶限定」「抓週・女寶限定」，每片 $220、直接上架（店主給的價格，之後她在後台改）。
// 男寶不放魔法棒、女寶不放手槍，其餘兩邊都有（店主可在後台各自上下架）。已經有的系列／餅乾不覆蓋。
// --regroup：把「卡通・收涎」和「慶生・抓週」分開（店主：兩邊點進去都一樣）——卡通系列只留在卡通・收涎。
//   node seed-zhou.mjs ntcookie-qa [--regroup]
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2]; const REGROUP = process.argv.includes('--regroup');
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '')) { console.error('usage: node seed-zhou.mjs ntcookie-qa|ntcookie-dev [--regroup]'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const D = 'assets/cookies/zhou/';
const PIECES = [ // slug, name — the order customers see
  ['gun', '手槍'], ['wand', '魔法棒'], ['rocket', '火箭'], ['plane', '飛機'], ['grad-cap', '學士帽'], ['book', '書本'], ['pencil', '鉛筆'], ['blackboard', '黑板'],
  ['scientist', '科學家'], ['calculator', '計算機'], ['abacus', '算盤'], ['ruler', '三角尺'], ['mouse', '滑鼠'], ['camera', '相機'], ['mic', '麥克風'], ['piano', '鋼琴'],
  ['palette', '調色盤'], ['clapper', '場記板'], ['medkit', '醫藥箱'], ['gavel', '法官槌'], ['compass', '指南針'], ['medal', '金牌'], ['ingot', '元寶'], ['noodles', '長壽麵'],
];
const SERIES = [
  { id: 'zhou-boy', name: '抓週・男寶限定', lines: ['每片 $220・可單片自由搭配', '抓週・周歲・收涎'], photo: `${D}hero-boy.webp`, groups: ['birthday'], active: false, sort: 1, skip: 'wand' },
  { id: 'zhou-girl', name: '抓週・女寶限定', lines: ['每片 $220・可單片自由搭配', '抓週・周歲・收涎'], photo: `${D}hero-girl.webp`, groups: ['birthday'], active: false, sort: 2, skip: 'gun' },
];
const CHARACTER_ONLY = ['anpanman', 'toystory', 'pokemon', 'sanrio', 'penguin', 'space', 'tomjerry', 'basketball'];

const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' } }))).Item;
if (!s?.cookie?.series) throw new Error('no cookie series yet: run seed-cookies.mjs first');
const cookie = s.cookie; const have = new Set(cookie.series.map((x) => x.id));
const add = SERIES.filter((x) => !have.has(x.id)).map(({ skip, ...x }) => x);
let regrouped = 0;
if (REGROUP) for (const x of cookie.series) if (CHARACTER_ONLY.includes(x.id) && JSON.stringify(x.groups) !== '["character"]') { x.groups = ['character']; regrouped++; }
if (add.length || regrouped) {
  cookie.series = [...cookie.series, ...add];
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET #c = :c', ExpressionAttributeNames: { '#c': 'cookie' }, ExpressionAttributeValues: { ':c': cookie } }));
}
console.log(`series: added ${add.length}, regrouped ${regrouped}`);
const now = new Date().toISOString(); let added = 0, kept = 0;
for (const se of SERIES) {
  let i = 0;
  for (const [slug, name] of PIECES) {
    if (slug === se.skip) continue;
    const item = { pk: 'PRODUCT', sk: `cookie-${se.id}-${slug}`, id: `cookie-${se.id}-${slug}`, category: 'cookie', series: se.id, name, price: 220, unit: '片', photo: `${D}${slug}.webp`, sort: 10 + i++, active: true, soldOut: false, createdAt: now };
    try { await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(pk)' })); added++; }
    catch (e) { if (e.name === 'ConditionalCheckFailedException') kept++; else throw e; }
  }
}
console.log(`pieces: added ${added}, already there ${kept}`);
