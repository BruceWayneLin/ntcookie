// 把指定單片的照片換掉：只在「照片還是原本那一張」時才換（她自己又改過就不動）。只改 photo。
//   node set-photos.mjs ntcookie-qa|ntcookie-dev <json>     json = [{ id, from, to }]
import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const [TABLE, file] = process.argv.slice(2);
if (!/^ntcookie-(qa|dev)$/.test(TABLE || '') || !file) { console.error('usage: node set-photos.mjs ntcookie-qa|ntcookie-dev <json>'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' })); const now = new Date().toISOString(); let n = 0, kept = 0;
for (const u of JSON.parse(readFileSync(file))) {
  try { await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: 'PRODUCT', sk: u.id }, UpdateExpression: 'SET photo = :to, updatedAt = :u', ConditionExpression: 'photo = :from', ExpressionAttributeValues: { ':to': u.to, ':from': u.from, ':u': now } })); n++; }
  catch (e) { if (e.name === 'ConditionalCheckFailedException') kept++; else throw e; }
}
console.log(`照片換好 ${n} 片；已經被改過、沒動 ${kept} 片`);
