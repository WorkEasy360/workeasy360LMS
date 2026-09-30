# Optional helper for Bash: `. tools/env.sh`
# - puts untracked portable copies of JDK 21 / Maven under tools/ on PATH when they exist (machines without admin rights)
# - loads untracked local settings from backend/.env (JWT_SECRET, DB_*, AI_* ...; copy backend/.env.example)
# With a system JDK 21 + Maven you do not need this file.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for d in "$DIR"/jdk-21*; do [ -d "$d/bin" ] && export JAVA_HOME="$d" && export PATH="$JAVA_HOME/bin:$PATH"; done
for d in "$DIR"/apache-maven-*; do [ -d "$d/bin" ] && export MAVEN_HOME="$d" && export M2_HOME="$d" && export PATH="$d/bin:$PATH"; done
if [ -f "$DIR/../backend/.env" ]; then set -a; . "$DIR/../backend/.env"; set +a; fi
