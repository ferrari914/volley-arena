#!/bin/zsh
# 자율 개발 루프 본체.
# 한 바퀴마다 헤드리스 세션을 "새로" 연다. 대화를 이어 붙이지 않는다. 이게 핵심이다.
#
# 터미널에서 직접 실행하지 말 것. 무한 루프라 세션이 묶이고 창을 닫으면 같이 죽는다.
# 반드시 loopctl.sh 또는 등록된 자동 실행으로 돌릴 것.

set -u

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
source "$SCRIPT_DIR/env.sh"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/logs"

echo $$ > "$SCRIPT_DIR/loop.pid"
trap 'rm -f "$SCRIPT_DIR/loop.pid"' EXIT

# 이전 루프가 죽었는데 세션이 아직 살아 있으면(고아) 끝날 때까지 기다린다.
# launchd 가 루프를 되살렸을 때 두 세션이 같은 저장소를 동시에 만지는 일을 막는다.
if pgrep -f "$CLAUDE_BIN -p " >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 이전 세션이 아직 실행 중이다. 끝날 때까지 기다린다." \
    >> "$PROJECT_DIR/logs/$(date +%Y-%m-%d).log"
  while pgrep -f "$CLAUDE_BIN -p " >/dev/null 2>&1; do sleep 30; done
fi

cycle=0

while true; do
  # STOP 파일이 있으면 현재 바퀴를 시작하지 않고 멈춘다.
  if [ -f "$SCRIPT_DIR/STOP" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] STOP 파일 감지. 루프를 종료한다." \
      >> "$PROJECT_DIR/logs/$(date +%Y-%m-%d).log"
    exit 0
  fi

  if [ "$MAX_CYCLES" -ne 0 ] && [ "$cycle" -ge "$MAX_CYCLES" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 최대 바퀴 수($MAX_CYCLES) 도달. 종료한다." \
      >> "$PROJECT_DIR/logs/$(date +%Y-%m-%d).log"
    exit 0
  fi

  cycle=$((cycle + 1))
  LOG="$PROJECT_DIR/logs/$(date +%Y-%m-%d).log"

  {
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  바퀴 #$cycle  시작: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  모델: $MODEL / 최대 턴: $MAX_TURNS"
    echo "════════════════════════════════════════════════════════════"
  } >> "$LOG"

  if [ ! -x "$CLAUDE_BIN" ]; then
    echo "[오류] 클로드 코드 실행 파일을 찾을 수 없다: $CLAUDE_BIN" >> "$LOG"
    echo "       loop/env.sh 의 CLAUDE_BIN 을 실제 경로로 고칠 것." >> "$LOG"
    exit 1
  fi

  # 매 바퀴 새 세션. --continue / --resume 을 쓰지 않는다.
  # 세션은 별도 세션/프로세스 그룹으로 격리한다. 세션이 종료하면서 자기가 띄운
  # 백그라운드 작업을 그룹 단위로 정리하는데, 같은 그룹이면 이 루프까지 같이 죽는다.
  # (macOS 에는 setsid 명령이 없어 perl 의 POSIX::setsid 로 대신한다)
  if [ "$KEEP_AWAKE" = "1" ]; then awake=(/usr/bin/caffeinate -i); else awake=(); fi
  "${awake[@]}" /usr/bin/perl -e 'use POSIX; POSIX::setsid() or die "setsid: $!"; exec @ARGV or die "exec: $!"' -- \
    "$CLAUDE_BIN" -p "$CYCLE_PROMPT" \
    --model "$MODEL" \
    --max-turns "$MAX_TURNS" \
    ${PERMISSION_FLAG:+$PERMISSION_FLAG} \
    >> "$LOG" 2>&1
  rc=$?   # zsh 에서 status 는 읽기 전용 특수 변수라 쓰면 안 된다

  echo "" >> "$LOG"
  echo "  바퀴 #$cycle 종료 (exit=$rc): $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"

  sleep "$SLEEP_BETWEEN"
done
