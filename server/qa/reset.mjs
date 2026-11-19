// Wipe orders/counters/users/products from a QA table (then seed.mjs puts the 13 design products back).
// It deletes data, so it only runs on a table whose name ends in "-qa" (the live shop uses another table).
//   node qa/reset.mjs ntcookie-qa
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const T = process.argv[2];
if (!T || !T.endsWith('-qa')) { console.error('refusing: pass a table name ending in -qa (got ' + T + ')'); process.exit(2); }
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-1' }));
let n = 0;
for (const pk of ['ORDER', 'COUNTER', 'DATE', 'USER', 'PRODUCT', 'IMG', 'LOGINFAIL', 'LOOKUPFAIL', 'ADMINREQ', 'BINDFAIL', 'INQUIRY', 'INQRATE']) { // products are re-created by seed.mjs right after
  const r = await ddb.send(new QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': pk }, ProjectionExpression: 'pk, sk' }));
  for (const it of r.Items || []) { await ddb.send(new DeleteCommand({ TableName: T, Key: { pk: it.pk, sk: it.sk } })); n++; }
}
await ddb.send(new UpdateCommand({ TableName: T, Key: { pk: 'SETTINGS', sk: 'main' }, UpdateExpression: 'SET closedWeekdays = :e, blockedDates = :e, maxOrdersPerDay = :z, admins = :adm REMOVE adminPass, sessionSecret, passVersion, adminPhones, cookie, menuSubs',
  ExpressionAttributeValues: { ':e': [], ':z': 0, ':adm': [{ sub: 'Uqa-admin', name: 'QA店長', addedAt: new Date().toISOString() }] } }));
console.log('deleted', n, 'items — now run: node seed.mjs ' + T + ' && node seed-cookies.mjs ' + T);
