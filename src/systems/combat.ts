import { clamp, length, type Vec2 } from '../core/math';
import type { Arrow, Enemy, Player } from '../entities/types';

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
 * 관통(`arrow.pierce`)이 남아 있는 화살은 맞히고도 사라지지 않고 계속 날아간다.
 * 대신 맞힌 적을 `arrow.hitIds`에 적어 두고 다시 맞히지 않는다.
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

        if (arrow.pierce <= 0) {
          arrow.alive = false;
          break;
        }
        // 뚫고 나간다. 남은 적들도 계속 본다 — 적 둘이 한 프레임 안에 겹쳐 있는
        // 드문 경우(막 되살아난 자리)에도 화살이 사라지지 않고 제 몫을 해야 한다.
        arrow.pierce -= 1;
        (arrow.hitIds ??= []).push(enemy.id);
      }
    } else if (
      // 무적인 동안에는 화살이 그냥 지나간다. 여기서 막지 않으면 동시에 날아온
      // 여러 발이 한꺼번에 꽂혀, 맞은 줄도 모르고 죽는다.
      player.invulnerable <= 0 &&
      player.hp > 0 &&
      segmentPointDistanceSq(from, to, player.pos) <= playerHitSq
    ) {
      player.hp = Math.max(0, player.hp - arrow.damage);
      player.invulnerable = options.invulnerable;
      player.hitFlash = 1;
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

/** 무적 시간과 피격 연출을 흘려보낸다. */
export function stepPlayerRecovery(player: Player, dt: number): void {
  if (player.invulnerable > 0) player.invulnerable = Math.max(0, player.invulnerable - dt);
  if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt * 2.2);
}
