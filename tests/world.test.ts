import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World';
import {
  AIM,
  ARENA,
  ARROW,
  BOMBER,
  BURST,
  CHARGER,
  CORE,
  ENEMY,
  PLAYER,
  REINFORCE,
  REVIVE,
  SHIELD,
} from '../src/data/config';
import type { FrameInput } from '../src/core/World';
import type { Enemy } from '../src/entities/types';
import type { Vec2 } from '../src/core/math';
import { MAPS } from '../src/data/maps';
import { insideObstacle } from '../src/systems/obstacles';

const DT = 1 / 60;
const idle: FrameInput = { move: { x: 0, y: 0 }, aim: null };

function run(world: World, seconds: number, input: FrameInput = idle): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) world.step(input, DT);
}

/**
 * 한 판을 쓰러질 때까지 돌린다. 먼저 돌아다니며 레벨과 카드를 쌓고, 그다음 멈춰 선다.
 * 처음부터 서 있으면 31초 만에 1레벨로 죽어서 "무엇을 잃고 무엇을 지켰는가"를 잴 수 없다.
 */
function playUntilDefeat(world: World): void {
  for (let i = 0; i < 60 * 200 && !world.defeated; i += 1) {
    // 카드가 뜨면 골라서 내린다. 안 고르면 멈춘 채로 영영 죽지 않는다.
    if (world.offer) {
      world.chooseUpgrade(world.offer.choices[0]!.card.id);
      continue;
    }
    const angle = i * DT * 1.1;
    const roaming = i < 60 * 40;
    world.step({ move: roaming ? { x: Math.cos(angle), y: Math.sin(angle) } : { x: 0, y: 0 }, aim: null }, DT);
  }
}

describe('World', () => {
  it('가만히 둬도 자동 조준으로 적을 맞힌다 (버튼 없이 발사)', () => {
    const world = new World();
    run(world, 3);
    expect(world.hits).toBeGreaterThan(0);
  });

  it('이동 입력을 주면 그 방향으로 간다', () => {
    const world = new World();
    run(world, 0.5, { move: { x: 1, y: 0 }, aim: null });
    expect(world.player.pos.x).toBeGreaterThan(1);
  });

  it('수동 조준이 자동 조준을 이긴다', () => {
    const world = new World();
    // 적이 하나도 없는 뒤쪽(+x)으로 조준한다.
    run(world, 1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 } });
    expect(world.lockedEnemy).toBeNull();
    expect(Math.abs(world.player.facing)).toBeLessThan(0.05);
  });

  it('수동 조준을 놓으면 잠깐 뒤 자동 조준으로 돌아온다', () => {
    const world = new World();
    run(world, 1, { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 } });
    run(world, AIM.manualHold + 0.2);
    expect(world.lockedEnemy).not.toBeNull();
  });

  it('화살은 무한정 쌓이지 않는다 (수명이 지나면 정리된다)', () => {
    const world = new World();
    run(world, 20);
    // 적이 쏘는 몫까지 세지만, 수명이 다한 것은 매 스텝 치워진다.
    expect(world.arrows.length).toBeLessThan(20);
  });

  it('적도 화살을 쏜다 (주인이 다른 화살이 같은 하늘을 난다)', () => {
    const world = new World();
    let sawEnemyArrow = false;
    let sawPlayerArrow = false;
    for (let i = 0; i < 60 * 40 && !world.defeated; i += 1) {
      world.step(idle, DT);
      for (const arrow of world.arrows) {
        if (arrow.owner === 'enemy') sawEnemyArrow = true;
        else sawPlayerArrow = true;
      }
    }
    expect(sawPlayerArrow).toBe(true);
    expect(sawEnemyArrow).toBe(true);
  });

  /**
   * DESIGN 품질 기준: "처음 하는 사람이 설명 없이 30초 안에 조작을 이해할 것".
   *
   * 처음 선 적은 전부 `fireCooldown` 0으로 태어나 **첫 프레임부터 겨눴다** —
   * 배치의 활잡이 둘이 13m(`fireRange` 15 안쪽)에 서 있어, 180판을 재니 첫 피격이
   * 3초 안에 온 판이 90판이었다(가장 이른 것 0.9초). 손을 대기도 전에 맞으면
   * 무엇에 맞았는지 알 수 없다. `ENEMY.startDelay`가 그 자리를 막는다.
   *
   * **"쏘지 않는다"가 아니라 "겨누지도 않는다"를 잰다.** 겨눔은 예고이자 멈춤이라,
   * 준비 시간 동안 겨누고 있으면 준비 시간이 끝나는 순간 화살이 나간다 — 그러면
   * 기다린 것이 아무 일도 하지 않은 것이 된다.
   */
  it('판이 시작하고 준비 시간 동안에는 아무도 겨누지 않는다 (DESIGN 품질 기준)', () => {
    const world = new World();
    const startDistances = world.enemies.map((e) => Math.hypot(e.pos.x, e.pos.y));

    run(world, ENEMY.startDelay);

    for (const enemy of world.enemies) {
      expect(enemy.aimTimer, `적 ${enemy.id}가 겨누고 있다`).toBe(0);
      expect(enemy.dashTimer, `적 ${enemy.id}가 몸을 던졌다`).toBe(0);
    }
    expect(world.arrows.some((a) => a.owner === 'enemy')).toBe(false);
    expect(world.player.hp).toBe(PLAYER.maxHp);

    // 그렇다고 멈춰 서 있지는 않는다. 다가오는 적이 보여야 무슨 게임인지 읽힌다 —
    // 얼어붙은 적 다섯은 고장으로 보인다.
    const moved = world.enemies.filter(
      (e, i) => Math.abs(Math.hypot(e.pos.x, e.pos.y) - (startDistances[i] ?? 0)) > 0.5,
    );
    expect(moved.length, '준비 시간 동안 적이 한 발짝도 움직이지 않았다').toBeGreaterThan(0);
  });

  /**
   * 준비 시간은 **예고 시간과 더해서** 뜻이 생긴다. 준비가 끝나는 순간 곧바로 아픈 것이
   * 아니라, 거기서 겨눔(활잡이 `aimTime`) 또는 웅크림(돌진형 `windup`)이 한 번 더 붙는다.
   * 그 합이 첫 대가 올 수 있는 가장 이른 시각이다 — 실측 3.0초(스무 판 × 두 사람).
   * 값을 만질 때 이 합이 3초 밑으로 내려가면 첫 2초 문제가 그대로 돌아온다.
   */
  it('첫 대가 올 수 있는 가장 이른 시각이 3초보다 이르지 않다', () => {
    const earliest = ENEMY.startDelay + Math.min(ENEMY.aimTime, CHARGER.windup);
    expect(earliest, `준비 ${ENEMY.startDelay}초 + 예고`).toBeGreaterThanOrEqual(2.9);
  });

  it('적을 쓰러뜨리려면 여러 발이 든다', () => {
    const world = new World();
    for (let i = 0; i < 600 && world.kills === 0; i += 1) world.step(idle, DT);
    expect(world.kills).toBe(1);
    // 체력이 붙었으므로 명중 수와 처치 수는 더 이상 같지 않다.
    expect(world.hits).toBeGreaterThanOrEqual(ENEMY.maxHp);
  });

  /**
   * **활잡이 하나만 세워 잰다.** 표준 배치로 재던 검사인데, 재는 것이 "화살 한 대의 크기"라
   * 배치에 몸으로 오는 적(돌진형·폭탄병)이 있으면 그 적이 먼저 닿아 자가 흔들린다 —
   * 세션 51에 실제로 걸렸다(폭탄병을 넣자 첫 피격이 화살 5점이 아니라 몸통 12점이 됐다).
   * 어느 적이 먼저 닿는가는 배치의 성질이고, 여기서 재려는 것은 **화살의 성질**이다.
   */
  it('적의 화살이 플레이어의 체력을 깎는다', () => {
    const world = new World({ enemies: [{ x: 0, y: -13 }] });
    // 가만히 서 있으면 적이 다가와 겨누고 쏜다. 그것이 이 게임의 유일한 위협이다.
    for (let i = 0; i < 60 * 30 && world.player.hp === PLAYER.maxHp; i += 1) world.step(idle, DT);
    expect(world.player.hp).toBeLessThan(PLAYER.maxHp);
    expect(world.player.hp).toBe(PLAYER.maxHp - ENEMY.arrow.damage);
  });

  it('돌진형의 몸통도 화살과 같은 무적 규칙을 지난다 (DESIGN 9번)', () => {
    // 돌진형 하나만 세운다. 5m면 준비 시간(`ENEMY.startDelay`)이 지나는 대로 웅크리고,
    // 그 뒤에 몸이 날아온다. 여기서 재는 것은 "언제 닿는가"가 아니라
    // "한 번의 돌진이 몇 번 아픈가"다.
    //
    // **반대쪽(-x)을 겨눈 채로 기다린다.** 자동 발사는 그대로 나가지만 화살이 빗나가므로
    // 이 놈이 다가오는 동안 쓰러지지 않는다. 하나만 세운 판에서는 플레이어의 화살이
    // 전부 이 한 놈에게 가서, 겨누지 않고 두면 **웅크리자마자 매번 쓰러진다**
    // (씨앗 열둘 · 120초 동안 몸통 0대 — 세션 49에 다시 설 자리가 16m로 바뀌면서 그렇게 됐다).
    // 판 안에서 이 적이 순해진 것은 아니다. 오히려 한 판에 닿는 몸통은 23 → 35대로 늘었다
    // (`tests/progression.test.ts`의 '몸통 박치기'). 여기서만 화력이 한곳에 몰릴 뿐이다.
    const away: FrameInput = { move: { x: 0, y: 0 }, aim: { x: -1, y: 0 } };
    const world = new World({ enemies: [{ x: 5, y: 0, kind: 'charger' }] });
    for (let i = 0; i < 60 * 12 && world.player.hp === PLAYER.maxHp; i += 1) world.step(away, DT);

    // 한 번의 돌진은 딱 한 번 깎는다. 몸이 겹쳐 있는 여러 프레임 동안 계속 깎이면
    // 예고 한 번에 판이 끝난다.
    expect(world.player.hp).toBe(PLAYER.maxHp - CHARGER.damage);
    expect(world.player.invulnerable).toBeGreaterThan(0);
    expect(world.player.hitFlash).toBe(1);

    const hp = world.player.hp;
    run(world, PLAYER.invulnerable - DT, away);
    expect(world.player.hp).toBe(hp);
  });

  it('체력이 다하면 판이 끝나고 시간이 멈춘다', () => {
    const world = new World();
    for (let i = 0; i < 60 * 120 && !world.defeated; i += 1) {
      // 카드가 뜨면 골라서 내린다. 서 있어도 코어는 쌓이므로(돌진형이 발밑까지 와서
      // 쓰러진다 — DESIGN 9번) 고르지 않으면 멈춘 채로 영영 죽지 않는다.
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step(idle, DT);
    }
    expect(world.defeated).toBe(true);
    expect(world.isPaused).toBe(true);

    // 쓰러진 뒤에는 무엇을 넣어도 아무 일도 일어나지 않는다.
    const frozen = { elapsed: world.elapsed, kills: world.kills, pos: { ...world.player.pos } };
    for (let i = 0; i < 300; i += 1) world.step({ move: { x: 1, y: 0 }, aim: null }, DT);
    expect(world.elapsed).toBe(frozen.elapsed);
    expect(world.kills).toBe(frozen.kills);
    expect(world.player.pos).toEqual(frozen.pos);
  });

  it('부활하면 그 자리에서 레벨과 카드를 유지한 채 다시 선다', () => {
    const world = new World();
    playUntilDefeat(world);
    expect(world.defeated).toBe(true);

    const before = {
      level: world.progress.level,
      stats: { ...world.stats },
      taken: [...world.takenUpgrades],
      pos: { ...world.player.pos },
      elapsed: world.elapsed,
      kills: world.kills,
    };
    expect(before.taken.length).toBeGreaterThan(0);

    expect(world.revive()).toBe(true);

    // 되돌아온 것은 몸뿐이다.
    expect(world.defeated).toBe(false);
    expect(world.isPaused).toBe(false);
    expect(world.player.hp).toBe(PLAYER.maxHp);
    expect(world.player.invulnerable).toBe(REVIVE.invulnerable);
    expect(world.revives).toBe(1);
    // 쌓아 온 것은 그대로다 — 이것이 리스폰과 부활을 가르는 유일한 차이다.
    expect(world.progress.level).toBe(before.level);
    expect(world.stats).toEqual(before.stats);
    expect(world.takenUpgrades).toEqual(before.taken);
    expect(world.player.pos).toEqual(before.pos);
    expect(world.elapsed).toBe(before.elapsed);
    expect(world.kills).toBe(before.kills);

    // 그리고 다시 흐른다. 멈춘 채로 남는 것이 이 기능의 가장 나쁜 고장이다.
    run(world, 0.5);
    expect(world.elapsed).toBeGreaterThan(before.elapsed);
  });

  it('부활 직후에는 날아오던 화살도, 겨누던 적도 없다', () => {
    const world = new World();
    playUntilDefeat(world);
    expect(world.defeated).toBe(true);

    world.revive();
    expect(world.arrows.some((arrow) => arrow.owner === 'enemy')).toBe(false);
    expect(world.enemies.every((enemy) => enemy.aimTimer === 0)).toBe(true);

    // 무적이 끝나기 전에 도망칠 틈이 있어야 한다(적의 발사 지연 < 무적 시간).
    run(world, REVIVE.enemyDelay);
    expect(world.player.hp).toBe(PLAYER.maxHp);
    expect(world.player.invulnerable).toBeGreaterThan(0);
  });

  it('쓰러지지 않았으면 부활하지 않는다 (무적을 공짜로 얻지 못한다)', () => {
    const world = new World();
    run(world, 1);
    expect(world.revive()).toBe(false);
    expect(world.revives).toBe(0);
    expect(world.player.invulnerable).toBeLessThan(REVIVE.invulnerable);
  });

  it('리스폰(새 판)은 레벨도 카드도 남기지 않는다', () => {
    const played = new World();
    playUntilDefeat(played);
    expect(played.progress.level).toBeGreaterThan(1);

    // 리스폰은 World를 통째로 새로 만드는 것이다(main.ts). 되돌릴 값을 하나씩 세지 않으므로
    // 새 판이 방금 켠 게임과 같은지만 보면 된다 — 여기서 빠지는 값이 지난 판의 찌꺼기다.
    const fresh = new World();
    expect(fresh.progress.level).toBe(1);
    expect(fresh.progress.totalXp).toBe(0);
    expect(fresh.takenUpgrades).toEqual([]);
    expect(fresh.upgradeStacks).toEqual({});
    expect(fresh.kills).toBe(0);
    expect(fresh.elapsed).toBe(0);
    expect(fresh.revives).toBe(0);
    expect(fresh.defeated).toBe(false);
    expect(fresh.offer).toBeNull();
    expect(fresh.player.hp).toBe(PLAYER.maxHp);
    expect(fresh.player.pos).toEqual({ x: 0, y: 0 });
    expect(fresh.arrows).toEqual([]);
    expect(fresh.stats).toEqual({
      fireCooldown: ARROW.cooldown,
      moveSpeed: PLAYER.speed,
      magnetRadius: CORE.magnetRadius,
      xpMultiplier: 1,
      arrowCount: 1,
      pierce: 0,
      bounce: 0,
      knockback: 0,
      backstep: 0,
      burstRadius: 0,
    });
  });

  it('플레이어는 자기 화살에 맞지 않는다', () => {
    // 적이 없는 아레나. 자동 발사는 조준할 것이 없어도 계속 쏘므로,
    // 화살이 총구(몸에서 0.9m)에서 생기는 이 상황이 자기 화살에 맞기 가장 쉬운 판이다.
    const world = new World({ enemies: [] });
    for (let i = 0; i < 60 * 20; i += 1) {
      // 제자리에서 방향을 계속 바꾼다 — 방금 쏜 화살 위로 걸어 들어가는 경우까지 만든다.
      world.step({ move: { x: Math.cos(i * 0.2), y: Math.sin(i * 0.2) }, aim: null }, DT);
    }
    expect(world.arrows.length).toBeGreaterThan(0);
    expect(world.player.hp).toBe(PLAYER.maxHp);
    expect(world.defeated).toBe(false);
  });

  it('플레이어는 어떤 입력에도 아레나를 벗어나지 않는다', () => {
    const world = new World();
    for (let i = 0; i < 2000 && !world.defeated; i += 1) {
      const angle = i * 0.31;
      world.step({ move: { x: Math.cos(angle), y: Math.sin(angle) }, aim: null }, DT);
      expect(Number.isFinite(world.player.pos.x)).toBe(true);
      expect(Math.hypot(world.player.pos.x, world.player.pos.y)).toBeLessThanOrEqual(26);
    }
  });
});

/**
 * **폭탄병이 터진 뒤** (DESIGN 9번 · `World.detonate`).
 *
 * 한 프레임의 규칙(언제 불을 붙이고 언제 터지는가)은 `tests/enemies.test.ts`에 있다.
 * 여기서 재는 것은 **터진 원이 무엇에 닿는가** 하나다 — 그 판단은 World의 일이고
 * (무적 시간과 코어와 처치 수를 쥔 쪽이 여기다), 이 적이 요구하는 "물러나라"가
 * 실제로 답이 되는지는 이 세 줄에 걸려 있다.
 */
describe('World — 폭탄병이 터진 자리', () => {
  /** 폭탄병 하나만 세운 판. 다른 적이 있으면 무엇이 체력을 깎았는지 알 수 없다. */
  const soloBomber = (): World => new World({ enemies: [{ x: 0, y: -8, kind: 'bomber' }] });

  /**
   * 폭탄병을 `at`에 세우고 **다음 한 스텝에 터뜨린다.**
   *
   * 판을 그냥 돌려 기다리지 않는 이유: 자동 조준이 늘 가장 가까운 적을 잡으므로
   * (걸어오는 이 적이 곧 그 적이다) 혼자 세워 두면 붙기 전에 지워진다 — 그것이 이 적의
   * 성질이고(`BOMBER.maxHp`), 그 성질 때문에 "터졌을 때 무슨 일이 일어나는가"를
   * 판으로는 잴 수 없다. 재려는 것은 **터진 원이 무엇에 닿는가** 하나다.
   */
  function detonateAt(world: World, at: Vec2): void {
    const bomber = world.enemies[0]!;
    bomber.pos = { x: at.x, y: at.y };
    bomber.fireCooldown = 0;
    bomber.aimTimer = DT / 2; // 이번 스텝에 심지가 다 탄다.
    world.step(idle, DT);
    expect(world.blastsFired).toBe(1);
  }

  it('원 안에서 터지면 맞는다', () => {
    const world = soloBomber();
    detonateAt(world, { x: 0, y: -(BOMBER.blastRadius - 0.5) });
    expect(world.blastHits).toBe(1);
    expect(world.player.hp).toBe(PLAYER.maxHp - BOMBER.damage);
  });

  it('원 밖이면 맞지 않는다 (그리는 원이 곧 맞히는 원이다)', () => {
    // **이 한 줄이 이 적의 전부다.** 발밑 고리(`render/models.ts`의 `aimRing`)가 그리는
    // 원과 여기서 재는 원이 같은 값(`BOMBER.blastRadius`)이라, 고리 밖으로 걸어 나간
    // 사람은 반드시 안 맞는다. 어긋나면 화면에서 이 적을 배울 수 없다.
    const world = soloBomber();
    detonateAt(world, { x: 0, y: -(BOMBER.blastRadius + 0.5) });
    expect(world.blastHits).toBe(0);
    expect(world.player.hp).toBe(PLAYER.maxHp);
  });

  it('제 몸을 터뜨린 것은 처치로 세지 않고 코어도 떨구지 않는다', () => {
    // 가만히 서서 맞아 주는 것이 경험치를 버는 길이 되면 안 된다.
    const world = soloBomber();
    detonateAt(world, { x: 0, y: -(BOMBER.blastRadius - 0.5) });
    expect(world.kills).toBe(0);
    expect(world.cores.filter((c) => c.origin === 'drop')).toHaveLength(0);
    // 그래도 눕기는 눕는다 — 다시 설 자리를 잡고 `respawnDelay` 뒤에 돌아온다.
    expect(world.enemies[0]?.alive).toBe(false);
  });

  it('쏘아 눕히면 처치로 세고 코어를 떨군다 (터뜨리기 전에 지우는 쪽 답)', () => {
    // 위 검사의 짝이다. 둘이 함께 있어야 "쏘거나 물러나거나"가 둘 다 값을 갖는다.
    const world = soloBomber();
    for (let i = 0; i < 60 * 30 && world.kills === 0; i += 1) world.step(idle, DT);
    expect(world.kills).toBe(1);
    expect(world.blastsFired).toBe(0);
    expect(world.cores.filter((c) => c.origin === 'drop').length).toBeGreaterThan(0);
  });

  it('터진 자국은 잠깐 남았다 스스로 사라진다 (게임 규칙에 닿지 않는다)', () => {
    const world = soloBomber();
    detonateAt(world, { x: 0, y: -(BOMBER.blastRadius - 0.5) });
    expect(world.blasts).toHaveLength(1);
    expect(world.blasts[0]?.radius).toBe(BOMBER.blastRadius);

    const hpAfterBlast = world.player.hp;
    run(world, BOMBER.flashTime + 0.1);
    expect(world.blasts).toHaveLength(0);
    // 자국이 남아 있는 동안 두 번 아프지 않는다 — 폭발이 하는 일은 그 프레임에 다 끝난다.
    expect(world.player.hp).toBe(hpAfterBlast);
  });
});

/**
 * **파열이 낸 처치도 처치다** (DESIGN 8번 · 열한째 카드 · 세션 60).
 *
 * 한 프레임의 규칙(누가 깎이고 무엇이 연쇄하지 않는가)은 `tests/systems.test.ts`에 있다.
 * 여기서 재는 것은 **그 처치가 판에 어떻게 셈해지는가**다 — 코어와 처치 수와 다시 설
 * 자리를 쥔 쪽이 World이고, 화살이 눕힌 적과 파열이 눕힌 적이 여기서 갈리면
 * "어떻게 죽였는가"에 따라 같은 처치의 값이 달라진다.
 */
describe('World — 파열이 쓰러뜨린 적', () => {
  /** 파열 사거리 안에 둘을 세운 판. 플레이어 앞(+x)에 나란히 선다. */
  const pair = (): World =>
    new World({
      enemies: [
        { x: 6, y: 0 },
        { x: 7.6, y: 0 },
      ],
    });

  /** 카드를 고른 사람으로 만든다. 카드를 실제로 뽑아 고르는 길은 `tests/upgrades.test.ts`가 잰다. */
  function withBurst(world: World, radius = 2.2): World {
    world.stats.burstRadius = radius;
    return world;
  }

  /**
   * 앞의 적이 화살에 쓰러질 때까지 돌린다. **둘을 매 프레임 제자리에 붙들어 둔다** —
   * 적은 걸어오므로 그냥 돌리면 쓰러지는 순간의 사이 거리를 판이 정해 버리고,
   * 재려는 것(그 처치가 어떻게 셈해지는가)이 자리 운을 탄다.
   * 뒤의 적은 파열 한 번에 눕는 체력으로 둔다 — 화살은 늘 가장 가까운 앞의 적에게 간다.
   */
  function killFront(world: World): void {
    const [front, back] = world.enemies as [Enemy, Enemy];
    for (let i = 0; i < 60 * 20 && front.alive; i += 1) {
      front.pos = { x: 6, y: 0 };
      back.pos = { x: 7.6, y: 0 };
      back.hp = BURST.damage;
      world.step(idle, DT);
    }
  }

  it('곁에 선 적이 함께 쓰러지면 처치로 세고 코어도 떨군다', () => {
    const world = withBurst(pair());
    killFront(world);
    // 화살이 눕힌 하나와 파열이 눕힌 하나.
    expect(world.kills).toBe(2);
    expect(world.enemies.every((e) => !e.alive)).toBe(true);
    expect(world.cores.filter((c) => c.origin === 'drop')).toHaveLength(2);
    // 다시 설 자리도 함께 잡혔다 — 둘 다 눕는 그 순간 잡는다(`pickRespawnSpot`).
    for (const enemy of world.enemies) {
      expect(Math.hypot(enemy.standAt.x, enemy.standAt.y)).toBeLessThanOrEqual(ARENA.radius);
    }
  });

  it('카드가 없으면 곁의 적은 멀쩡하다', () => {
    const world = pair();
    killFront(world);
    expect(world.kills).toBe(1);
    expect(world.burstsFired).toBe(0);
    expect(world.enemies[1]?.alive).toBe(true);
  });

  it('터진 자국이 제 색과 제 수명으로 선다 (폭탄병의 자국과 갈린다)', () => {
    const world = withBurst(pair());
    killFront(world);
    const mark = world.blasts[0];
    expect(world.burstsFired).toBeGreaterThan(0);
    expect(mark?.kind, '폭탄병의 자국과 같은 색으로 그려진다').toBe('burst');
    expect(mark?.radius).toBe(2.2);
    expect(mark?.life).toBe(BURST.flashTime);

    // 자국은 스스로 사라지고, 남아 있는 동안 아무것도 더 깎지 않는다.
    const hpLeft = world.enemies.map((e) => e.hp);
    run(world, BURST.flashTime + 0.1);
    expect(world.blasts.filter((b) => b.kind === 'burst')).toHaveLength(0);
    expect(world.enemies.map((e) => e.hp)).toEqual(hpLeft);
  });

  it('터진 횟수와 깎은 횟수를 따로 센다 (곁에 아무도 없으면 0이다)', () => {
    const world = withBurst(new World({ enemies: [{ x: 6, y: 0 }] }));
    for (let i = 0; i < 60 * 20 && world.kills === 0; i += 1) world.step(idle, DT);
    expect(world.burstsFired).toBe(1);
    expect(world.burstHits, '곁에 아무도 없었다').toBe(0);
  });
});

/**
 * DESIGN 품질 기준의 "한 판이 3~5분 안에 끝날 것"을 붙잡아 두는 장치(`REINFORCE`).
 * 판 길이가 화력의 함수가 되지 않도록, 시간이 갈수록 아레나가 무거워진다.
 *
 * 여기서는 "언제 · 몇 마리 · 어디에"만 본다. 그것이 한 판 길이에 실제로 하는 일은
 * `tests/progression.test.ts`가 씨앗 20개로 잰다.
 */
describe('World — 증원', () => {
  /** 체력을 계속 되돌리며 오래 돌린다. 증원은 분 단위라 그냥 돌리면 먼저 쓰러진다. */
  function survive(world: World, seconds: number): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      world.player.hp = world.player.maxHp;
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step(idle, DT);
    }
  }

  const layout = 5;

  /**
   * **`interval`과 `maxExtra`는 짝이다. 하나만 옮기면 아무 일도 일어나지 않는다**(세션 25).
   *
   * 증원이 다 들어오고 나면 아레나는 그대로 굳고, 그 뒤로는 사람만 계속 자란다
   * (레벨 상한이 40인데 한 판의 중앙값이 Lv17이라 자랄 자리가 남아 있다).
   * **위쪽 꼬리는 바로 그 굳은 구간에 산다.** 그래서 마지막 증원은
   * 한 판 합격선(6분)보다 늦게 와야 한다 — 그래야 판이 끝날 때까지 천장이 계속 내려온다.
   *
   * 세션 25가 이 자리를 두 번 헛디뎠다. `interval`만 45 → 32로 줄이자 증원이 빨리 오는
   * 대신 여덟 자리를 빨리 다 써서 마지막이 435 → 344초로 **당겨졌고**, 꼬리는 그대로였다
   * (451 → 444초). `maxExtra`만 8 → 12로 늘렸을 때는 아홉째가 480초에 와서
   * 표가 한 글자도 바뀌지 않았다. 둘을 함께 옮겨야 값이 산다.
   */
  it('증원이 다 들어오기 전에는 한 판이 끝나지 않는다 — 두 값은 짝이다', () => {
    const last = REINFORCE.firstDelay + (REINFORCE.maxExtra - 1) * REINFORCE.interval;
    // 합격선 360초는 `tests/progression.test.ts`의 '가장 긴 판도 6분을 넘지 않는다'와 같은 선이다.
    expect(last, `마지막 증원 ${last}초`).toBeGreaterThanOrEqual(360);
  });

  it('증원 표의 길이가 자리 수와 같다', () => {
    // 표가 자리 수보다 짧으면 `updateReinforcements`가 나머지 연산으로 앞으로 돌아가,
    // 표를 세어 본 사람이 무엇이 몇 번 오는지 틀리게 읽는다. 표로 둔 이유가 사라진다.
    expect(REINFORCE.order).toHaveLength(REINFORCE.maxExtra);
  });

  it('첫 증원 전까지는 처음 배치 그대로다', () => {
    const world = new World();
    survive(world, REINFORCE.firstDelay - 5);
    expect(world.enemies).toHaveLength(layout);
  });

  it('시간이 지나면 한 마리씩 들어온다', () => {
    const world = new World();
    survive(world, REINFORCE.firstDelay + 1);
    expect(world.enemies).toHaveLength(layout + 1);
    survive(world, REINFORCE.interval);
    expect(world.enemies).toHaveLength(layout + 2);
  });

  it('무한정 늘지는 않는다 — 상한에서 멈춘다', () => {
    // 상한에 닿고도 한참 더 돌린다. 여기가 뚫리면 오래 버틴 사람의 화면에서만
    // 프레임이 무너진다(부하 측정이 잡아 둔 선은 적 20마리다).
    const world = new World();
    survive(world, REINFORCE.firstDelay + REINFORCE.interval * (REINFORCE.maxExtra + 3));
    expect(world.enemies).toHaveLength(layout + REINFORCE.maxExtra);
  });

  /**
   * **뭉침을 재는 자다** (세션 39 · `shots/crowd-15.png`에서 눈으로 본 것이다).
   *
   * 증원 자리를 무작위 각도 하나로만 뽑으면, 열 자리가 우연히 한쪽에 몰린다 —
   * 화면에서는 대여섯이 한 덩어리로 서고 반대쪽 절반이 빈다. 프레임이 아니라
   * **읽히는가**의 문제다(어디서 오는지가 한쪽만 보고도 짐작되면 안 된다).
   *
   * 자는 이렇다: 다 들어온 뒤 **화면에 서 있는 적 전부**(처음 배치 다섯 + 증원 `maxExtra`개)의
   * 방위각을 플레이어에서 재어 정렬하고, 그중 **가장 넓은 빈 부채꼴**을 잰다.
   * 열일곱이 고르게 서면 360/17 ≒ 21도다.
   *
   * **처음 선 자리가 아니라 지금 서 있는 자리를 잰다 (세션 49).** 세션 39가 이 자를 만들 때는
   * 쓰러진 적이 처음 선 자리로 돌아왔으므로 그 자리들이 곧 화면이었다. 이제는 다시 설 자리를
   * 눕을 때마다 새로 고르므로(`World.pickRespawnSpot`), **처음 선 자리는 판이 열리고 1분 뒤의
   * 화면을 더 이상 말해 주지 않는다.** 같은 판을 두 자로 재면 이렇게 갈린다(씨앗 20개):
   * | 무엇을 재는가 | 세션 48까지 | 지금 |
   * |---|---|---|
   * | 처음 선 자리 | 중앙 44도 · 최악 57도 | 중앙 60도 · 최악 112도 |
   * | **서 있는 자리** | 중앙 52도 · 최악 56도 | **중앙 43도 · 최악 46도** |
   * 화면은 오히려 더 고르게 찼는데 옛 자로는 뭉친 것처럼 보인다. 눈으로 보는 것을 재야 한다.
   *
   * **판 안에서 0.5초마다 재어 그 판의 중앙값을 쓴다.** 적은 걸어 다니므로 한순간을 집으면
   * 우연히 한쪽이 비는 때가 잡힌다(같은 판의 순간 최악값은 63~80도로 튄다).
   *
   * **플레이어가 가만히 선 판에서 잰다.** 고르는 쪽도 플레이어에서 본 방위각을 쓰므로
   * (`pickReinforceSpawn`), 자와 자를 대는 곳이 같아진다.
   *
   * **처음 배치까지 함께 세는 이유**: 화면에 서는 것은 열일곱이지 열둘이 아니다.
   * 증원끼리만 고르게 서도 고정 배치와 겹치면 화면에서는 그대로 뭉쳐 보인다.
   */
  it('증원이 한쪽에 뭉치지 않는다 — 빈 쪽부터 채운다', () => {
    const TAU = Math.PI * 2;
    /** 정렬한 방위각 사이의 가장 넓은 빈 부채꼴(도). */
    function widestGap(angles: readonly number[]): number {
      const sorted = angles.map((a) => ((a % TAU) + TAU) % TAU).sort((a, b) => a - b);
      let widest = 0;
      for (let i = 0; i < sorted.length; i += 1) {
        const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + TAU;
        widest = Math.max(widest, next - sorted[i]!);
      }
      return (widest * 180) / Math.PI;
    }

    const mid = (xs: readonly number[]): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

    const gaps: number[] = [];
    for (let seed = 1; seed <= 20; seed += 1) {
      const world = new World({ seed });
      survive(world, REINFORCE.firstDelay + REINFORCE.interval * REINFORCE.maxExtra);
      expect(world.enemies).toHaveLength(layout + REINFORCE.maxExtra);

      // 다 들어온 뒤 1분을 더 돌리며 0.5초마다 화면을 잰다.
      const samples: number[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        world.player.hp = world.player.maxHp;
        if (world.offer) {
          world.chooseUpgrade(world.offer.choices[0]!.card.id);
          continue;
        }
        world.step(idle, DT);
        if (i % 30 !== 0) continue;
        samples.push(
          widestGap(
            world.enemies.map((e) => {
              // 쓰러져 있는 적은 곧 설 자리로 센다. 화면에서 잠깐 비는 것은 뭉침이 아니다.
              const at = e.alive ? e.pos : e.standAt;
              return Math.atan2(at.y - world.player.pos.y, at.x - world.player.pos.x);
            }),
          ),
        );
      }
      gaps.push(mid(samples));
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const worst = sorted[sorted.length - 1]!;
    const show = `중앙 ${median.toFixed(0)}도 · 최악 ${worst.toFixed(0)}도`;
    // 실측 중앙 43도 · 최악 46도. 선은 그 위에 한 뼘 띄워 둔다 — 여기가 깨지면
    // 자리를 고르는 둘(`pickReinforceSpawn` · `pickRespawnSpot`) 중 하나가 무너진 것이다.
    expect(median, show).toBeLessThanOrEqual(50);
    expect(worst, show).toBeLessThanOrEqual(55);
  });

  it('증원은 플레이어 코앞이 아니라 벽 가까이에서 걸어 들어온다', () => {
    // **플레이어를 벽에 붙여 세우고 잰다.** 가운데 서 있으면 벽 쪽 어디에 나타나도
    // 멀어서, 코앞에 나타나는 고장을 잡지 못한다. 벽에 붙으면 증원이 설 자리의
    // 5분의 1이 코앞이라, 자리를 고르는 규칙이 없으면 여기서 걸린다.
    const world = new World();
    const steps = Math.round((REINFORCE.firstDelay + REINFORCE.interval * 4) / DT);
    let seen = layout;
    for (let i = 0; i < steps; i += 1) {
      world.player.hp = world.player.maxHp;
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step({ move: { x: 1, y: 0 }, aim: null }, DT);
      while (seen < world.enemies.length) {
        const joined = world.enemies[seen]!;
        seen += 1;
        expect(Math.hypot(joined.home.x, joined.home.y)).toBeCloseTo(REINFORCE.spawnRadius, 6);
        expect(
          Math.hypot(joined.home.x - world.player.pos.x, joined.home.y - world.player.pos.y),
        ).toBeGreaterThanOrEqual(REINFORCE.minPlayerDistance);
      }
    }
    expect(seen).toBeGreaterThan(layout);
    // 벽 밖에 서지 않는다(몸 반지름까지 넣어서).
    expect(REINFORCE.spawnRadius).toBeLessThanOrEqual(ARENA.radius - ENEMY.radius);
  });

  it('세 종류가 다 섞여 들어온다 — 한 종류만 늘면 요구하는 것도 하나로 준다', () => {
    const world = new World();
    survive(world, REINFORCE.firstDelay + REINFORCE.interval * REINFORCE.maxExtra);
    const joined = world.enemies.slice(layout);
    // 표(`REINFORCE.order`)에 적힌 그대로 들어와야 한다. 표를 고치면 이 검사가 함께 움직인다.
    expect(joined.map((e) => e.kind)).toEqual([...REINFORCE.order]);
    for (const kind of ['archer', 'charger', 'shield'] as const) {
      expect(joined.filter((e) => e.kind === kind).length).toBeGreaterThan(0);
    }
  });

  it('증원으로 들어온 방패병도 방패를 들고 있다', () => {
    // 처음 배치와 증원이 다른 길로 세워지면(생성자 · updateReinforcements) 한쪽만
    // 방패를 빠뜨리기 쉽다 — 세우는 길을 `spawnEnemy` 하나로 모아 둔 이유다.
    // **들어온 그 순간에 본다.** 판을 끝까지 돌리고 나서 보면 이미 몇 대 맞은 뒤라
    // 방패를 들고 왔는지 맞아서 깎인 것인지 구별할 수 없다.
    const world = new World();
    const nth = REINFORCE.order.indexOf('shield') + 1;
    expect(nth).toBeGreaterThan(0);
    // **들어온 프레임에서 바로 본다.** 전에는 들어오는 시각 + 1초까지 돌리고 봤는데,
    // 증원 간격이 32초로 줄자(세션 25) 그 1초 안에 내 화살이 판에 한 발 꽂혀
    // `shieldHp`가 5가 아니라 4로 잡혔다 — 방패를 안 들고 온 것과 구별되지 않는 자리다.
    // 여유를 늘리는 대신 여유를 없앤다(증원이 선 자리를 재는 위 검사와 같은 방법).
    const target = world.enemies.length + nth;
    let joined: Enemy | undefined;
    const steps = Math.round((REINFORCE.firstDelay + REINFORCE.interval * (nth - 1) + 1) / DT);
    for (let i = 0; i < steps && !joined; i += 1) {
      world.player.hp = world.player.maxHp;
      if (world.offer) {
        world.chooseUpgrade(world.offer.choices[0]!.card.id);
        continue;
      }
      world.step(idle, DT);
      if (world.enemies.length >= target) joined = world.enemies[world.enemies.length - 1];
    }
    expect(joined, `${nth}번째 증원이 들어오지 않았다`).toBeDefined();
    expect(joined?.kind).toBe('shield');
    expect(joined?.shieldHp).toBe(SHIELD.shieldHp);
  });

  it('이어하기로 살아나도 증원은 되돌아가지 않는다', () => {
    // 부활은 몸만 되돌린다(DESIGN 6번). 시계가 이어지므로 아레나도 이어져야 한다 —
    // 광고를 본 사람에게 쉬운 판을 새로 깔아 주면 이어하기가 판을 되감는 버튼이 된다.
    const world = new World();
    survive(world, REINFORCE.firstDelay + 1);
    const before = world.enemies.length;
    world.player.hp = 0;
    world.step(idle, DT);
    world.revive();
    survive(world, 1);
    expect(world.enemies.length).toBe(before);
  });
});

/**
 * **다시 서는 적은 어디서 오는가** (세션 49 · DESIGN 5번).
 *
 * 세션 48까지는 쓰러진 적이 **처음 선 자리**로 돌아갔다. 그 자리들은 맵에 못 박혀 있으므로
 * 거기서 가장 먼 곳 — 곧 벽 앞 — 에 서면 한 번 눕힐 때마다 적이 걸어 돌아오는 20~30m를
 * 벌었고, 손을 놓고도 120초를 버티는 자리가 세 맵 모두에 있었다(한복판 40초).
 * 지금은 **플레이어를 둘러싼 고리 위**에 선다(`ENEMY.respawnDistance`).
 *
 * 한 판의 결과로 재는 자는 `tests/maps.test.ts`에 있다(벽 앞에서 초당 날아오는 화살 수).
 * 여기서는 그 규칙 자체를 한 프레임으로 본다 — 결과만 재면 무엇이 움직였는지 모른다.
 */
describe('World — 쓰러진 적이 다시 서는 자리', () => {
  /** 적 하나를 눕히고, 다시 설 때까지 돌린다. 돌려주는 것은 일어선 그 자리다. */
  function fellAndRose(world: World, enemy: Enemy, between?: () => void): Vec2 {
    enemy.hp = 0;
    enemy.alive = false;
    enemy.respawnTimer = ENEMY.respawnDelay;
    // World가 자리를 예약하는 것은 화살이 눕힌 순간이지만, 확정은 일어서기 직전이다.
    // 여기서는 손으로 눕혔으므로 예약 없이 확정만 지나간다 — 그것도 같은 값이어야 한다.
    for (let i = 0; i < 60 * 10 && !enemy.alive; i += 1) {
      between?.();
      world.step(idle, DT);
    }
    expect(enemy.alive).toBe(true);
    return enemy.pos;
  }

  const fromPlayer = (world: World, at: Vec2): number =>
    Math.hypot(at.x - world.player.pos.x, at.y - world.player.pos.y);

  it('플레이어가 벽에 붙어 서 있어도 한복판에 서 있을 때와 같은 거리에서 온다', () => {
    for (const spot of [
      { x: 0, y: 0 },
      { x: 23, y: 0 },
      { x: -20, y: 12 },
    ]) {
      const world = new World({ seed: 7, enemies: [{ x: 10, y: 0 }] });
      world.player.pos = { x: spot.x, y: spot.y };
      const risen = fellAndRose(world, world.enemies[0]!);
      expect(
        fromPlayer(world, risen),
        `(${spot.x}, ${spot.y})에 선 사람에게서 ${fromPlayer(world, risen).toFixed(1)}m`,
      ).toBeCloseTo(ENEMY.respawnDistance, 6);
      // 벽 밖에 세우지 않는다. 고리가 아레나 밖으로 나가는 자리에서도 마찬가지다.
      expect(Math.hypot(risen.x, risen.y)).toBeLessThanOrEqual(ARENA.radius - ENEMY.radius + 1e-6);
    }
  });

  /**
   * **자리는 눕는 순간이 아니라 일어서기 직전에 정해진다.**
   * 그러지 않으면 3.6초 동안 플레이어가 최대 25m를 가므로(속도 7.2m/s)
   * "플레이어에게서 16m"라는 규칙이 **뛰어다니는 사람에게만 거짓**이 된다.
   * 실측(예순 판 p90): 눕는 순간에만 고르면 344초, 일어서기 직전에 다시 고르면 304초다.
   */
  it('눕힌 뒤 플레이어가 반대편으로 달아나도 그 자리에서 16m다', () => {
    const world = new World({ seed: 7, enemies: [{ x: 10, y: 0 }] });
    const enemy = world.enemies[0]!;
    const before = { x: world.player.pos.x, y: world.player.pos.y };
    const risen = fellAndRose(world, enemy, () => {
      world.player.pos = { x: 22, y: 0 };
    });
    expect(Math.hypot(world.player.pos.x - before.x, world.player.pos.y - before.y)).toBeGreaterThan(
      20,
    );
    expect(fromPlayer(world, risen)).toBeCloseTo(ENEMY.respawnDistance, 6);
  });

  it('기둥 속에는 서지 않는다', () => {
    const map = MAPS.find((m) => m.obstacles.length > 0)!;
    for (let seed = 1; seed <= 30; seed += 1) {
      const world = new World({ seed, map, enemies: [{ x: 10, y: 0 }] });
      const risen = fellAndRose(world, world.enemies[0]!);
      expect(
        insideObstacle(risen, ENEMY.radius, map.obstacles),
        `씨앗 ${seed}에서 기둥 속에 섰다`,
      ).toBe(false);
    }
  });

  it('처음 선 자리는 그대로 남는다 — 어디서 들어왔는지를 되물을 수 있어야 한다', () => {
    const world = new World({ seed: 7, enemies: [{ x: 10, y: 0 }] });
    const enemy = world.enemies[0]!;
    const home = { ...enemy.home };
    fellAndRose(world, enemy);
    expect(enemy.home).toEqual(home);
    expect(enemy.standAt).not.toEqual(home);
  });
});
