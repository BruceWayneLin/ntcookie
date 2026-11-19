// 造型餅乾系列（cookie-series.json，由設計師切圖產生）寫進資料表：新系列預設「未上架」＝只有管理員看得到；
// 新餅乾價格先放 $250（店主在後台改）。已經有的系列／餅乾不覆蓋。用法：node seed-cookies.mjs ntcookie-dev
import fs from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2] || 'ntcookie-dev';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const D = 'assets/cookies/anpanman/';
const ANPANMAN = { id: 'anpanman', name: '麵包超人系列', lines: ['可單片選購・自由搭配', '生日・收涎・派對・送禮'], photo: `${D}hero.webp`, groups: ['character', 'birthday'], active: false, sort: 10 };
const AP = [
  ['anpanman', '麵包超人', 250], ['baikinman', '細菌人', 220], ['shokupanman', '吐司超人', 200], ['currypanman', '咖哩包超人', 200], ['uncle-jam', '果 Jam 叔叔', 280], ['melonpanna', '蜜瓜包妹妹', 280],
  ['dokinchan', '紅精靈', 250], ['bib', '麵包兜兜', 250], ['stroller', '麵包推車', 280], ['bottle', '麵包奶瓶', 250], ['onesie', '麵包屁衣', 250], ['overalls', '吊帶短褲', 250],
  ['rattle', '麵包搖鈴', 220], ['pacifier', '細菌人奶嘴', 250], ['anpanman-full', '麵包超人（全身）', 320], ['baikinman-full', '細菌人（全身）', 280],
  ['name-plaque', '寶寶名字', 250, '寶寶名字＋日期', 16],
].map(([slug, name, price, textLabel, textMax], i) => ({ id: `cookie-anpanman-${slug}`, series: 'anpanman', name, price, photo: `${D}${slug}.webp`, sort: 10 + i, ...(textLabel ? { textLabel, textMax } : {}) }));
const more = JSON.parse(fs.readFileSync(new URL('./cookie-series.json', import.meta.url), 'utf8'));
const SERIES = [ANPANMAN, ...more.series]; const PIECES = [...AP, ...more.products];

const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' } }))).Item;
if (!s) throw new Error('settings missing: open the site once first');
const cookie = s.cookie || { minPieces: 6, shipping: { label: '黑貓宅配（造型餅乾）', tiers: [{ upTo: 8, fee: 130 }, { upTo: 999, fee: 170 }] }, series: [] };
const have = new Set((cookie.series || []).map((x) => x.id)); const add = SERIES.filter((x) => !have.has(x.id));
if (add.length) {
  cookie.series = [...(cookie.series || []), ...add];
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET #c = :c', ExpressionAttributeNames: { '#c': 'cookie' }, ExpressionAttributeValues: { ':c': cookie } }));
}
console.log(`series: added ${add.length} (hidden from customers), already there ${SERIES.length - add.length}`);
const now = new Date().toISOString(); let added = 0, kept = 0;
for (const p of PIECES) {
  try { await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'PRODUCT', sk: p.id, category: 'cookie', unit: '片', active: true, soldOut: false, createdAt: now, ...p }, ConditionExpression: 'attribute_not_exists(pk)' })); added++; }
  catch (e) { if (e.name === 'ConditionalCheckFailedException') kept++; else throw e; }
}
console.log(`pieces: added ${added}, already there ${kept}`);
