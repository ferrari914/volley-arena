import { describe, expect, it } from 'vitest';
import { ARROW, ENEMY } from '../../src/data/config';
import { World } from '../../src/core/World';
import { play, preferPower, walkToNearestCore } from '../support/match';
import {
  CURRENT_CAMERA,
  bodyScreenHeight,
  isOffScreen,
  makeProjector,
  type CameraSpec,
  type Projector,
} from '../support/camera';

/**
 * **카메라 값을 고치는 바퀴가 보는 표.** 후보 카메라마다 "안 보이는 곳에서 벌어지는 일"이
 * 얼마나 되는지 센다(씨앗 20판 · 화면비 둘).
 *
 * 왜 여기에 있나: 세션 29가 카메라를 뒤로 뺄 때 이 표를 임시 파일로 짜서 재고 지웠다.
 * `balance.perf.ts` 머리말과 같은 이유로 못 박는다 — 지운 자는 다음 바퀴가 재현하지 못한다.
 * **카메라의 자리·기울기·시야각을 만지는 바퀴는 고치기 전후로 이 표를 나란히 놓아라.**
 *
 * **한 판을 후보마다 다시 돌리지 않는다.** 카메라는 시뮬레이션에 아무 영향이 없으므로
 * (게임은 화면을 모른다) 한 씨앗을 한 번만 돌리고 그 프레임을 후보 전부가 함께 본다.
 * 후보끼리 같은 판을 보게 되어 견주기도 정확하고, 재는 시간도 후보 수만큼 줄어든다.
 *
 * **씨앗은 반드시 `new World({ seed })`로 넣어라.** 세션 29의 임시 자는 `new World(seed)`로
 * 넣어서 스무 판이 전부 **같은 판**이었다(`options.seed ?? 20260909`). 표는 멀쩡해 보였고
 * 그 수치가 STATUS와 주석에 적혔다 — 세션 30이 타입 검사에서 잡아 다시 쟀다.
 */
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260909 + i);
const MAX_SECONDS = 300;

/** 적의 몸을 몇 프레임마다 한 번 볼 것인가. 매 프레임 보면 표 하나에 몇 분이 든다. */
const BODY_SAMPLE = 6;

/**
 * 재는 화면비 둘. `npm run qa`가 찍는 두 창과 같은 값이다
 * (모바일 가로 844x390 · 데스크톱 1280x720). **옆으로 보이는 거리는 화면비의 함수라**
 * 한쪽만 재면 다른 쪽에서 잘리는 것을 못 본다.
 */
const SCREENS: readonly { name: string; aspect: number }[] = [
  { name: '모바일 844x390', aspect: 844 / 390 },
  { name: '데스크톱 16:9', aspect: 16 / 9 },
];

/**
 * 후보 카메라. 첫 줄은 세션 28까지 쓰던 값이고 마지막 앞줄이 지금 화면의 값이다.
 * **지금 값을 표에서 빼지 마라** — 견줄 기준이 없으면 다음 바퀴가 표를 읽을 수 없다.
 */
const CANDIDATES: readonly { name: string; spec: CameraSpec }[] = [
  { name: '세션 28까지 (15.5/12.5 · 뒤 0)', spec: { offset: { x: 0, y: 15.5, z: 12.5 }, focusBack: 0 } },
  { name: '뒤로만 3.5 (15.5/12.5)', spec: { offset: { x: 0, y: 15.5, z: 12.5 }, focusBack: 3.5 } },
  { name: '1.1배만 (17.1/13.8 · 뒤 0)', spec: { offset: { x: 0, y: 17.1, z: 13.8 }, focusBack: 0 } },
  { name: '1.05배 + 뒤로 3', spec: { offset: { x: 0, y: 16.3, z: 13.1 }, focusBack: 3 } },
  { name: '지금 값 1.1배 + 뒤로 3.5', spec: CURRENT_CAMERA },
  { name: '1.15배 + 뒤로 3.5', spec: { offset: { x: 0, y: 17.8, z: 14.4 }, focusBack: 3.5 } },
];

interface Tally {
  /** 적이 놓은 화살 수와, 그중 태어난 순간 화면 밖이던 것(뒤쪽 끝 / 좌우 끝). */
  shots: number;
  offShotsBack: number;
  offShotsSide: number;
  /** 겨누는(웅크리는) 적을 본 프레임 수와, 그중 몸이 통째로 화면 밖이던 것. */
  aiming: number;
  offAiming: number;
  /** 살아 있는 적을 본 프레임 수와, 그중 몸이 잘린 것 / 통째로 화면 밖이던 것. */
  bodies: number;
  cropped: number;
  offBody: number;
}

const emptyTally = (): Tally => ({
  shots: 0,
  offShotsBack: 0,
  offShotsSide: 0,
  aiming: 0,
  offAiming: 0,
  bodies: 0,
  cropped: 0,
  offBody: 0,
});

/**
 * 적의 몸이 차지하는 상자의 여덟 귀퉁이. **가운데 한 줄(발·머리)만 보면 옆으로 잘리는 것을 놓친다** —
 * 화면 좌우 끝에서 잘리는 몸이 정확히 그렇게 잘린다(세션 26·28이 화면에서 본 것).
 */
const BODY_CORNERS: readonly [number, number, number][] = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sy) =>
    [0, ENEMY.height].map((h): [number, number, number] => [sx * ENEMY.radius, sy * ENEMY.radius, h]),
  ),
);

const pct = (part: number, whole: number): string =>
  whole === 0 ? '  -  ' : `${((part / whole) * 100).toFixed(1)}%`.padStart(5);

/**
 * 한 씨앗을 끝까지 돌리며 모든 후보 화면에 같은 프레임을 보여 준다.
 *
 * 사람은 **코어를 보고 걷고 화력을 먼저 고르는 사람**이다. 화력 쪽을 세운 이유는
 * `shot:enemy -- crowd veteran`과 같다 — 적을 빨리 잡아 오래 사는 판이라야
 * 증원까지 다 나온 난전을 본다.
 */
function tallySeed(seed: number, rigs: readonly { projector: Projector; tally: Tally }[]): void {
  const world = new World({ seed });
  const counted = new Set<number>();
  const steps = Math.round(60 * MAX_SECONDS);

  for (let frame = 0; frame < steps && !world.defeated; frame += 1) {
    play(world, 1, walkToNearestCore, preferPower);
    const player = world.player.pos;

    // 새로 태어난 적 화살만 센다. 매 프레임 세면 오래 나는 화살이 여러 번 세어져
    // "느린 화살일수록 자주 화면 밖"이라는 다른 것을 재게 된다.
    const fresh = world.arrows.filter((a) => a.owner === 'enemy' && !counted.has(a.id));
    for (const arrow of fresh) counted.add(arrow.id);

    const lookAtBodies = frame % BODY_SAMPLE === 0;
    if (fresh.length === 0 && !lookAtBodies) continue;

    for (const { projector, tally } of rigs) {
      projector.place(player);

      for (const arrow of fresh) {
        tally.shots += 1;
        const seen = projector.project(arrow.pos.x, arrow.pos.y, ARROW.height);
        if (!isOffScreen(seen)) continue;
        // 아래쪽 끝 너머는 플레이어 뒤, 나머지는 좌우다.
        if (seen.ny < -1) tally.offShotsBack += 1;
        else tally.offShotsSide += 1;
      }

      if (!lookAtBodies) continue;
      for (const enemy of world.enemies) {
        if (!enemy.alive) continue;
        let inside = 0;
        for (const [dx, dy, h] of BODY_CORNERS) {
          if (!isOffScreen(projector.project(enemy.pos.x + dx, enemy.pos.y + dy, h))) inside += 1;
        }
        tally.bodies += 1;
        if (inside === 0) tally.offBody += 1;
        else if (inside < BODY_CORNERS.length) tally.cropped += 1;
        if (enemy.aimTimer <= 0) continue;
        tally.aiming += 1;
        if (inside === 0) tally.offAiming += 1;
      }
    }
  }
}

describe('카메라 — 화면 밖에서 벌어지는 일', () => {
  it('후보마다 안 보이는 곳의 몫을 잰다', () => {
    const rigs = CANDIDATES.flatMap((candidate) =>
      SCREENS.map((screen) => ({
        candidate,
        screen,
        projector: makeProjector(screen.aspect, candidate.spec),
        tally: emptyTally(),
      })),
    );

    const started = performance.now();
    for (const seed of SEEDS) tallySeed(seed, rigs);
    const seconds = (performance.now() - started) / 1000;

    console.log(`\n씨앗 ${SEEDS.length}판 · 화면비 ${SCREENS.length} · 후보 ${CANDIDATES.length} (${seconds.toFixed(1)}초)`);
    console.log(
      '후보'.padEnd(28) +
        '화면'.padEnd(16) +
        '밖에서 쏜 화살(뒤/옆)'.padEnd(24) +
        '안 보이는데 겨눔'.padEnd(18) +
        '몸 잘림'.padEnd(10) +
        '몸 안 보임'.padEnd(12) +
        '1m 크기',
    );
    for (const rig of rigs) {
      const t = rig.tally;
      const shots = `${pct(t.offShotsBack + t.offShotsSide, t.shots)} (${t.offShotsBack}/${t.offShotsSide})`;
      console.log(
        rig.candidate.name.padEnd(28) +
          rig.screen.name.padEnd(16) +
          shots.padEnd(26) +
          pct(t.offAiming, t.aiming).padEnd(20) +
          pct(t.cropped, t.bodies).padEnd(12) +
          pct(t.offBody, t.bodies).padEnd(14) +
          `${bodyScreenHeight(rig.screen.aspect, rig.candidate.spec).toFixed(1)}%`,
      );
    }

    // 표를 찍는 것이 목적이지만, 아무것도 못 본 표를 통과시키면 표가 조용히 비어도 모른다.
    for (const rig of rigs) {
      expect(rig.tally.shots).toBeGreaterThan(0);
      expect(rig.tally.aiming).toBeGreaterThan(0);
    }
  });
});
