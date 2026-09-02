# 화살 게임 — 자율 개발 루프

3D 궁수 아레나 게임을 자율 루프로 개발한다.
기획은 [docs/DESIGN.md](docs/DESIGN.md), 루프 지시서는 [loop/PROMPT.md](loop/PROMPT.md).

---

## ⚠️ 아직 루프를 켤 수 없다 — 먼저 설치할 것

이 컴퓨터에 **클로드 코드 CLI 와 Node.js 가 없다.**
루프는 매 바퀴 `claude -p` 로 새 헤드리스 세션을 여는 구조라,
CLI 가 없으면 아무것도 하지 못하고 조용히 죽는다.

```bash
brew install node && npm install -g @anthropic-ai/claude-code && claude login
```

설치가 끝나면 아래 두 가지를 확인한다.

```bash
which claude && claude --version && node --version
```

`which claude` 로 나온 경로가 `loop/env.sh` 의 `CLAUDE_BIN` 과 다르면
그 값을 실제 경로로 고칠 것. (기본값은 `/opt/homebrew/bin/claude`)

---

## 만든 파일

| 파일 | 역할 |
|---|---|
| `loop/loop.sh` | 루프 본체. 한 바퀴마다 **새** 헤드리스 세션을 연다 |
| `loop/env.sh` | 설정. 모델·최대 턴·대기 시간·최대 바퀴 수·CLI 경로 |
| `loop/loopctl.sh` | 제어. 켜기 / 끄기 / 상태 / 로그 |
| `loop/com.jadrion.arrowgame.loop.plist` | 자동 실행(launchd) 정의 |
| `loop/PROMPT.md` | 매 바퀴 새 세션이 읽는 지시서 (원본, 수정 금지) |
| `docs/DESIGN.md` | 기획서 |
| `docs/STATUS.md` | 인수인계서. 루프가 매 바퀴 갱신 |
| `docs/feedback/INBOX.md` | 지시함. 한 줄 적으면 다음 바퀴가 최우선 처리 |
| `logs/` | 날짜별 로그 (git 제외) |

---

## 자동 실행 등록

**아직 등록하지 않았다.** CLI 가 없는 상태에서 등록하면
로그인할 때마다 실행에 실패하고 `KeepAlive` 때문에 계속 되살아난다.

위 설치를 마친 뒤에 등록한다.

```bash
cp "loop/com.jadrion.arrowgame.loop.plist" ~/Library/LaunchAgents/
```

---

## 켜기 / 끄기 / 상태 보기

```bash
./loop/loopctl.sh start
```

```bash
./loop/loopctl.sh stop
```

```bash
./loop/loopctl.sh status
```

```bash
./loop/loopctl.sh log
```

- `start` — `STOP` 파일을 지우고 자동 실행을 켠다
- `stop` — `STOP` 파일을 만들고 자동 실행을 해제한다. 진행 중인 바퀴는 끝까지 돈다
- `status` — 등록 여부, STOP 파일 유무, 최근 로그, 최근 커밋을 한 번에 보여준다
- `log` — 최신 로그를 실시간으로 따라간다

> **`loop.sh` 를 터미널에서 직접 실행하지 말 것.**
> 무한 루프라 그 터미널이 묶이고, 창을 닫으면 루프도 같이 죽는다.

---

## 돌아가는 중에 쓰는 법

- **지시 내리기** — [docs/feedback/INBOX.md](docs/feedback/INBOX.md) 에 한 줄 적는다. 다음 바퀴가 가장 먼저 처리한다
- **진행 확인** — [docs/STATUS.md](docs/STATUS.md) (요약) · `git log` (커밋 흐름) · `logs/` (바퀴별 상세)
- **급히 멈추기** — `touch loop/STOP`

---

## 설정 바꾸기

[loop/env.sh](loop/env.sh) 만 고치면 된다.

| 항목 | 기본값 | 설명 |
|---|---|---|
| `CLAUDE_BIN` | `/opt/homebrew/bin/claude` | CLI 전체 경로 |
| `MODEL` | `claude-opus-5` | 사용할 모델 |
| `MAX_TURNS` | `80` | 한 바퀴 최대 턴 수 |
| `SLEEP_BETWEEN` | `60` | 바퀴 사이 대기(초) |
| `MAX_CYCLES` | `0` | 최대 바퀴 수 (0 = 무제한) |
| `PERMISSION_FLAG` | `--dangerously-skip-permissions` | 아래 주의 참고 |

### 권한 플래그에 대한 주의

헤드리스 자율 실행에는 권한을 물어볼 사람이 없다.
그래서 기본값으로 권한 확인을 건너뛰게 돼 있고, 이 플래그를 빼면
루프는 첫 파일 수정에서 멈춘 채 턴만 소모한다.

대신 **이 루프는 확인 없이 파일을 만들고 고치고 명령을 실행한다.**
작업 범위가 이 폴더로 한정되도록 `WorkingDirectory` 를 지정해 뒀지만,
그 점을 이해하고 켤 것.
