// 第一次上架：把設計稿上的 8 種可麗露＋5 種馬林糖寫進資料表（已存在的商品不覆蓋）。用法：node seed.mjs ntcookie-dev
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2] || 'ntcookie-dev';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const C = 'assets/v2/01-canele/', M = 'assets/v2/02-meringue/';
const canele = [
  ['original', '經典原味', 750], ['mixed-berries', '綜合野莓', 790], ['honey-pistachio', '蜂蜜開心果', 790], ['hazelnut-chocolate', '榛果巧克力', 790],
  ['matcha', '小山園抹茶', 790], ['thai-tea', '手標泰奶', 790], ['cinnamon-apple', '肉桂蘋果泥', 790], ['salted-caramel', '焦糖海鹽', 790],
].map(([slug, name, price], i) => {
  const f = `${String(i + 1).padStart(2, '0')}-${slug}`;
  return { id: `canele-${slug}`, category: 'canele', name, price, unit: '盒', photo: `${C}photo-${f}.webp`, card: `${C}card-${f}.webp`, cardName: name, icon: `assets/v2/icons/canele-${slug}.webp`, sort: 10 + i };
});
const meringue = [
  ['butter', '原味奶油', 390, 'small'], ['matcha', '小山園抹茶', 450, 'small'], ['cocoa', '頂級可可', 450, 'small'],
  ['purple-sweet-potato', '天然紫薯', 420, 'wide'], ['cheese', '香濃起司(鹹餅)', 420, 'wide'],
].map(([slug, name, price, kind], i) => ({
  id: `meringue-${slug}`, category: 'meringue', name, price, unit: '罐', photo: `${M}photo-${slug}.webp`, card: `${M}card-${slug}.webp`,
  cardName: name, cardPrice: price, cardKind: kind, icon: `assets/v2/icons/meringue-${slug}.webp`, sort: 10 + i,
}));
const now = new Date().toISOString();
for (const p of [...canele, ...meringue]) {
  try {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'PRODUCT', sk: p.id, ...p, active: true, soldOut: false, createdAt: now }, ConditionExpression: 'attribute_not_exists(pk)' }));
    console.log('added', p.id);
  } catch (e) { console.log(e.name === 'ConditionalCheckFailedException' ? 'exists ' + p.id : e.message); }
}
