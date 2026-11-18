#!/bin/bash
# 部署 ntcookie API 到 AWS（東京）。用法：./deploy.sh dev|prod
# 第一次會建：DynamoDB 資料表、IAM role、Lambda、Function URL。之後只更新程式碼。
# 金流／LINE 的密鑰放在 server/.env.<stage>（不進 git），格式 KEY=VALUE 一行一個。
set -euo pipefail
STAGE=${1:?dev or prod}
REGION=ap-northeast-1
FN=ntcookie-api$([ "$STAGE" = prod ] || echo "-$STAGE")
TABLE=ntcookie$([ "$STAGE" = prod ] || echo "-$STAGE")
ROLE=ntcookie-api-role
cd "$(dirname "$0")"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if ! aws dynamodb describe-table --region $REGION --table-name $TABLE >/dev/null 2>&1; then
  aws dynamodb create-table --region $REGION --table-name $TABLE --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S AttributeName=gsi1pk,AttributeType=S AttributeName=gsi1sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes 'IndexName=gsi1,KeySchema=[{AttributeName=gsi1pk,KeyType=HASH},{AttributeName=gsi1sk,KeyType=RANGE}],Projection={ProjectionType=ALL}' >/dev/null
  aws dynamodb wait table-exists --region $REGION --table-name $TABLE
  aws dynamodb update-continuous-backups --region $REGION --table-name $TABLE --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null || true
  echo "table $TABLE created"
fi

if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10
  echo "role $ROLE created"
fi
aws iam put-role-policy --role-name $ROLE --policy-name ntcookie-tables --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",\"dynamodb:Query\"],\"Resource\":[\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/ntcookie\",\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/ntcookie/index/*\",\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/ntcookie-*\",\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/ntcookie-*/index/*\"]}]}"

rm -f /tmp/ntcookie-api.zip && zip -q -j /tmp/ntcookie-api.zip index.mjs
if ! aws lambda get-function --region $REGION --function-name $FN >/dev/null 2>&1; then
  aws lambda create-function --region $REGION --function-name $FN --runtime nodejs22.x --architectures arm64 \
    --handler index.handler --role arn:aws:iam::$ACCOUNT:role/$ROLE --zip-file fileb:///tmp/ntcookie-api.zip \
    --memory-size 256 --timeout 20 --environment "Variables={TABLE=$TABLE}" >/dev/null
  aws lambda wait function-active-v2 --region $REGION --function-name $FN
  aws lambda create-function-url-config --region $REGION --function-name $FN --auth-type NONE \
    --cors '{"AllowOrigins":["https://brucewaynelin.github.io","http://localhost:8765","http://127.0.0.1:8765","http://192.168.50.50:8765"],"AllowMethods":["GET","POST","PUT","PATCH","DELETE"],"AllowHeaders":["content-type","authorization","x-dev-user","x-dev-key"],"MaxAge":3600}' >/dev/null
  aws lambda add-permission --region $REGION --function-name $FN --statement-id public-url --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  ( [ -d node_modules ] || npm install --silent ) && node add-url-permission.mjs $FN
  echo "function $FN created"
else
  aws lambda update-function-code --region $REGION --function-name $FN --zip-file fileb:///tmp/ntcookie-api.zip >/dev/null
  aws lambda wait function-updated-v2 --region $REGION --function-name $FN
fi
URL=$(aws lambda get-function-url-config --region $REGION --function-name $FN --query FunctionUrl --output text)
URL=${URL%/}

# environment: TABLE + API_URL + everything in .env.<stage> (JSON, so values may contain commas)
python3 - "$TABLE" "$URL" ".env.$STAGE" > /tmp/ntcookie-env.json <<'PY'
import json, sys, os
table, url, envfile = sys.argv[1:4]
v = {"TABLE": table, "API_URL": url}
if os.path.exists(envfile):
    for line in open(envfile, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, val = line.split("=", 1); v[k.strip()] = val.strip()
print(json.dumps({"Variables": v}))
PY
aws lambda update-function-configuration --region $REGION --function-name $FN --environment file:///tmp/ntcookie-env.json >/dev/null
rm -f /tmp/ntcookie-env.json
aws lambda wait function-updated-v2 --region $REGION --function-name $FN
echo "$FN → $URL"
curl -s "$URL/" ; echo
