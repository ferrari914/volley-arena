import { World } from '../../src/core/World';
import type { FrameInput } from '../../src/core/World';
import { clamp, wrapAngle } from '../../src/core/math';
import { BOMBER, ENEMY, PLAYER, SHIELD } from '../../src/data/config';
import { DEFAULT_MAP, type ArenaMap } from '../../src/data/maps';
import type { UpgradeChoice, XpCore } from '../../src/entities/types';

/** 한 스텝의 길이(s). 게임 루프와 같은 60fps. */
export const DT = 1 / 60;

/** 손을 대지 않은 프레임. 이동도 조준도 없다. */
export const IDLE: FrameInput = { move: { x: 0, y: 0 }, aim: null };

/**
 * 카드가 떴을 때 **무엇을 고르는 사람인가.** 고른 카드의 id를 돌려준다.
 *
 * 판을 재는 자는 사람 하나가 아니라 둘이다 — **어떻게 움직이는가**(`input`)와
 * **어떻게 고르는가**(여기). 세션 16~19가 밸런스를 흔들 때마다 이 두 번째 자를
 * 그 자리에서 새로 짜고 재고 지웠고, 지운 뒤에는 그 수치를 다시 낼 방법이 없었다.
 * 그래서 자를 여기에 못 박아 둔다(`tests/perf/balance.perf.ts`가 셋을 한 표본으로 묶어 잰다).
 */
export type Chooser = (choices: readonly UpgradeChoice[], world: World) => string;

/**
 * 아무거나 고르는 사람. **첫 장을 고르는 것이 곧 아무거나 고르는 것이다** —
 * 세션 17이 카드가 서는 자리를 섞었으므로(`rollUpgradeChoices`) 첫 칸에 무엇이
 * 서는지가 판마다 굴러간다. 그 전까지는 화력이 늘 왼쪽에 섰다.
 */
export const takeAny: Chooser = (choices) => choices[0]?.card.id ?? '';

/** 화력을 먼저 고르는 사람. 없으면 남은 것 중 첫 장. 판이 가장 길게 자라는 쪽이다. */
export const preferPower: Chooser = (choices) =>
  (choices.find((c) => c.card.role === 'power') ?? choices[0])?.card.id ?? '';

/**
 * 보조를 먼저 고르는 사람. 화력이 가장 약하게 자라는 쪽 — **아래쪽 꼬리를 만드는 사람**이다.
 * `UPGRADE.maxSupport`가 한 번에 보조를 한 장까지로 막으므로 이 사람도 결국 화력을 고르게 된다.
 * (세션 17은 여기에 '무작위로 고르는 사람'을 뒀지만, 자리를 섞은 뒤로는 `takeAny`와 같은 사람이다.)
 */
export const preferSupport: Chooser = (choices) =>
  (choices.find((c) => c.card.role === 'support') ?? choices[0])?.card.id ?? '';

/**
 * 한 판을 돌린다. 카드가 떠 있으면 `choose`가 한 장을 고른다 —
 * 실제로 하는 사람도 골라야 게임이 다시 흐른다. 고르지 않으면 World는 멈춘 채로 남고,
 * 그 뒤의 측정은 "아무 일도 일어나지 않은 판"을 재게 된다.
 *
 * 쓰러지면 거기서 판이 끝난다(5번). 더 돌려도 step()이 빈 함수라 시간만 버린다.
 */
export function play(
  world: World,
  steps: number,
  input: (w: World) => FrameInput,
  choose: Chooser = takeAny,
): void {
  for (let i = 0; i < steps; i += 1) {
    if (world.defeated) return;
    const offer = world.offer;
    if (offer) {
      // 고를 수 없는 id를 돌려주면 게임이 멈춘 채로 남고, 그 뒤의 측정은 전부 거짓이 된다.
      // 조용히 넘기지 않고 여기서 세운다.
      const id = choose(offer.choices, world);
      if (!world.chooseUpgrade(id))
        throw new Error(`고르는 사람이 없는 카드를 골랐다: ${JSON.stringify(id)}`);
    }
    world.step(input(world), DT);
  }
}

/** 가장 가까운 코어로 걸어가는 사람. 실제로 하는 사람이 하는 행동이다. */
export function walkToNearestCore(world: World): FrameInput {
  let best: XpCore | null = null;
  let bestDist = Infinity;
  for (const core of world.cores) {
    if (!core.alive) continue;
    const d = Math.hypot(core.pos.x - world.player.pos.x, core.pos.y - world.player.pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = core;
    }
  }
  if (!best || bestDist < 1e-6) return IDLE;
  return {
    move: {
      x: (best.pos.x - world.player.pos.x) / bestDist,
      y: (best.pos.y - world.player.pos.y) / bestDist,
    },
    aim: null,
  };
}

/**
 * 달려드는 돌진형의 직선에서 옆으로 비키는 사람. 비킬 일이 없는 프레임에는 `inner`가 걷는다
 * (`backOffBomber`와 같은 문법 — 세 겹을 쌓아야 하는 자리가 생겨 감쌀 수 있게 갈랐다).
 *
 * **DESIGN 9번이 돌진형에게 요구하는 단 하나의 대응이 이것이다** —
 * "옆으로 비키면 빗나가고, 뒤로 달아나는 것만으로는 못 피한다".
 * `walkToNearestCore`는 코어만 보고 걷느라 이 한 가지를 하지 않는다.
 * 그래서 그 사람이 재는 한 판 길이의 **아래쪽 꼬리는 게임의 성질이 아니라 그 사람의 버릇**이다
 * (세션 18에 쟀다: 몸통 한 대가 12점이라 두세 대면 판이 100초씩 짧아진다).
 *
 * **몸을 던진 뒤(`dashTimer > 0`)에만 반응한다.** 웅크리는 동안 비켜도 소용이 없다 —
 * 돌진 방향은 튀어나가는 순간에 정해지고 그때까지 몸이 따라 돈다(`systems/enemyAi.ts`).
 * 화면에 보이는 것(달려오는 몸과 그 방향)만 보고 판단하므로, 사람이 할 수 없는 일을 하지 않는다.
 */
export function sidestepCharger(
  inner: (world: World) => FrameInput = walkToNearestCore,
): (world: World) => FrameInput {
  return (world) => {
    const contactRadius = ENEMY.radius + PLAYER.radius;
    for (const enemy of world.enemies) {
      if (!enemy.alive || enemy.kind !== 'charger' || enemy.dashTimer <= 0) continue;
      const ahead = { x: Math.cos(enemy.facing), y: Math.sin(enemy.facing) };
      const dx = world.player.pos.x - enemy.pos.x;
      const dy = world.player.pos.y - enemy.pos.y;
      // 이미 지나갔으면 비킬 것이 없다.
      if (dx * ahead.x + dy * ahead.y < 0) continue;
      // 직선에서 옆으로 얼마나 벗어나 있는가. 넉넉히 벗어나 있으면 어차피 빗나간다.
      const side = dx * -ahead.y + dy * ahead.x;
      if (Math.abs(side) > contactRadius + 0.6) continue;
      const sign = side >= 0 ? 1 : -1;
      return { move: { x: -ahead.y * sign, y: ahead.x * sign }, aim: null };
    }
    return inner(world);
  };
}

/**
 * 비킬 일이 없는 프레임에는 코어를 보고 걷는 사람. **지금까지의 `dodgeCharger`와
 * 같은 사람이고 같은 값을 낸다** — 감쌀 수 있게 한 겹으로 갈랐을 뿐이다
 * (`backOffBomber`·`neverStandStill`과 같은 문법).
 */
export const dodgeCharger = sidestepCharger();

/**
 * 방패병을 옆구리로 도는 사람. 그것 말고는 `walkToNearestCore`와 같다.
 *
 * **DESIGN 9번이 방패병에게 요구하는 단 하나의 대응이 이것이다** —
 * "정면 8발 대신 옆구리 3발로 도는 것이 답이다"(세션 21).
 * `walkToNearestCore`도 `dodgeCharger`도 이 한 가지를 하지 않는다. 그 두 사람이 재는
 * 방패병은 **돌 줄 모르는 사람이 본 방패병**이고, 그것은 그냥 체력이 8인 적이다.
 *
 * **보는 것은 화면에 있는 것뿐이다**(`dodgeCharger`와 같은 규칙). 자동 조준이 잡은 적
 * (`lockedEnemy` — 화면에 표적 고리가 돈다), 판이 남아 있는지(`shieldHp` — 성한 청록 ·
 * 닳은 잿빛 · 떨어져 나감), 어디를 두르고 있는지(`facing` — 판이 선 쪽).
 * 셋 다 세션 22가 화면에 세워 둔 것들이라(`shots/enemy-shield-*.png`) 사람이 할 수 없는
 * 일을 하지 않는다.
 *
 * 세 가지를 정해야 이 사람이 선다. 셋 다 실측으로 골랐다(듀얼 60초 · 방패병 하나):
 *
 * 1. **언제까지 도는가 — 판이 붙어 있는 동안 내내.** 열린 자리에 서서 쏘기만 하면
 *    적이 `SHIELD.turnRate`로 따라 돌아 곧 다시 막히고, 그러면 이 사람은 돌기와
 *    코어 줍기 사이를 오간다(세션 13이 밟은 그 떨림이다). 그래서 각도에 문턱을 두지 않는다.
 *    판이 떨어지면(`shieldHp` 0) 그냥 느린 활잡이라 돌 이유가 없다.
 * 2. **어느 쪽으로 — 지금 서 있는 쪽으로.** 반대로 돌면 정면을 한 번 더 지나가고
 *    그동안의 화살을 전부 판에 먹인다.
 * 3. **얼마나 붙어서 — 3m.** 이 값이 이 사람의 전부다. 거리 d에서 도는 각속도가
 *    `PLAYER.speed / d`이고 판이 따라 도는 속도가 0.8rad/s라, **9m 밖에서는 도는 것이
 *    손해고 붙을수록 빨라진다**(config의 `turnRate` 주석). 그래서 9m 밖에서는 도는 몫을
 *    0으로 두고 곧장 파고든다. 4.5m로 두면 판을 벗기는 데 3초가 걸려 정면으로 부수는 것과
 *    같아지고(실측 듀얼 막힘 27), 3m면 1초다(막힘 20 · 안 도는 사람 35).
 *    더 붙여도(2.4m) 나아지지 않는다 — 적이 물러나느라 오히려 멀어진다(막힘 24).
 */
/** 돌면서 유지하려는 거리(m). 적이 물러나는 선(`SHIELD.keepDistance` 6)보다 안쪽이다. */
const ORBIT = 3.0;
/** 이보다 멀면 도는 것이 손해다(m). `PLAYER.speed / d`가 `SHIELD.turnRate`와 같아지는 거리 9m. */
const TURN_PARITY = PLAYER.speed / SHIELD.turnRate;

export function orbitShield(
  inner: (world: World) => FrameInput = walkToNearestCore,
): (world: World) => FrameInput {
  return (world) => {
    const target = world.lockedEnemy;
    if (!target || !target.alive || target.kind !== 'shield' || target.shieldHp <= 0)
      return inner(world);

    const dx = world.player.pos.x - target.pos.x;
    const dy = world.player.pos.y - target.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return inner(world);

    // 적이 보는 방향에서 내가 몇 도나 비켜 서 있는가. `blocksArrow`가 재는 것과 같은 각이다.
    const offset = wrapAngle(Math.atan2(dy, dx) - target.facing);
    const sign = offset >= 0 ? 1 : -1;
    // 도는 몫과 붙는 몫을 더해 정규화한다. 멀리서 도는 것은 손해라 `TURN_PARITY` 밖에서는
    // 도는 몫이 0이 되어 곧장 파고들고, 붙고 나면 도는 몫만 남는다.
    const turn = clamp((TURN_PARITY - dist) / 2, 0, 1);
    const pull = clamp((dist - ORBIT) / 2, -1, 1);
    const move = {
      x: (-dy / dist) * sign * turn - (dx / dist) * pull,
      y: (dx / dist) * sign * turn - (dy / dist) * pull,
    };
    const len = Math.hypot(move.x, move.y);
    if (len < 1e-6) return inner(world);
    return { move: { x: move.x / len, y: move.y / len }, aim: null };
  };
}

/**
 * 돌 일이 없는 프레임에는 코어를 보고 걷는 사람. **지금까지의 `circleShield`와 같은
 * 사람이고 같은 값을 낸다** — 감쌀 수 있게 한 겹으로 갈랐을 뿐이다
 * (`dodgeCharger`가 `sidestepCharger`에서 갈라져 나온 것과 같은 문법).
 */
export const circleShield = orbitShield();

/**
 * 터질 원에서 걸어 나가는 사람. 물러날 일이 없는 프레임에는 `inner`가 걷는다.
 *
 * **DESIGN 9번이 폭탄병에게 요구하는 단 하나의 대응이 이것이다** — "물러나라"
 * (`data/config.ts`의 `BOMBER`). 앞의 두 사람은 이 한 가지를 하지 않는다:
 * `dodgeCharger`는 옆으로 비키고 `circleShield`는 옆으로 도는데, **둘 다 거리를
 * 그대로 둔다.** 터질 원은 붙어 선 자리보다 넓으므로(5.5 > 3.5m) 그 둘은 반드시 맞는다.
 *
 * **이 사람만 감싸는 꼴로 만든 이유 — 적이 넷이 되면서 한 사람이 답을 두 개 해야 한다.**
 * 앞의 셋은 저마다 `walkToNearestCore`로 떨어지는 독립된 사람이었다. 그래도 됐던 것은
 * 각자가 재는 적이 다른 적의 답을 망가뜨리지 않았기 때문이다. 폭탄병은 다르다 —
 * **방패병을 도는 사람은 돌기만 해서는 반드시 터진다**(거리를 그대로 두므로). 그 사람으로
 * 방패병을 재면 재는 것은 방패병이 아니라 그 사람의 빈 구멍이다(세션 51에 실제로 걸렸다:
 * `circleShield` 혼자의 가장 짧은 판이 108초로 **안 도는 사람보다 짧아졌다**).
 * 그래서 방패병·돌진형을 재는 자리에서는 `backOffBomber(circleShield)`처럼 씌워서 쓴다.
 *
 * **보는 것은 화면에 있는 것뿐이다**(`dodgeCharger`·`circleShield`와 같은 규칙).
 * 심지가 타는 폭탄병은 멈춰 서서 달아오르고 발밑에 터질 원이 그려져 있다
 * (`render/Renderer.ts`) — 그 원이 여기서 재는 원과 같은 원이다.
 *
 * **원 밖으로 나가는 것까지만 한다.** 이미 밖이면 물러날 이유가 없다 —
 * 겁먹고 계속 달아나는 사람은 코어를 줍지 못해 아래쪽 꼬리를 만들고,
 * 그것은 게임의 성질이 아니라 그 사람의 버릇이다(세션 18이 돌진형에서 밟았다).
 */
export function backOffBomber(
  inner: (world: World) => FrameInput = walkToNearestCore,
): (world: World) => FrameInput {
  return (world) => {
    for (const enemy of world.enemies) {
      if (!enemy.alive || enemy.kind !== 'bomber' || enemy.aimTimer <= 0) continue;
      const dx = world.player.pos.x - enemy.pos.x;
      const dy = world.player.pos.y - enemy.pos.y;
      const dist = Math.hypot(dx, dy);
      // 이미 원 밖이다. 남은 심지 동안 더 벌어질 만큼만 여유를 둔다(0.4m).
      if (dist > BOMBER.blastRadius + 0.4) continue;
      if (dist < 1e-6) return { move: { x: 1, y: 0 }, aim: null };
      return { move: { x: dx / dist, y: dy / dist }, aim: null };
    }
    return inner(world);
  };
}

/**
 * **떨어질 돌의 원에서 걸어 나가는 사람**(DESIGN 9번 · 투석병). 나갈 일이 없는 프레임에는
 * `inner`가 걷는다 — `backOffBomber`와 같은 문법이고, 보는 것도 화면에 있는 것뿐이다
 * (떨어질 자리에 원이 그려져 있다 · `entities/types.ts`의 `Lob`).
 *
 * **`neverStandStill`과 같은 적의 답인데, 답하는 방식이 다르다.** 저쪽은 "무슨 일이 있어도
 * 발을 떼라"이고 이쪽은 "떨어질 자리에서만 비켜라"다. 저쪽이 먼저 생긴 까닭은 세션 74가
 * 급히 막아야 했던 것이 **발이 멎는 몇 초**였기 때문인데, 그 대가로 **재는 사람이 영영 멎지
 * 못하게 됐다** — 세션 93이 멈춤 카드를 재다 걸린 자리가 그것이다(`tests/perf/tail.perf.ts`
 * 머리말). 이 한 겹은 같은 적을 막으면서 그 대가를 치르지 않는다.
 *
 * 세션 92가 `tests/perf/diag.perf.ts`에서 이 꼴로 먼저 썼고(멎는 사람의 `armed`),
 * 세션 94가 재는 사람 모두가 쓰도록 여기로 옮겼다.
 */
export function stepOutOfLob(
  inner: (world: World) => FrameInput = walkToNearestCore,
): (world: World) => FrameInput {
  return (world) => {
    for (const lob of world.lobs) {
      if (!lob.alive) continue;
      const dx = world.player.pos.x - lob.to.x;
      const dy = world.player.pos.y - lob.to.y;
      const dist = Math.hypot(dx, dy);
      // 이미 원 밖이다. 남은 비행 시간 동안 더 벌어질 만큼만 여유를 둔다(0.4m).
      if (dist > lob.radius + 0.4) continue;
      if (dist < 1e-6) return { move: { x: 1, y: 0 }, aim: null };
      return { move: { x: dx / dist, y: dy / dist }, aim: null };
    }
    return inner(world);
  };
}

/**
 * **겹을 쌓는 순서는 급한 것부터다**(세션 94가 480판으로 재서 정했다).
 * 위의 겹들은 제 일이 있는 프레임에만 움직이고 나머지는 `inner`에게 넘기므로,
 * 두 적이 한 프레임에 겹치면 **바깥에 있는 겹이 이긴다.** 그래서 순서가 값이다.
 *
 * 순서: **`backOffBomber` → `sidestepCharger` → `stepOutOfLob` → 제 적 → `holdWhenIdle`.**
 * 예고를 보고 빠져나가야 하는 시간이 그 차례다 — 심지 0.9초(2.0m를 걸어 나가야 한다) ·
 * 몸을 던진 돌진형 0.5초(`CHARGER.dashTime`) · 떨어질 돌 1.1초(`LOBBER.flight`) ·
 * 방패병은 급하지 않다(판이 도는 데 `SHIELD.turnRate` 0.8rad/s).
 *
 * 뒤집으면 뒤집은 쪽이 손해를 본다(같은 480판 · 150초에서 끊는다):
 * | | 비키는 사람 몸통 | 비키는 사람 돌 맞음 | 도는 사람 꼬리 | 도는 사람 돌 맞음 |
 * |---|---|---|---|---|
 * | **위 순서** | **31** | 32 | **9** | **12** |
 * | 돌을 돌진형보다 위에 | 61 | 11 | 9 | 12 |
 * | 돌을 방패병보다 아래에 | 31 | 32 | **19** | **43** |
 * 곧 `stepOutOfLob`은 **제자리에 묶는 겹**(돌기·멎기)보다는 위에, **더 급한 겹**(돌진형)보다는
 * 아래에 둔다. 두 자리 다 실측에서 나온 것이고, 어느 한쪽만 맞추면 다른 쪽이 운다.
 */
/** `holdNearEnemy`가 멎는 거리(m). 벼랑(9m) 바로 앞이다 — 아래 주석의 표를 보라. */
export const HOLD_RANGE = 8;

/**
 * **산 적이 `range`m 안에 있으면 발을 멈추고 쏘는 사람.** 아무도 없으면 `inner`가 걷는다.
 *
 * 왜 재는 사람에게 이것이 필요한가 — **자가 카드의 답을 모르면 그 카드를 잴 수 없다.**
 * 이 파일의 답을 아는 사람들은 적의 답만 알고 있었다(비키기 · 돌기 · 물러나기 · 안 멎기).
 * 그런데 "발을 멈추는 것"으로 값을 내는 카드가 나오면, 그 사람들은 **그 장을 뽑아도 영영
 * 못 쓰는 사람**이라 카드가 하는 일 대신 **카드가 한 장 더 있다는 것**만 재게 된다
 * (세션 93이 480판 표 셋으로 그것을 봤다). 세션 75가 투석병에서 메운 구멍과 같은 구멍이다.
 *
 * **8m라는 선은 적이 정한 수다.** 세션 92가 멎는 선을 여덟 자리 재서 **벼랑이 8 → 9m
 * 사이에 있는 것**을 찾았다(`diag.perf.ts`의 '맞는 순간 내 발이 멎어 있었는가'):
 * 8m에서 멎는 사람은 한 판 143초 · 레벨 13.6으로 걷는 사람(145초 · 14.0)과 같은데,
 * 9m에서 멎으면 108초로 무너진다. 그 선이 활잡이가 물러서는 거리다(`ARCHER.keepDistance`).
 *
 * **혼자서는 쓰지 마라.** 서 있는 사람은 떨어지는 돌과 터지는 심지와 달려드는 몸에
 * 반드시 맞는다. 그 셋을 감싼 뒤 맨 안쪽에 두는 자리다 —
 * `backOffBomber(sidestepCharger(stepOutOfLob(holdNearEnemy())))`.
 */
export function holdNearEnemy(
  /** 이 안에 산 적이 있으면 멎는다(m). 기본값은 세션 92가 잰 벼랑 바로 앞이다. */
  range = HOLD_RANGE,
  inner: (world: World) => FrameInput = walkToNearestCore,
): (world: World) => FrameInput {
  return (world) => {
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.pos.x - world.player.pos.x;
      const dy = enemy.pos.y - world.player.pos.y;
      if (dx * dx + dy * dy <= range * range) return IDLE;
    }
    return inner(world);
  };
}

/**
 * **갈 곳이 없을 때 어떻게 설 것인가.** `inner`가 갈 곳을 찾은 프레임에는 아무것도 하지 않고,
 * 발이 멎는 프레임에만 셋 중 하나를 고른다 — 적이 `range`m 안에 있으면 **멎은 채로 쏘고**,
 * 아니면 한복판으로 걷는다. 맨 안쪽에 두는 겹이다.
 *
 * **이 겹이 세션 74의 `neverStandStill`을 대신한다**(세션 94). 그 겹은 발이 멎는 프레임에
 * **무조건 걷게** 했다 — 투석병의 돌이 던지는 순간의 내 자리로 떨어지므로 서 있으면 반드시
 * 맞기 때문이다(세션 74에 재는 사람 둘의 꼬리가 0 → 5판으로 늘었다). 막은 것은 맞는데
 * **대가가 있었다: 재는 사람이 영영 멎지 못하게 됐다.** 그래서 세션 93이 '멈춤' 카드
 * (멎은 채 쏘면 더 깎는다)를 480판으로 쟀을 때, 답을 아는 사람들은 그 장을 뽑아도 못 쓰는
 * 사람이라 **카드가 하는 일 대신 카드가 한 장 더 있다는 것만** 재고 있었다.
 *
 * 돌은 이제 `stepOutOfLob`이 막는다. 그쪽이 더 잘 막는다 — 같은 480판에서:
 *
 * | 480판 · 150초에서 끊는다 | 비키는 사람 꼬리 | 도는 사람 꼬리 | 돌 맞음 |
 * |---|---|---|---|
 * | `neverStandStill` (세션 75~93) | 1 | 16 | 247 / 9533발 (2.6%) |
 * | `stepOutOfLob`만 | 2 | 13 | **11 / 9513발 (0.1%)** |
 * | `stepOutOfLob` + 이 겹 (지금) | **0** | **9** | 11 / 9466발 (0.1%) |
 *
 * **왜 "멎는 프레임에만"인가 — 늘 멎는 사람은 무너진다.** 같은 480판으로 `holdNearEnemy`를
 * 맨 안쪽에 그대로 두고(곧 적이 가까우면 코어를 두고 멎는 사람) 재면 이렇게 된다:
 *
 * | 늘 멎는 선 | 비키는 사람 꼬리 | 도는 사람 꼬리 | 적 화살 맞은 비 | 한 판 |
 * |---|---|---|---|---|
 * | 멎지 않는다(위 표 셋째 줄) | 0 | 9 | 11.8~14.4% | 150.0 / 149.4초 |
 * | 4m | 1 | 40 | 12.3~14.5% | 149.9 / 147.0초 |
 * | 6m | 11 | **66** | 13.9~16.2% | 149.6 / 143.7초 |
 * | **8m** | **173 (36%)** | **129 (27%)** | **18.5~25.4%** | 139.8 / 135.9초 |
 *
 * **세션 92가 "8m에서 멎는 것은 공짜다"라고 읽은 그 자리다**(`tests/perf/diag.perf.ts`의
 * '맞는 순간 내 발이 멎어 있었는가' · 한 판 143초 대 145초 · 레벨 13.6 대 14.0).
 * 그 표는 **150초에서 끊는 평균**으로 읽은 것이고, 평균은 꼬리를 거의 못 본다
 * (`tests/perf/tail.perf.ts` 머리말이 세션 66의 같은 오독을 정정한 그 이야기다).
 * 꼬리로 보면 8m는 공짜가 아니라 **이 자가 잰 것 중 가장 비싼 값**이다.
 */
export function holdWhenIdle(
  /** 이 안에 산 적이 있으면 멎은 채로 쏜다(m). */
  range = HOLD_RANGE,
  inner: (world: World) => FrameInput = walkToNearestCore,
): (world: World) => FrameInput {
  return (world) => {
    const input = inner(world);
    if (Math.hypot(input.move.x, input.move.y) > 0.01) return input;
    // 여기부터는 `inner`가 갈 곳을 못 찾은 프레임이다(코어가 다 떨어진 몇 초).
    // 적이 가까우면 그대로 멎어 선다 — 그 자리가 `holdNearEnemy`가 재는 자리와 같다.
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.pos.x - world.player.pos.x;
      const dy = enemy.pos.y - world.player.pos.y;
      if (dx * dx + dy * dy <= range * range) return input;
    }
    const { x, y } = world.player.pos;
    const away = Math.hypot(x, y);
    // 한복판에 서 있으면 어느 쪽이든 좋다. 한 방향을 정해 두어야 판이 씨앗마다 같아진다.
    // 벽 앞은 이 게임이 두 번 닫은 요새 자리라 피한다(`tests/maps.test.ts`의 '벽').
    if (away < 0.5) return { move: { x: 1, y: 0 }, aim: input.aim };
    return { move: { x: -x / away, y: -y / away }, aim: input.aim };
  };
}

/** 한 판을 끝까지 돌리고 남은 것. 씨앗 하나에 판 하나다. */
export interface MatchResult {
  seed: number;
  /** 쓰러질 때까지 걸린 시간(s). 끝까지 살아남았으면 돌린 시간 그대로. */
  elapsed: number;
  /** 그 안에 쓰러졌는가. false면 판이 제한 시간 안에 끝나지 않은 것이다. */
  defeated: boolean;
  level: number;
  kills: number;
  /** 고른 카드 id를 고른 순서대로. */
  cards: readonly string[];
  /** 돌진형의 몸에 닿힌 횟수. 한 대가 12점이라 판 길이를 가장 크게 흔든다. */
  bodyHits: number;
  /**
   * 폭탄병이 터진 횟수와, 그중 몸에 닿힌 횟수(DESIGN 9번).
   * **한 쌍이라야 뜻이 있다** — 터진 수는 "얼마나 붙게 뒀는가", 맞은 수는 "물러났는가"다.
   */
  blastsFired: number;
  blastHits: number;
  /**
   * 투석병이 던진 돌의 수와, 그중 내 몸에 떨어진 수(DESIGN 9번).
   * **한 쌍이라야 뜻이 있다** — 던진 수는 "얼마나 던지게 뒀는가", 맞은 수는 "비켰는가"다
   * (`blastsFired`/`blastHits`와 같은 짝). 재는 사람의 발을 바꾸는 바퀴는 이 쌍을 보고
   * **그 사람이 아직 이 적의 답을 알고 있는지** 확인한다(세션 94).
   */
  lobsThrown: number;
  lobHits: number;
  /** 방패병의 판에 막힌 내 화살의 수. `shieldBodyHits`와 짝을 이뤄야 뜻이 있다. */
  blocked: number;
  /**
   * 방패병의 **몸에** 꽂힌 내 화살의 수. `blocked`의 짝이다 —
   * **도는 사람과 안 도는 사람을 가르는 것은 둘의 비다**(`core/World.ts`의 주석).
   */
  shieldBodyHits: number;
  /** 내 화살이 적의 몸에 꽂힌 횟수(쓰러뜨리지 못한 것도 센다). `eatenMine`의 짝이다. */
  hits: number;
  /** 기둥이 먹은 내 화살의 수(DESIGN 10번). **그 맵이 게임에 닿아 있는지를 재는 값이다.** */
  eatenMine: number;
  /** 기둥이 먹은 적의 화살 수. 여기가 쌓이면 적이 기둥에 대고 쏘고 있다는 뜻이다. */
  eatenTheirs: number;
  /** 적이 쏜 화살의 수와, 그중 내 몸에 꽂힌 수. 피하기를 재는 한 쌍(세션 42). */
  enemyShots: number;
  arrowHits: number;
  /**
   * 체력이 처음 줄어든 시각(s). 한 번도 안 맞았으면 Infinity.
   * **판의 첫머리를 재는 값이다** — 손을 대기도 전에 맞으면 무엇에 맞았는지 알 수 없다
   * (DESIGN 품질 기준의 "설명 없이 30초 안에 이해할 것", `ENEMY.startDelay`).
   */
  firstHit: number;
}

/**
 * 씨앗 하나로 한 판을 끝까지 돌린다.
 *
 * **씨앗을 바꾸면 판이 통째로 달라진다.** World의 난수 하나가 코어 자리·드롭·
 * 뽑히는 카드를 모두 굴리기 때문에, 씨앗이 다르면 고른 카드의 순서가 갈리고
 * 한 판 길이가 실측 133~416초까지 흔들린다(세션 15에 잼).
 * 그래서 한 판 길이는 씨앗 하나가 아니라 여러 판의 중앙값으로 판단한다.
 */
export function playMatch(
  seed: number,
  maxSeconds = 600,
  /**
   * 어떻게 움직이는 사람인가. 기본값은 코어만 보고 걷는 사람이다 —
   * **이 자를 바꾸면 지금까지 잰 수치와 견줄 수 없게 되므로 기본값은 옮기지 않는다.**
   * 다른 사람을 재고 싶으면 여기에 넣어 나란히 재라(`dodgeCharger` · `circleShield`).
   */
  input: (world: World) => FrameInput = walkToNearestCore,
  /** 어떻게 고르는 사람인가. 기본값은 아무거나 고르는 사람이다 — 위와 같은 이유로 옮기지 않는다. */
  choose: Chooser = takeAny,
  /**
   * 어느 아레나에서 재는가 (DESIGN 10번). 기본값은 기본 맵이다 —
   * 지금까지 쌓인 수치가 전부 그 맵의 것이라, 여기를 옮기면 옛 표와 견줄 수 없다.
   */
  map: ArenaMap = DEFAULT_MAP,
): MatchResult {
  const world = new World({ seed, map });
  // 한 스텝씩 돌리며 체력이 처음 줄어드는 순간을 잡는다. `play`를 그대로 쓰는 이유:
  // 카드를 고르는 규칙이 두 벌이 되면 두 자가 서로 다른 사람을 재게 된다.
  let firstHit = Infinity;
  const steps = Math.round(60 * maxSeconds);
  for (let i = 0; i < steps && !world.defeated; i += 1) {
    const hp = world.player.hp;
    play(world, 1, input, choose);
    if (firstHit === Infinity && world.player.hp < hp) firstHit = world.elapsed;
  }
  return {
    seed,
    elapsed: world.elapsed,
    defeated: world.defeated,
    level: world.progress.level,
    kills: world.kills,
    cards: [...world.takenUpgrades],
    bodyHits: world.bodyHits,
    blastsFired: world.blastsFired,
    blastHits: world.blastHits,
    lobsThrown: world.lobsThrown,
    lobHits: world.lobHits,
    blocked: world.blockedShots,
    shieldBodyHits: world.shieldBodyHits,
    hits: world.hits,
    eatenMine: world.eatenMine,
    eatenTheirs: world.eatenTheirs,
    enemyShots: world.enemyShots,
    arrowHits: world.arrowHits,
    firstHit,
  };
}

/** 정렬된 표본에서 분위수 하나. 표본이 적으므로 보간하지 않고 가까운 자리를 고른다. */
export function quantile(sorted: readonly number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index] ?? 0;
}

/** 중앙값. 짝수 개면 가운데 둘의 평균 — 표본이 스무 개라 한쪽으로 치우치지 않게 한다. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
