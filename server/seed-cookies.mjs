// 造型餅乾第一個系列：照店主範例稿的「麵包超人系列」17 片（價格照稿）。系列預設「未上架」＝只有管理員看得到，店主在後台打開才會給客人看。
// 已經有的系列／商品不覆蓋。用法：node seed-cookies.mjs ntcookie-dev
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2] || 'ntcookie-dev';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const D = 'assets/cookies/anpanman/';
const SERIES = { id: 'anpanman', name: '麵包超人系列', lines: ['可單片選購・自由搭配', '生日・收涎・派對・送禮'], photo: `${D}hero.webp`, groups: ['character', 'birthday'], active: false, sort: 10 };
const PIECES = [
  ['anpanman', '麵包超人', 250], ['baikinman', '細菌人', 220], ['shokupanman', '吐司超人', 200], ['currypanman', '咖哩包超人', 200], ['uncle-jam', '果 Jam 叔叔', 280], ['melonpanna', '蜜瓜包妹妹', 280],
  ['dokinchan', '紅精靈', 250], ['bib', '麵包兜兜', 250], ['stroller', '麵包推車', 280], ['bottle', '麵包奶瓶', 250], ['onesie', '麵包屁衣', 250], ['overalls', '吊帶短褲', 250],
  ['rattle', '麵包搖鈴', 220], ['pacifier', '細菌人奶嘴', 250], ['anpanman-full', '麵包超人（全身）', 320], ['baikinman-full', '細菌人（全身）', 280],
  ['name-plaque', '寶寶名字', 250, '寶寶名字＋日期', 16],
];
const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' } }))).Item;
if (!s) throw new Error('settings missing: open the site once first');
const cookie = s.cookie || { minPieces: 6, shipping: { label: '黑貓宅配（造型餅乾）', tiers: [{ upTo: 8, fee: 130 }, { upTo: 999, fee: 170 }] }, series: [] };
if (!(cookie.series || []).some((x) => x.id === SERIES.id)) {
  cookie.series = [...(cookie.series || []), SERIES];
  await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET #c = :c', ExpressionAttributeNames: { '#c': 'cookie' }, ExpressionAttributeValues: { ':c': cookie } }));
  console.log('added series', SERIES.id, '(hidden from customers)');
} else console.log('series exists', SERIES.id);
const now = new Date().toISOString();
for (const [i, [slug, name, price, textLabel, textMax]] of PIECES.entries()) {
  const id = `cookie-anpanman-${slug}`;
  const p = { pk: 'PRODUCT', sk: id, id, category: 'cookie', series: SERIES.id, name, price, unit: '片', photo: `${D}${slug}.webp`, active: true, soldOut: false, sort: 10 + i, createdAt: now, ...(textLabel ? { textLabel, textMax } : {}) };
  try { await ddb.send(new PutCommand({ TableName: TABLE, Item: p, ConditionExpression: 'attribute_not_exists(pk)' })); console.log('added', id); }
  catch (e) { console.log(e.name === 'ConditionalCheckFailedException' ? 'exists ' + id : e.message); }
}
