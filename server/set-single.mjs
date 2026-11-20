// 把一個系列設成「一片就可以訂」（或取消）。只改那一個系列的那一個欄位。   node set-single.mjs ntcookie-qa|ntcookie-dev <seriesId> [off]
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const [TABLE, sid, off] = process.argv.slice(2);
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '') || !sid) { console.error('usage: node set-single.mjs ntcookie-qa|ntcookie-dev <seriesId> [off]'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
const s = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' }, ProjectionExpression: 'cookie.series' }))).Item;
const i = s.cookie.series.findIndex((x) => x.id === sid); if (i < 0) throw new Error('no such series: ' + sid);
await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'SETTINGS', sk: 'main' },
  UpdateExpression: off ? `REMOVE cookie.series[${i}].single` : `SET cookie.series[${i}].single = :t`, ConditionExpression: `cookie.series[${i}].id = :id`,
  ExpressionAttributeValues: off ? { ':id': sid } : { ':id': sid, ':t': true } }));
console.log(`${s.cookie.series[i].name}: 一片就可以訂 = ${!off}`);
