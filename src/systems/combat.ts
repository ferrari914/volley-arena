import { clamp, length, type Vec2 } from '../core/math';
import type { Arrow, Enemy, Player } from '../entities/types';
import { findNearestEnemy } from './autoAim';

/**
 * 선분 a→b 위에서 점 c까지의 최단 거리의 제곱.
 * 화살은 한 프레임에 자기 몸통보다 멀리 날아가므로, 위치만 비교하면
 * 대상을 통과해도 지나쳐 버린다. 이동 궤적 전체로 판정한다.
 */
export function segmentPointDistanceSq(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq < 1e-12 ? 0 : clamp(((c.x - a.x) * abx + (c.y - a.y) * aby) / lenSq, 0, 1);
  const dx = a.x + abx * t - c.x;
  const dy = a.y + aby * t - c.y;
  return dx * dx + dy * dy;
}

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
  /** 적의 화살이 노리는 사람. */
  player: Player;
  /** 플레이어의 화살이 노리는 것들. */
  enemies: readonly Enemy[];
}

export interface ArrowStepResult {
  /** 적을 맞힌 횟수(쓰러뜨리지 못한 것도 센다). */
  hits: number;
  /** 이번 스텝에 쓰러진 적의 수. */
  kills: number;
  /**
   * 쓰러진 자리들. 경험치 코어가 여기에 떨어진다(3번).
   * 위치를 여기서 돌려주지 않으면 World가 "어느 적이 방금 죽었는지"를
   * 다시 훑어야 한다 — 판정은 이미 이 안에서 끝났으므로 그 자리에서 알려 준다.
   */
  killPoints: Vec2[];
  /** 플레이어가 이번 스텝에 받은 피해 총량. */
  damageTaken: number;
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
 */
export function stepArrows(arrows: Arrow[], options: ArrowStepOptions): ArrowStepResult {
  const { dt, arenaRadius, arrowRadius, enemyRadius, playerRadius, player, enemies } = options;
  const enemyHitSq = (arrowRadius + enemyRadius) ** 2;
  const playerHitSq = (arrowRadius + playerRadius) ** 2;
  const result: ArrowStepResult = { hits: 0, kills: 0, killPoints: [], damageTaken: 0 };

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

        enemy.hp -= arrow.damage;
        enemy.hitFlash = 1;
        result.hits += 1;
        if (enemy.hp <= 0) {
          enemy.alive = false;
          enemy.hp = 0;
          enemy.aimTimer = 0;
          enemy.respawnTimer = options.respawnDelay;
          result.kills += 1;
          result.killPoints.push({ x: enemy.pos.x, y: enemy.pos.y });
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
    }

    if (!arrow.alive) continue;
    if (arrow.age >= arrow.lifetime || length(arrow.pos) > arenaRadius) {
      arrow.alive = false;
    }
  }

  return result;
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
