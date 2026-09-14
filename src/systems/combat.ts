import { length, segmentPointDistanceSq, type Vec2 } from '../core/math';
import type { Arrow, Enemy, Obstacle, Player } from '../entities/types';
import { findNearestEnemy } from './autoAim';
import { blockedByObstacles } from './obstacles';

export interface ArrowStepOptions {
  dt: number;
  arenaRadius: number;
  arrowRadius: number;
  enemyRadius: number;
  playerRadius: number;
  /** 한 대 맞은 뒤 다시 맞지 않는 시간(s). */
  invulnerable: number;
  /** 적이 쓰러진 뒤 다시 서기까지의 시간(s). */
  respawnDelay: number;
  /** 튕긴 화살이 다음 상대를 찾는 거리(m). 이 안에 아무도 없으면 튕기지 못하고 사라진다. */
  bounceRange: number;
  /** 방패병의 방패가 막는 정면 부채꼴의 반각(rad, DESIGN 9번). */
  shieldArc: number;
  /** 이 맵에 선 기둥들(DESIGN 10번). 빈 배열이면 아무것도 막지 않는다. */
  obstacles: readonly Obstacle[];
  /** 적의 화살이 노리는 사람. */
  player: Player;
  /** 플레이어의 화살이 노리는 것들. */
  enemies: readonly Enemy[];
}

export interface ArrowStepResult {
  /** 적을 맞힌 횟수(쓰러뜨리지 못한 것도 센다). */
  hits: number;
  /**
   * 이번 스텝에 쓰러진 적들. **수가 아니라 적 자신을 돌려준다** —
   * 부르는 쪽이 쓰러진 자리에 코어를 떨어뜨리고(3번) 다시 설 자리를 정해 준다
   * (`World.pickRespawnSpot`). 판정은 이미 이 안에서 끝났으므로 그 자리에서 알려 준다.
   * 그러지 않으면 World가 "어느 적이 방금 죽었는지"를 매 프레임 다시 훑어야 한다.
   *
   * **쓰러진 자리는 `enemy.pos`다.** 적은 죽은 프레임에 더 움직이지 않고
   * (`stepEnemies`가 건너뛴다) 다시 설 때 비로소 자리가 바뀐다(`revive`).
   */
  killed: Enemy[];
  /** 플레이어가 이번 스텝에 받은 피해 총량. */
  damageTaken: number;
  /**
   * 적의 화살이 플레이어의 몸에 꽂힌 횟수. `damageTaken`과 따로 세는 이유:
   * 카드가 자라면 한 대의 크기가 달라져 피해량으로는 **몇 발을 맞았는가**를 알 수 없다.
   * 피하기를 재는 쪽이 보는 값이다(무적에 그냥 지나간 화살은 여기 들어오지 않는다).
   */
  playerHits: number;
  /** 방패에 막힌 화살 수(DESIGN 9번). 몸을 맞힌 것이 아니므로 `hits`와 따로 센다. */
  blocked: number;
  /**
   * **기둥이 먹은 화살의 수**(DESIGN 10번). 주인별로 따로 센다 — 같은 숫자가 두 가지
   * 다른 이야기를 하기 때문이다.
   *
   * - `eatenMine`(플레이어) — **이 맵이 게임에 닿아 있다는 증거다.** 기둥 뜰에서는 내가 쏜
   *   화살의 일곱 중 다섯이 기둥에 박힌다. 여기가 0에 가까워지면 그 맵은 그림만 다른 맵이다.
   * - `eatenTheirs`(적) — **고장의 신호다.** 적은 맞힐 수 없는 곳에 쏘지 않는다
   *   (`enemyAi.ts`의 시야 판정). 여기가 쌓인다는 것은 기둥 뒤에 선 사람에게 적이
   *   화살을 먹이며 제자리에 서 있다는 뜻이고, 그 자리는 손을 놓고도 오래 버티는 자리가 된다.
   *
   * 둘 다 `tests/maps.test.ts`가 선을 긋는다.
   */
  eatenMine: number;
  eatenTheirs: number;
}

/**
 * 화살을 한 스텝 움직이고 부딪힌 것을 처리한다.
 *
 * **화살은 주인이 노리는 것만 맞힌다** — 플레이어의 화살은 적을, 적의 화살은 플레이어를.
 * 이 한 줄이 없으면 난전에서 적이 서로를 쏴 죽이고 플레이어는 제 화살에 죽는다.
 *
 * 죽은 화살은 배열에서 지우지 않고 alive=false 로 두고, 호출한 쪽이 정리한다
 * (렌더러가 같은 프레임에 메시를 회수해야 하기 때문).
 *
 * 화살이 적을 맞히고도 살아남는 길은 둘이다(DESIGN 8번). **순서가 있다.**
 * 1. 관통(`arrow.pierce`)이 남았으면 **가던 방향 그대로** 뚫고 지나간다.
 * 2. 관통을 다 썼고 튕김(`arrow.bounce`)이 남았으면 **다음 적 쪽으로 꺾어** 다시 난다.
 *
 * 관통을 먼저 쓰는 이유: 두 카드를 함께 가진 화살이 첫 적에게서 곧바로 꺾이면
 * "뚫고 지나간다"는 관통의 그림이 화면에서 사라진다. 뚫을 만큼 뚫고, 더 못 갈 때 꺾는다.
 *
 * 두 경우 모두 맞힌 적을 `arrow.hitIds`에 적어 두고 다시 맞히지 않는다.
 *
 * **살아남지 못하는 길이 하나 있다 — 방패병의 방패다**(`blocksArrow`).
 * 막힌 화살은 관통도 튕김도 쓰지 못하고 그 자리에서 끝난다. 카드 한 장이
 * 방패를 무시해 버리면 "돌아서 쏴라"는 이 적의 규칙이 그 카드를 뽑은 판에서만 사라진다.
 */
export function stepArrows(arrows: Arrow[], options: ArrowStepOptions): ArrowStepResult {
  const { dt, arenaRadius, arrowRadius, enemyRadius, playerRadius, player, enemies } = options;
  const enemyHitSq = (arrowRadius + enemyRadius) ** 2;
  const playerHitSq = (arrowRadius + playerRadius) ** 2;
  const result: ArrowStepResult = {
    hits: 0,
    killed: [],
    damageTaken: 0,
    playerHits: 0,
    blocked: 0,
    eatenMine: 0,
    eatenTheirs: 0,
  };

  for (const arrow of arrows) {
    if (!arrow.alive) continue;
    const from = { x: arrow.pos.x, y: arrow.pos.y };
    const to = { x: from.x + arrow.vel.x * dt, y: from.y + arrow.vel.y * dt };
    arrow.pos = to;
    arrow.age += dt;

    if (arrow.owner === 'player') {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        // 이미 뚫고 지나온 적은 건너뛴다. 이 한 줄이 없으면 관통 화살이 한 놈의 몸
        // 안에 머무는 몇 프레임 동안 계속 꽂혀, 관통이 아니라 연타가 된다.
        if (arrow.hitIds?.includes(enemy.id)) continue;
        if (segmentPointDistanceSq(from, to, enemy.pos) > enemyHitSq) continue;

        // 방패가 받아 냈다. 몸에는 닿지 않았으므로 체력도 명중도 움직이지 않는다.
        if (blocksArrow(enemy, arrow.vel, options.shieldArc)) {
          enemy.shieldHp = Math.max(0, enemy.shieldHp - arrow.damage);
          enemy.shieldFlash = 1;
          result.blocked += 1;
          arrow.alive = false;
          break;
        }

        enemy.hp -= arrow.damage;
        enemy.hitFlash = 1;
        result.hits += 1;
        if (enemy.hp <= 0) {
          enemy.alive = false;
          enemy.hp = 0;
          enemy.aimTimer = 0;
          enemy.respawnTimer = options.respawnDelay;
          result.killed.push(enemy);
        }

        if (arrow.pierce > 0) {
          // 뚫고 나간다. 남은 적들도 계속 본다 — 적 둘이 한 프레임 안에 겹쳐 있는
          // 드문 경우(막 되살아난 자리)에도 화살이 사라지지 않고 제 몫을 해야 한다.
          arrow.pierce -= 1;
          (arrow.hitIds ??= []).push(enemy.id);
          continue;
        }

        // 뚫을 몫은 끝났다. 튕길 몫이 남았으면 방향을 꺾고, 아니면 여기서 끝난다.
        // 꺾은 뒤에는 이번 프레임의 나머지 적을 보지 않는다 — 갈 길이 이미 달라졌다.
        if (!bounceArrow(arrow, enemy, enemies, options.bounceRange)) arrow.alive = false;
        break;
      }
    } else if (
      // 무적인 동안에는 화살이 그냥 지나간다. 여기서 막지 않으면 동시에 날아온
      // 여러 발이 한꺼번에 꽂혀, 맞은 줄도 모르고 죽는다.
      player.invulnerable <= 0 &&
      player.hp > 0 &&
      segmentPointDistanceSq(from, to, player.pos) <= playerHitSq
    ) {
      damagePlayer(player, arrow.damage, options.invulnerable);
      arrow.alive = false;
      result.damageTaken += arrow.damage;
      result.playerHits += 1;
    }

    if (!arrow.alive) continue;
    // 기둥에 막혔다(DESIGN 10번). **적을 맞히는 판정 뒤에 본다** — 기둥 바로 앞에 선
    // 적을 맞힌 화살은 맞힌 것으로 세야 한다. 순서를 뒤집으면 기둥에 등을 붙인 적이
    // 무적이 된다. 관통도 튕김도 쓰지 못한다(방패와 같은 규칙): 카드 한 장이
    // 지형을 무시해 버리면 숨을 자리가 그 판에서만 사라진다.
    if (blockedByObstacles(from, arrow.pos, arrowRadius, options.obstacles)) {
      arrow.alive = false;
      if (arrow.owner === 'enemy') result.eatenTheirs += 1;
      else result.eatenMine += 1;
      continue;
    }
    if (arrow.age >= arrow.lifetime || length(arrow.pos) > arenaRadius) {
      arrow.alive = false;
    }
  }

  return result;
}

/**
 * 이 화살을 방패가 받아 내는가 (DESIGN 9번 · 방패병).
 *
 * **세 가지가 모두 참이어야 막힌다.** 하나씩이 이 적의 규칙 하나씩이다:
 * 1. 방패병이고 방패가 아직 남아 있다 — 정면으로만 쏴도 결국 부서진다(`SHIELD.shieldHp`).
 * 2. **겨누고 있지 않다** — 쏘려면 방패를 내려야 한다. 가장 위험한 순간이 곧
 *    가장 무른 순간이라, 예고를 보고 피할지 쏠지를 고르게 된다.
 * 3. **정면 부채꼴 안에서 날아왔다**(`arc`) — 옆구리와 등은 그냥 뚫린다.
 *
 * 방향은 화살이 **날아온 쪽**으로 잰다(위치가 아니라 속도로).
 * 화살은 한 프레임에 제 몸통보다 멀리 나아가 몸 반대편에서 판정되기도 하므로,
 * 위치로 재면 정면으로 쏜 화살이 등에서 맞은 것으로 읽히는 프레임이 생긴다.
 */
export function blocksArrow(enemy: Enemy, arrowVel: Vec2, arc: number): boolean {
  if (enemy.kind !== 'shield' || enemy.shieldHp <= 0 || enemy.aimTimer > 0) return false;
  const speed = length(arrowVel);
  if (speed < 1e-6) return false;
  // 화살이 나아가는 방향과 적이 보는 방향이 마주 볼수록 −1에 가깝다.
  const facing = Math.cos(enemy.facing) * (arrowVel.x / speed)
    + Math.sin(enemy.facing) * (arrowVel.y / speed);
  return facing <= -Math.cos(arc);
}

/**
 * 화살을 다음 상대 쪽으로 꺾는다(DESIGN 8번 · 튕김). 갈 곳이 없으면 false.
 *
 * 세 가지를 함께 되돌린다 — 하나라도 빠지면 카드가 뜻대로 동작하지 않는다.
 * - **방향**: 속력은 그대로 두고 방향만 바꾼다. 튕겼다고 느려지면 피할 수 있게 된다.
 * - **수명**: 다시 0부터 센다. 튕김은 새 비행이라, 남은 수명으로 재면 멀리 있는
 *   다음 상대에게 닿기도 전에 사라져 카드가 아무 일도 하지 않은 것처럼 보인다.
 * - **기억**: 방금 맞힌 놈만 남기고 지운다. 지나온 모두를 계속 기억하면 둘 사이를
 *   오갈 수 없고, 아무도 기억하지 않으면 빠져나가는 몇 프레임 동안 같은 놈에게 도로 꽂힌다.
 */
function bounceArrow(
  arrow: Arrow,
  from: Enemy,
  enemies: readonly Enemy[],
  range: number,
): boolean {
  if (arrow.bounce <= 0) return false;
  const next = findNearestEnemy(arrow.pos, enemies, range, from.id);
  if (!next) return false;

  const dx = next.pos.x - arrow.pos.x;
  const dy = next.pos.y - arrow.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return false;

  const speed = length(arrow.vel);
  arrow.vel = { x: (dx / dist) * speed, y: (dy / dist) * speed };
  arrow.bounce -= 1;
  arrow.age = 0;
  arrow.hitIds = [from.id];
  return true;
}

/**
 * 플레이어가 한 대 맞는다. **아프게 하는 길은 전부 이 함수를 지난다** —
 * 적의 화살(`stepArrows`)도, 돌진형의 몸통(DESIGN 9번)도.
 * 무적 시간을 여기 한 곳에 두지 않으면, 새로 생긴 공격이 무적을 무시하는 고장이
 * 종류마다 따로 생긴다.
 *
 * 무적이거나 이미 쓰러졌으면 아무 일도 없이 false.
 */
export function damagePlayer(player: Player, amount: number, invulnerable: number): boolean {
  if (player.invulnerable > 0 || player.hp <= 0) return false;
  player.hp = Math.max(0, player.hp - amount);
  player.invulnerable = invulnerable;
  player.hitFlash = 1;
  return true;
}

/** 무적 시간과 피격 연출을 흘려보낸다. */
export function stepPlayerRecovery(player: Player, dt: number): void {
  if (player.invulnerable > 0) player.invulnerable = Math.max(0, player.invulnerable - dt);
  if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt * 2.2);
}

/**
 * 체력을 되돌린다 (DESIGN 8번 · 회복 카드). 되돌린 양을 돌려준다.
 *
 * **이미 쓰러진 몸은 일으키지 않는다** — `damagePlayer`가 "쓰러진 뒤에는 더 아프지 않다"고
 * 정한 것과 같은 자리다. 죽은 자리에서 돌아오는 길은 부활 하나뿐이고(DESIGN 6번),
 * 카드가 그 자리를 겸하면 쓰러짐이 무슨 뜻인지 흐려진다.
 *
 * 최대 체력을 넘겨 채우지 않는다. 넘치는 몫은 그냥 버려진다 —
 * 가득 찬 사람이 고르면 손해라는 것이 이 카드가 언제 값진지를 정한다.
 */
export function healPlayer(player: Player, amount: number): number {
  if (player.hp <= 0 || amount <= 0) return 0;
  const healed = Math.min(amount, player.maxHp - player.hp);
  player.hp += healed;
  return healed;
}
