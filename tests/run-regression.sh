#!/bin/bash
# Runs the in-browser regression suites one at a time in headless Chrome and writes a summary.
#
#   bash tests/run-regression.sh                          # the full regression (67 suites)
#   bash tests/run-regression.sh "instructor builder" "learner quiz"
#
# Requirements: frontend served by serve.ps1 (it provides the /__log endpoint the suites report to), backend running
# with the demo accounts seeded and PAYMENTS_PROVIDER=mock + PAYMENTS_MOCK_ALLOWED=true, Chrome/Chromium. Environment:
#   CHROME    path to the browser   (default: first of the usual install locations / PATH)
#   BASE_URL  frontend URL          (default: http://localhost:5173)
#   TIMEOUT   seconds per suite     (default: 250)
# A suite that reports FAILED is never retried. A suite whose browser produced no output at all is retried once.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/tests/last-run.log"
OUT="$ROOT/tests/regression-result.txt"
BASE_URL="${BASE_URL:-http://localhost:5173}"
TIMEOUT="${TIMEOUT:-250}"
PROFILES="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/we360-regression-$$")"
mkdir -p "$PROFILES"

if [ -z "$CHROME" ]; then
  for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$(command -v google-chrome 2>/dev/null)" \
           "$(command -v chromium 2>/dev/null)" "$(command -v chromium-browser 2>/dev/null)"; do
    [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -z "$CHROME" ] && { echo "Chrome not found. Set CHROME=/path/to/chrome"; exit 2; }

ALL=(
  "instructor guide" "instructor builder" "learner learnerguide" "learner player" "learner quiz" "learner community"
  "learner smoke" "instructor smoke" "admin smoke" "instructor perms" "instructor review" "instructor video" "admin video"
  "instructor addvideo" "instructor backendE2E" "learner quizBackend" "learner assignmentBackend" "learner communityBackend"
  "instructor guideBackend" "learner videoResume" "learner certVerify" "learner quizFresh" "admin skillsAdmin"
  "instructor skillMapping" "learner skillProgress" "learner skillQuizEvidence" "learner journey" "learner skillsPersist"
  "admin analyticsAdmin" "instructor analyticsInstructor" "learner analyticsLearner" "learner analyticsFunnel"
  "learner analyticsAssessments" "admin analyticsFilters" "learner analyticsPersist" "admin seedConsistency"
  "instructor guideAnalyticsBackend" "admin guideAnalyticsPersist" "admin aiCourseAdmin" "instructor aiCourseInstructor"
  "instructor aiQuiz" "learner aiRbac" "instructor aiValidation" "instructor aiProvider" "instructor aiPersist"
  "learner coachContext" "learner recommendations" "learner recommendationFeedback" "learner coachConversation"
  "learner coachLessonContext" "learner coachGrounding" "learner coachRbac" "learner coachValidation" "learner learningPlan"
  "learner coachPersist" "admin adminUsers" "instructor assignLearner" "instructor notificationsBackend"
  "instructor platformAdmin" "instructor searchScope" "learner responsive" "admin accountLogin"
  "learner signup" "learner freeCourseAccess" "learner paidCourseLock" "learner purchaseFlow" "learner purchaseFailures"
)
[ $# -gt 0 ] && SUITES=("$@") || SUITES=("${ALL[@]}")

# Stops every browser process started for one profile. A plain `kill` only stops the launcher on Windows, and a
# surviving browser would keep acting as the demo user during the next suite.
stop_browser() {
  local pid=$1 tag=$2
  kill "$pid" 2>/dev/null
  if command -v powershell > /dev/null 2>&1; then
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" > /dev/null 2>&1
  else
    pkill -f "$tag" 2>/dev/null
  fi
}

run_one() { # role suite → prints the suite log
  local role=$1 suite=$2 tag="we360-${role}-${suite}-$$-$RANDOM" profile pid i
  profile="$PROFILES/$tag"
  rm -f "$LOG"
  "$CHROME" --headless=new --disable-gpu --user-data-dir="$profile" --window-size=1440,900 \
    --autoplay-policy=no-user-gesture-required "$BASE_URL/?as=$role&selftest=$suite" > /dev/null 2>&1 &
  pid=$!
  for i in $(seq 1 "$TIMEOUT"); do sleep 1; grep -q "RESULT" "$LOG" 2>/dev/null && break; done
  sed 's/^\xEF\xBB\xBF//' "$LOG" 2>/dev/null | tr -d '\r'
  stop_browser "$pid" "$tag"
  sleep 1; rm -rf "$profile" 2>/dev/null
}

: > "$OUT"; passed=0; failed=0
for spec in "${SUITES[@]}"; do
  set -- $spec; role=$1; suite=$2; note=""
  for attempt in 1 2; do
    res=$(run_one "$role" "$suite"); line=$(echo "$res" | grep "RESULT" | tail -1)
    [ -n "$line" ] && break; note=" (retried: first attempt produced no output)"
  done
  echo "== $role/$suite: ${line:-NO RESULT}$note" | tee -a "$OUT"
  echo "$res" | grep -E "^FAIL|^ERROR|TIMEOUT|PAGEERROR|REJECTION" | head -6 | sed 's/^/   /' | tee -a "$OUT"
  case "$line" in *"ALL PASSED"*) passed=$((passed+1));; *) failed=$((failed+1));; esac
done
echo "TOTAL ${#SUITES[@]}  PASSED $passed  FAILED $failed" | tee -a "$OUT"
rm -rf "$PROFILES" 2>/dev/null
[ "$failed" -eq 0 ]
