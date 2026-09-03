#!/bin/zsh
# 루프 설정 — 이 파일만 고치면 루프 동작이 바뀐다.

# [필수] 클로드 코드 실행 파일의 전체 경로.
# 자동 실행은 평소 터미널 환경을 물려받지 않는다. 반드시 전체 경로로 적을 것.
#   설치 후 `which claude` 결과를 그대로 넣으면 된다.
CLAUDE_BIN="${CLAUDE_BIN:-/opt/homebrew/bin/claude}"

# [필수] PATH 명시. 빠뜨리면 실행 파일을 못 찾고 조용히 죽는다.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 사용할 모델
MODEL="${MODEL:-claude-opus-5}"

# 한 바퀴에서 허용할 최대 턴 수. 넘으면 그 바퀴는 거기서 끝난다.
MAX_TURNS="${MAX_TURNS:-80}"

# 바퀴 사이 대기 시간(초).
SLEEP_BETWEEN="${SLEEP_BETWEEN:-60}"

# 최대 바퀴 수. 0이면 무제한.
MAX_CYCLES="${MAX_CYCLES:-0}"

# 세션이 도는 동안 맥이 잠들지 않게 한다(caffeinate -i: 유휴 절전 방지).
# 잠들면 API 연결이 끊겨 그 바퀴가 통째로 버려진다. 뚜껑을 닫는 절전은 막지 못한다.
KEEP_AWAKE="${KEEP_AWAKE:-1}"

# 헤드리스 자율 실행이라 매번 권한을 물어볼 사람이 없다.
# 이 플래그를 빼면 루프는 첫 파일 수정에서 멈춘 채 턴만 소모한다.
# 끄고 싶으면 빈 문자열("")로 두되, 그러면 자율 루프는 사실상 동작하지 않는다.
PERMISSION_FLAG="${PERMISSION_FLAG:---dangerously-skip-permissions}"

# 매 바퀴 새 세션에 주는 지시. 대화를 이어 붙이지 않는 것이 핵심이다.
CYCLE_PROMPT="${CYCLE_PROMPT:-loop/PROMPT.md 를 읽고, 그 지시서에 적힌 순서와 규칙에 따라 이번 바퀴의 작업을 수행하라.}"
