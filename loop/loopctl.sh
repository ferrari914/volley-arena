#!/bin/zsh
# 루프 제어 — 켜기 / 끄기 / 상태 보기
#   ./loop/loopctl.sh start | stop | status | log

set -u

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
LABEL="com.jadrion.arrowgame.loop"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

case "${1:-}" in
  start)
    rm -f "$SCRIPT_DIR/STOP"
    if [ ! -f "$PLIST" ]; then
      echo "자동 실행이 등록돼 있지 않다: $PLIST"
      echo "먼저 loop/com.jadrion.arrowgame.loop.plist 를 LaunchAgents 로 복사할 것."
      exit 1
    fi
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null \
      || launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "루프를 켰다."
    ;;
  stop)
    touch "$SCRIPT_DIR/STOP"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    echo "루프를 껐다. (STOP 파일 생성 + 자동 실행 해제)"
    echo "다시 켜려면: ./loop/loopctl.sh start"
    ;;
  status)
    echo "── 자동 실행 등록 ──"
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "  등록됨 · 실행 중"
    elif [ -f "$PLIST" ]; then
      echo "  plist 는 있으나 실행 중이 아님"
    else
      echo "  등록 안 됨"
    fi
    echo "── 세션 ──"
    source "$SCRIPT_DIR/env.sh"
    if pgrep -f "$CLAUDE_BIN -p " >/dev/null 2>&1; then
      echo "  세션 실행 중 (pid $(pgrep -f "$CLAUDE_BIN -p " | head -1))"
    else
      echo "  실행 중인 세션 없음"
    fi
    echo "── STOP 파일 ──"
    [ -f "$SCRIPT_DIR/STOP" ] && echo "  있음 (루프가 멈춘다)" || echo "  없음"
    echo "── 최근 로그 ──"
    logs=("$PROJECT_DIR"/logs/*.log(N))
    if (( ${#logs[@]} )); then
      ls -t "${logs[@]}" | head -3
    else
      echo "  아직 없음"
    fi
    echo "── 최근 커밋 ──"
    git -C "$PROJECT_DIR" log --oneline -5 2>/dev/null || echo "  없음"
    ;;
  log)
    logs=("$PROJECT_DIR"/logs/*.log(N))
    if (( ${#logs[@]} )); then
      tail -f "$(ls -t "${logs[@]}" | head -1)"
    else
      echo "로그가 아직 없다."
    fi
    ;;
  *)
    echo "사용법: ./loop/loopctl.sh {start|stop|status|log}"
    exit 1
    ;;
esac
