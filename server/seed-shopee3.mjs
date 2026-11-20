// 11-21 店主：「直接從我的蝦皮拿單片的圖」。shopee3-plan.json＝她蝦皮每個選項的名稱、單片價格、她修過的單片圖（做成粉紅底卡片）。
//   new：還沒有單片的系列 → 新增並上架（已經有同 id 的不動）。
//   update：11-20 用截圖去背做的那些 → 換成她的圖／名稱／價格。只改「從那之後沒被動過」的（名稱、價格、照片都還是原樣），她自己改過的不碰。
//   node seed-shopee3.mjs ntcookie-qa|ntcookie-dev [--dry]
import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.argv[2]; const DRY = process.argv.includes('--dry');
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '')) { console.error('usage: node seed-shopee3.mjs ntcookie-qa|ntcookie-dev [--dry]'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const plan = JSON.parse(readFileSync(new URL('./shopee3-plan.json', import.meta.url)));
const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, ProjectionExpression: 'cookie' }))).Item;
const seriesIds = new Set((s?.cookie?.series || []).map((x) => x.id));
const now = new Date().toISOString(); const by = {}; let added = 0, there = 0, noSeries = 0, changed = 0, kept = 0;
for (const p of plan.new) {
  if (!seriesIds.has(p.series)) { noSeries++; continue; }
  const { id, series, name, price, photo, sort, ...text } = p;
  const item = { pk: 'PRODUCT', sk: id, id, category: 'cookie', series, name, price, unit: '片', photo, sort, active: true, soldOut: false, createdAt: now, updatedAt: now, ...text };
  if (DRY) { added++; by[series] = (by[series] || 0) + 1; continue; }
  try { await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(pk)' })); added++; by[series] = (by[series] || 0) + 1; }
  catch (e) { if (e.name === 'ConditionalCheckFailedException') there++; else throw e; }
}
console.log(`${DRY ? '[dry] ' : ''}新增並上架 ${added} 片（已經有 ${there}、系列不存在 ${noSeries}）:`, Object.entries(by).map(([k, v]) => `${k} ${v}`).join('、'));
const left = [];
for (const u of plan.update) {
  const set = []; const names = { '#n': 'name', '#p': 'price', '#ph': 'photo' }; const vals = { ':en': u.expect.name, ':ep': u.expect.price, ':eph': u.expect.photo, ':u': now };
  if (u.set.name !== undefined) { set.push('#n = :n'); vals[':n'] = u.set.name; }
  if (u.set.price !== undefined) { set.push('#p = :p'); vals[':p'] = u.set.price; }
  if (u.set.photo !== undefined) { set.push('#ph = :ph'); vals[':ph'] = u.set.photo; }
  if (DRY) { changed++; continue; }
  try { await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'PRODUCT', sk: u.id }, UpdateExpression: `SET ${set.join(', ')}, updatedAt = :u`,
    ConditionExpression: 'attribute_exists(pk) AND #n = :en AND #p = :ep AND #ph = :eph', ExpressionAttributeNames: names, ExpressionAttributeValues: vals })); changed++; }
  catch (e) { if (e.name === 'ConditionalCheckFailedException') { kept++; left.push(`${u.series}／${u.expect.name}`); } else throw e; }
}
console.log(`${DRY ? '[dry] ' : ''}換成蝦皮的圖／名稱／價格 ${changed} 片；已經被改過或不存在、沒動 ${kept} 片${left.length ? '：' + left.join('、') : ''}`);
