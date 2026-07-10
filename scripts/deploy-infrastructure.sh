#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-eh}"
REGION="${AWS_REGION:-us-east-2}"
MODE="${1:-validate}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

templates=(runtime-buckets runtime-data api-hosting)

validate() {
  for template in "${templates[@]}"; do
    aws cloudformation validate-template \
      --profile "$PROFILE" \
      --region "$REGION" \
      --template-body "file://$ROOT_DIR/infra/$template.yaml" \
      --query 'Description' --output text
  done
}

case "$MODE" in
  validate)
    validate
    ;;
  plan)
    validate
    echo "Templates are valid. Resource adoption requires an explicit CloudFormation import change set."
    echo "No production resources were changed."
    ;;
  *)
    echo "Usage: $0 [validate|plan]" >&2
    exit 2
    ;;
esac
