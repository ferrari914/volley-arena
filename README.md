# 화살 게임 — 자율 개발 루프

3D 궁수 아레나 게임을 자율 루프로 개발한다.
기획은 [docs/DESIGN.md](docs/DESIGN.md), 루프 지시서는 [loop/PROMPT.md](loop/PROMPT.md).

---

## 게임 개발

```bash
npm install          # 처음 한 번
npm run dev          # 개발 서버 (같은 와이파이의 스마트폰에서도 열린다)
```

커밋 전에 아래를 전부 통과시킨다. (DESIGN.md "검사 명령")

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

화면이 바뀌는 작업을 했으면 한 가지를 더 돌린다.

```bash
npm run qa           # 빌드 → 실제 브라우저로 실행 → shots/ 에 스크린샷
```

`npm run qa` 는 다섯 화면(모바일 가로 · 모바일 가로+노치 · 모바일 세로 ·
모바일 세로+노치 · 데스크톱)을 찍고 두 가지를 자동으로 잡는다.

- **콘솔 에러** — 하나라도 찍히면 실패로 끝난다
  (DESIGN 품질 기준: "게임 중 어떤 상황에서도 콘솔에 에러가 찍히지 않을 것").
- **안전 영역(노치) 침범** — 노치 기기의 여백 값을 주입해 흉내 내고,
  HUD와 가상 스틱이 그 안쪽에 있는지 좌표로 잰다. 3D 화면은 반대로
  창을 꽉 채우는지 본다 (DESIGN A-2: "안전 영역(노치) 회피").
  여백을 주입하는 방식이라 `env(safe-area-inset-*)` 자체가 동작하는지는
  증명하지 못한다 — 그건 실기기에서만 확인된다.

스크린샷은 `shots/` 에 남고 git 에는 올리지 않는다.

적 하나의 생김새만 보고 싶으면 카메라를 들이대는 도구가 따로 있다.

```bash
npm run shot:enemy                                  # 네 종류를 있는 그대로
npm run shot:enemy -- shield calm worn flash aim    # 방패병의 네 상태
npm run shot:enemy -- crowd                         # 적이 상한(17마리)까지 찬 화면
npm run shot:enemy -- crowd 5                       # 견줄 화면(판의 첫머리)
npm run shot:enemy -- crowd veteran                 # 그 자리까지 실제로 싸워 올라간 사람
```

`npm run qa` 는 판을 처음부터 돌려 **화면 흐름**을 잰다. 그 판에서 특정 적이
화면에 잡히는지는 운이고(방패병은 22m 밖에 서 있다), "방패가 닳았을 때"·
"받아 낸 순간"처럼 잠깐 스치는 상태는 사실상 못 찍는다.
`shot:enemy` 는 판을 흔들지 않고 플레이어를 그 적 앞 5.5m에 붙들어 둔 뒤
상태를 지정해 찍는다. 검사가 아니라 **눈으로 보는 도구**다
(콘솔 에러가 찍히면 실패하는 것은 같다).

`crowd` 는 적을 만들어 세우지 않고 **판의 시계만 앞으로 민다** — 증원을 부르는 것은
게임이므로(`REINFORCE`), 증원 표를 고치면 이 화면도 따라 바뀐다. **다 모인 뒤 15초를
기다렸다가** 찍고(창을 연 시각이 아니다 — 다 채우는 데 걸리는 시간이 장마다 다르다),
찍은 프레임의 적·화살·코어 수와 드로우콜, 그리고 **가장 많았던 프레임**을 함께 출력한다.
화살은 적에게 꽂혀서도 죽어 프레임마다 크게 흔들리므로 한 프레임만 봐서는 읽을 수 없다.

카드 한 장을 3중 1택 화면에 세워 보고 싶으면 그쪽에도 도구가 있다.

```bash
npm run shot:card -- repel          # 밀어내기가 낀 카드 화면 (모바일·데스크톱)
npm run shot:card -- repel mend     # 여러 장을 잇달아
npm run shot:card -- repel mobile   # 한쪽 화면만
```

qa도 카드 화면을 찍지만 **어느 셋이 뜨는지는 판이 정한다**(아홉 장에서 섞어 셋을 뽑는다) —
방금 만든 카드가 그 셋에 들지는 운이다. `shot:card` 는 **뜬 셋을 내려놓고 다시 뽑아**
그 카드가 낄 때까지 되풀이한다. 한 장도 고르지 않으므로 능력치도 눈금도 처음 그대로다.
찍는 사람은 체력이 절반쯤 남아 있다 — 가득 차면 회복 카드가 후보에서 빠져
그 장만 영영 못 찍히기 때문이다. 카드 id를 잘못 적으면 되뽑는 동안 실제로 본 카드들을
그대로 보여 준다.

`veteran` 을 붙이면 시계를 미는 대신 **판을 실제로 돌린다** — 코어를 주우러 걷고 화력 카드를
고르고 적을 잡는 것이 전부 게임 안에서 일어나므로, 그 화면의 레벨과 화력이 진짜 그 판의 값이다
(20초쯤 걸린다). 화살이 몇 발씩 나가는 화면은 이쪽으로만 볼 수 있다.

**이 기계의 fps 숫자는 화면의 무게를 따라 움직이지 않는다** — 적 5마리 13fps · 15마리 16fps ·
Lv20의 난전 18fps인데 드로우콜은 56 → 112 → 143이다. 프레임은 실기기에서 볼 것.

게임 규칙(`src/core` · `src/systems`)을 건드렸으면 하나 더 돌린다.

```bash
npm run perf         # 부하 장면에서 World.step() 한 번의 처리 시간을 잰다
```

DESIGN 품질 기준의 부하 상황(**적 20마리 · 투사체 60개**)을 세우고
시뮬레이션 한 스텝이 몇 ms 걸리는지 2000번 재서 중앙값·p95·최악값을 찍는다.
합격선은 두 개다 — 60fps 프레임 예산의 1/8(2.08ms)과, 실측값의 20배쯤에
둔 회귀 감시선(0.30ms). 앞의 것은 "예산 안에 드는가", 뒤의 것은
"구조가 나빠졌는가"를 본다.

> **이 수치는 fps가 아니다.** 렌더(GPU)는 포함하지 않고, 개발용 맥에서 잰 값이다.
> 중급 스마트폰의 실제 프레임은 실기기에서만 확인된다 (DESIGN 12번 배포 때).

`npm test` 와 분리한 이유는 시간을 재는 검사가 기계 사정에 흔들리기 때문이다.
대신 이 측정이 **빈 장면을 재고 통과하는 일**이 없도록,
부하가 실제로 서는지는 `tests/loadScene.test.ts` 가 `npm test` 에서 매번 확인한다.

입력을 다루는 코드(`src/input` · `src/core/Ticker.ts` · `src/main.ts`)를 건드렸으면
하나 더 돌린다.

```bash
npm run latency      # 터치가 화면에 반영되기까지 몇 프레임 걸리는지 잰다
```

실제 브라우저에서 가상 스틱을 끌고, 그 `pointermove` 가 도착한 시각부터
플레이어가 움직인 첫 프레임을 다 그린 시각까지를 30번 잰다
(DESIGN 품질 기준: "터치 입력과 화면 반응 사이에 체감되는 지연이 없을 것").

합격선은 **붙들린 프레임 0개**다. 이벤트가 도착한 뒤에 시뮬레이션이 한 번이라도
돈 프레임은 그 입력을 반영해야 한다. 돌았는데 반영하지 않았다면 게임이 입력을
한 프레임 쌓아 둔 것이고, 그게 우리가 만들어 낼 수 있는 유일한 종류의 지연이다.

> **프레임 수 자체를 합격선에 쓰지 않는 이유.** 이 루프는 1/60초 고정 스텝이라
> 화면이 60Hz보다 빠르면 어떤 프레임은 시뮬레이션을 한 번도 돌리지 않는다.
> 그런 프레임을 "밀렸다"고 세면 120Hz 기기가 60Hz 기기보다 나빠 보인다.
> 실제로는 둘 다 "다음 스텝에 바로 반영"으로 같다.

> **이 수치는 총 지연이 아니다.** 그리기가 끝난 뒤 화면에 불이 들어오기까지
> (합성·GPU·패널)는 브라우저 밖이라 재지 못한다. 터치도 CDP 로 밀어 넣은
> 합성 이벤트다. 말할 수 있는 것은 "게임이 입력을 붙들고 있지 않다"까지다.

---

## 실행 환경 확인

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
| `src/` | 게임 소스 (core · entities · systems · render · input · ui · data) |
| `tests/` | vitest 테스트 |
| `tools/shot.mjs` | 화면 QA. 실제 브라우저로 띄워 스크린샷 + 콘솔 에러·안전 영역 검사 |
| `tools/latency.mjs` | 입력 지연 측정(`npm run latency`). 터치 → 화면 반영까지 |
| `tools/enemy-shot.mjs` | 적을 눈으로 본다(`npm run shot:enemy`). 한 종류를 가까이서, `crowd` 로 무리 전체, `crowd veteran` 으로 다 자란 사람의 난전 |
| `tools/card-shot.mjs` | 카드 한 장을 눈으로 본다(`npm run shot:card -- <id>`). 그 카드가 낄 때까지 되뽑아 3중 1택 화면을 세운다 |
| `tools/lib/preview.mjs` | 도구들이 함께 쓰는 미리보기 서버 띄우기 |
| `tests/support/loadScene.ts` | 부하 장면(적 20·투사체 60). 성능 측정이 쓰는 장면 |
| `tests/perf/` | `npm run perf` 가 도는 측정. `npm test` 에는 포함되지 않는다 |
| `shots/` | QA 스크린샷 (git 제외) |

---

## 자동 실행 등록

**등록돼 있고, 꺼져 있다.** plist 는 `~/Library/LaunchAgents/` 에 들어가 있지만
`launchctl disable` 로 잠가 두어서 로그인해도 시작하지 않는다.
`./loop/loopctl.sh start` 가 잠금을 풀고 켠다.

프로젝트 폴더를 옮기거나 이름을 바꾸면 plist 안의 절대 경로가 깨진다.
그때는 `loop/com.jadrion.arrowgame.loop.plist` 의 경로를 고친 뒤 다시 복사한다.

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
./loop/loopctl.sh kill
```

```bash
./loop/loopctl.sh status
```

```bash
./loop/loopctl.sh log
```

- `start` — 잠금을 풀고 켠다. 이후 로그인하면 자동 시작, 비정상 종료면 재시작
- `stop` — **부드럽게** 끈다. 진행 중인 바퀴는 끝까지 돌고 다음 바퀴를 시작하지 않는다. 로그인해도 다시 시작하지 않는다
- `kill` — **당장** 죽인다. 루프와 실행 중인 세션 모두. 커밋 안 된 작업은 사라진다
- `status` — 등록/켜짐 여부, 실행 중인 세션, STOP 파일, 최근 로그·커밋을 한 번에
- `log` — 최신 로그를 실시간으로 따라간다

> **`loop.sh` 를 터미널에서 직접 실행하지 말 것.**
> 무한 루프라 그 터미널이 묶이고, 창을 닫으면 루프도 같이 죽는다.

> **맥이 잠들면 그 바퀴는 버려진다.** 세션이 도는 동안 `caffeinate` 가 유휴 절전을 막지만
> **뚜껑을 닫는 절전은 막지 못한다.** 루프를 켜 둘 때는 전원을 연결하고 뚜껑을 열어 둘 것.

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
| `KEEP_AWAKE` | `1` | 세션 중 유휴 절전 방지(caffeinate). `0` 이면 끔 |

### 권한 플래그에 대한 주의

헤드리스 자율 실행에는 권한을 물어볼 사람이 없다.
그래서 기본값으로 권한 확인을 건너뛰게 돼 있고, 이 플래그를 빼면
루프는 첫 파일 수정에서 멈춘 채 턴만 소모한다.

대신 **이 루프는 확인 없이 파일을 만들고 고치고 명령을 실행한다.**
작업 범위가 이 폴더로 한정되도록 `WorkingDirectory` 를 지정해 뒀지만,
그 점을 이해하고 켤 것.
