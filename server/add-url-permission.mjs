// AWS now needs lambda:InvokeFunction (via function URL only) besides InvokeFunctionUrl; the brew CLI here is too old for that flag.
import { LambdaClient, AddPermissionCommand } from '@aws-sdk/client-lambda';
const c = new LambdaClient({ region: 'ap-northeast-1' });
try {
  await c.send(new AddPermissionCommand({ FunctionName: process.argv[2], StatementId: 'public-invoke', Action: 'lambda:InvokeFunction', Principal: '*', InvokedViaFunctionUrl: true }));
  console.log('invoke permission added');
} catch (e) { console.log(e.name === 'ResourceConflictException' ? 'invoke permission already there' : e.message); }
