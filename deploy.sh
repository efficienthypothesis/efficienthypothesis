#!/usr/bin/env bash
# deploy.sh — Deploy efficienthypothesis.com to AWS
#
# Usage: bash deploy.sh
# Requires: AWS CLI v2, authenticated via `aws sso login --profile eh`
# Deploy time: ~10 seconds

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIP_FILE="/tmp/eh-deploy.zip"
S3_BUCKET="eh-app-data"
S3_KEY="deploy/efficienthypothesis-build.zip"
FUNCTION_NAME="efficienthypothesis-backend"
REGION="us-east-2"

echo "=== Building zip ==="
rm -f "$ZIP_FILE"
cd "$SCRIPT_DIR"
zip -r "$ZIP_FILE" app.py config.py chatbot_system_prompt.txt routes/ templates/ static/ -x '*.pyc' '__pycache__/*' '.git/*' '*.sh' '*.md' -q
echo "Zip size: $(du -h "$ZIP_FILE" | cut -f1)"

echo "=== Uploading to S3 ==="
aws s3 cp "$ZIP_FILE" "s3://$S3_BUCKET/$S3_KEY" --region "$REGION" --profile eh

echo "=== Updating Lambda ==="
aws lambda update-function-code --function-name "$FUNCTION_NAME" --s3-bucket "$S3_BUCKET" --s3-key "$S3_KEY" --region "$REGION" --profile eh --query 'LastUpdateStatus' --output text

echo "=== Waiting for Lambda to finish updating ==="
aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION" --profile eh

echo "=== Done. Deployed in ~10 seconds. ==="
