#!/usr/bin/env bash
# =============================================================================
# End-to-end auth flow against the LIVE local stack.
# =============================================================================
# Exercises the real thing — Supabase, Postgres, Mailpit and a running API —
# rather than mocks, because the failures this catches (an unexposed SMTP port,
# a cookie path that stops the browser sending the refresh token, a trigger that
# did not fire) are precisely the ones a mocked suite cannot see.
#
#   pnpm --filter infrastructure run db:start
#   pnpm --filter api run build && node apps/api/dist/main.js &
#   ./apps/api/test/auth-flow.e2e.sh
# =============================================================================
set -uo pipefail

API=${API:-http://localhost:3333/api/v1}
MAILPIT=${MAILPIT:-http://127.0.0.1:54324}
JAR=$(mktemp)
PASS=0
FAIL=0

check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"; PASS=$((PASS + 1))
  else
    printf '  FAIL %s (got "%s", want "%s")\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1))
  fi
}

status() { tail -1 <<<"$1"; }
body()   { sed '$d' <<<"$1"; }
post()   { curl -s -b "$JAR" -c "$JAR" -X POST "$API$1" -H 'content-type: application/json' -d "$2" -w '\n%{http_code}'; }
get()    { curl -s -b "$JAR" -c "$JAR" "$API$1" -w '\n%{http_code}'; }

latest_otp() {
  curl -s "$MAILPIT/api/v1/messages?limit=1" | python3 -c "
import sys, json, re, urllib.request
d = json.load(sys.stdin)
if not d.get('messages'):
    print(''); raise SystemExit
mid = d['messages'][0]['ID']
# The list endpoint gives metadata only; the HTML lives on the message itself.
msg = json.loads(urllib.request.urlopen(f'$MAILPIT/api/v1/message/{mid}').read().decode())
m = re.search(r'letter-spacing:8px[^>]*>\s*(\d{6})\s*<', msg.get('HTML', ''))
print(m.group(1) if m else '')
"
}

TS=$(date +%s)
EMAIL="e2e$TS@cra.test"
USERNAME="e2e$TS"

echo "auth flow e2e — $EMAIL"
curl -s -X DELETE "$MAILPIT/api/v1/messages" >/dev/null 2>&1

echo "sign up"
R=$(post /auth/sign-up "{\"email\":\"$EMAIL\",\"username\":\"$USERNAME\",\"password\":\"Password123\"}")
check "sign-up returns 201" "$(status "$R")" "201"
check "sign-up routes to verify" "$(body "$R")" '{"next":"verify"}'
grep -q cra_at "$JAR"      && check "access cookie set"  yes yes || check "access cookie set"  no yes
grep -q cra_rt "$JAR"      && check "refresh cookie set" yes yes || check "refresh cookie set" no yes
grep -q cra_pending "$JAR" && check "pending cookie set" yes yes || check "pending cookie set" no yes
# The refresh cookie must be scoped to the refresh endpoint alone — this is the
# CSRF control, so it is worth asserting rather than assuming.
grep -q "/api/v1/auth/refresh" "$JAR" && check "refresh cookie path-scoped" yes yes || check "refresh cookie path-scoped" no yes

echo "weak password rejected"
R=$(post /auth/sign-up "{\"email\":\"weak$TS@cra.test\",\"username\":\"weak$TS\",\"password\":\"short\"}")
check "weak password rejected" "$(status "$R")" "400"

echo "duplicate email rejected"
R=$(post /auth/sign-up "{\"email\":\"$EMAIL\",\"username\":\"other$TS\",\"password\":\"Password123\"}")
check "duplicate email rejected" "$(status "$R")" "409"

echo "email verification"
sleep 2
CODE=$(latest_otp)
[ -n "$CODE" ] && check "otp email delivered" yes yes || check "otp email delivered" no yes

R=$(post /auth/verify-email '{"code":"000000"}')
check "wrong otp rejected" "$(status "$R")" "400"

R=$(post /auth/verify-email "{\"code\":\"$CODE\"}")
check "correct otp accepted" "$(status "$R")" "200"

R=$(post /auth/verify-email "{\"code\":\"$CODE\"}")
check "otp is single-use" "$(status "$R")" "400"

echo "session"
R=$(get /auth/session)
check "session readable" "$(status "$R")" "200"
python3 -c "
import json,sys
b=json.loads('''$(body "$R")''')
print('ok' if b['user']['email']=='$EMAIL' else 'mismatch')
" | grep -q ok && check "session is the right user" yes yes || check "session is the right user" no yes

echo "sign in"
rm -f "$JAR"; JAR=$(mktemp)
R=$(post /auth/sign-in "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\",\"remember\":false}")
check "wrong password rejected" "$(status "$R")" "401"

R=$(post /auth/sign-in "{\"email\":\"$EMAIL\",\"password\":\"Password123\",\"remember\":true}")
check "sign-in succeeds" "$(status "$R")" "200"
check "sign-in routes to dashboard" "$(body "$R")" '{"next":"dashboard"}'

R=$(post /auth/sign-in "{\"email\":\"$USERNAME\",\"password\":\"Password123\",\"remember\":false}")
check "sign-in by username works" "$(status "$R")" "200"

echo "lock-screen lockout"
for attempt in 1 2 3 4 5; do
  R=$(post /auth/unlock '{"password":"definitely-wrong"}')
  check "wrong unlock attempt $attempt rejected" "$(status "$R")" "401"
done
R=$(post /auth/unlock '{"password":"Password123"}')
check "locked account cannot unlock with correct password" "$(status "$R")" "429"
grep -q '"code":"account_locked"' <<<"$(body "$R")" \
  && check "unlock reports account_locked" yes yes \
  || check "unlock reports account_locked" "$(body "$R")" "account_locked"

echo "enumeration resistance"
R=$(post /auth/forgot-password '{"email":"definitely-not-a-user@cra.test"}')
check "forgot-password hides unknown address" "$(status "$R")" "200"
R=$(post /auth/forgot-password "{\"email\":\"$EMAIL\"}")
check "forgot-password hides known address identically" "$(status "$R")" "200"

echo "auth required"
UNAUTH=$(curl -s "$API/auth/session" -w '\n%{http_code}')
check "session requires auth" "$(status "$UNAUTH")" "401"
UNAUTH=$(curl -s -X POST "$API/auth/sign-out" -w '\n%{http_code}')
check "sign-out requires auth" "$(status "$UNAUTH")" "401"

echo "sign out revokes the live token"
TOKEN=$(grep cra_at "$JAR" | awk '{print $NF}')
R=$(post /auth/sign-out '{}')
check "sign-out succeeds" "$(status "$R")" "200"
# session_epoch_at was bumped, so the token captured a moment ago must now be
# rejected even though its signature is still perfectly valid.
REVOKED=$(curl -s "$API/auth/session" -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}')
check "previously valid token now rejected" "$(status "$REVOKED")" "401"
grep -q session_revoked <<<"$(body "$REVOKED")" \
  && check "rejected with session_revoked" yes yes \
  || check "rejected with session_revoked" "$(body "$REVOKED")" "session_revoked"

echo "lockout"
rm -f "$JAR"; JAR=$(mktemp)
LOCK="lock$TS@cra.test"
post /auth/sign-up "{\"email\":\"$LOCK\",\"username\":\"lock$TS\",\"password\":\"Password123\"}" >/dev/null
for _ in 1 2 3 4 5; do
  post /auth/sign-in "{\"email\":\"$LOCK\",\"password\":\"nope\",\"remember\":false}" >/dev/null
done
R=$(post /auth/sign-in "{\"email\":\"$LOCK\",\"password\":\"Password123\",\"remember\":false}")
# 429 even with the CORRECT password: the lockout is per-account and durable, so
# an attacker rotating IPs cannot get around it.
check "account locked after repeated failures" "$(status "$R")" "429"

rm -f "$JAR"
echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
