// 把指定系列裡「未上架」的餅乾全部上架（也可以指定單片 id）。只改 active，不碰價格、名稱、照片；已經上架的不動。
//   node publish-series.mjs ntcookie-qa|ntcookie-dev <seriesId|cookie-id> ...
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const [TABLE, ...want] = process.argv.slice(2);
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '') || !want.length) { console.error('usage: node publish-series.mjs ntcookie-qa|ntcookie-dev <seriesId|cookie-id> ...'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const all = []; let key;
do { const r = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'PRODUCT' }, ExclusiveStartKey: key })); all.push(...r.Items); key = r.LastEvaluatedKey; } while (key);
const pick = all.filter((p) => p.category === 'cookie' && !p.active && (want.includes(p.series) || want.includes(p.id)));
const now = new Date().toISOString(); let n = 0;
for (const p of pick) {
  try { await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'PRODUCT', sk: p.id }, UpdateExpression: 'SET active = :t, updatedAt = :u', ConditionExpression: 'active = :f', ExpressionAttributeValues: { ':t': true, ':f': false, ':u': now } })); n++; }
  catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e; }
}
const by = {}; for (const p of pick) by[p.series] = (by[p.series] || 0) + 1;
console.log(`上架 ${n} 片:`, Object.entries(by).map(([k, v]) => `${k} ${v}`).join('、') || '（沒有要上架的）');
