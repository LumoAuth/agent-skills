#!/bin/bash
# Fetches the OpenID Connect discovery document of a LumoAuth organization.
#
# Usage: bash scripts/check-org.sh <org-slug> [base-url]
#
#   org-slug   The organization slug, for example acme-corp
#   base-url   https://app.lumoauth.dev (default, US region) or
#              https://eu.app.lumoauth.dev (EU region)
#
# Prints the discovery document (JSON) to stdout and status to stderr.
# Exit codes: 0 found, 1 not found or unreachable, 2 wrong usage.
# The discovery document is public. This script sends no credentials.

set -e

ORG="$1"
BASE_URL="${2:-${LUMOAUTH_URL:-https://app.lumoauth.dev}}"
BASE_URL="${BASE_URL%/}"

if [ -z "$ORG" ]; then
  echo "Usage: bash scripts/check-org.sh <org-slug> [base-url]" >&2
  exit 2
fi

case "$ORG" in
  *[!a-zA-Z0-9_-]*)
    echo "error: \"$ORG\" is not an organization slug (letters, digits, hyphens)." >&2
    exit 2
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required." >&2
  exit 1
fi

URL="$BASE_URL/orgs/$ORG/api/v1/.well-known/openid-configuration"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Fetching $URL" >&2

STATUS="$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 15 -H 'Accept: application/json' "$URL")" || {
  echo "error: could not reach $BASE_URL. Check the base URL and the network." >&2
  exit 1
}

if [ "$STATUS" != "200" ]; then
  echo "error: HTTP $STATUS. No organization \"$ORG\" at $BASE_URL." >&2
  echo "hint: check the slug, and try the other region (https://app.lumoauth.dev or https://eu.app.lumoauth.dev)." >&2
  exit 1
fi

if ! grep -q '"issuer"' "$TMP"; then
  echo "error: the response is not a discovery document." >&2
  exit 1
fi

echo "ok: organization \"$ORG\" found. Use the \"issuer\" value from the output as the OIDC issuer." >&2
cat "$TMP"
echo
