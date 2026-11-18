// wipe test orders/counters/users from the DEV table and put products/settings back to the design state
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const T = 'ntcookie-dev';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
let n = 0;
for (const pk of ['ORDER', 'COUNTER', 'DATE', 'USER']) {
  const r = await ddb.send(new QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': pk } }));
  for (const it of r.Items || []) { await ddb.send(new DeleteCommand({ TableName: T, Key: { pk: it.pk, sk: it.sk } })); n++; }
}
const prods = await ddb.send(new QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'PRODUCT' } }));
for (const p of prods.Items) await ddb.send(new UpdateCommand({ TableName: T, Key: { pk: 'PRODUCT', sk: p.sk }, UpdateExpression: 'SET active = :t, soldOut = :f', ExpressionAttributeValues: { ':t': true, ':f': false } }));
await ddb.send(new UpdateCommand({ TableName: T, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET closedWeekdays = :e, blockedDates = :e, bank = :b, admins = :e',
  ExpressionAttributeValues: { ':e': [], ':b': { name: '（示範）測試銀行', code: '000', account: '000123456789', holder: '示範帳戶・請勿轉帳' } } }));
console.log('deleted', n, 'items; products reset:', prods.Items.length);
