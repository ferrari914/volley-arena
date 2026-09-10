import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHIELD } from '../src/data/config';
import { PALETTE, SHIELD_POSE, createEnemy } from '../src/render/models';

/**
 * 화면에 세우는 도형이 규칙과 같은 말을 하는지 본다.
 *
 * **여기서만 잡을 수 있는 고장이 있다.** 시뮬레이션 검사는 "정면 화살이 막힌다"까지
 * 확인하지만, 그 정면이 **화면에서 어디까지인지**는 보지 않는다. 둘이 어긋나면
 * 게임은 규칙대로 도는데 플레이어만 속는다 — "저만큼 비켰는데 왜 또 튕기지".
 * 실제로 이 파일이 생기기 전 방패판은 눈에 ±45°로 보이면서 ±75°를 막고 있었다.
 */
describe('적 모델', () => {
  it('방패판은 SHIELD.arc가 막는 각을 그대로 두른다', () => {
    const view = createEnemy('shield');
    const plate = view.shieldPlate;
    expect(plate).not.toBeNull();

    const wall = plate!.children.find(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.material === view.shieldMaterial,
    );
    expect(wall).toBeDefined();

    const { thetaStart, thetaLength } = (wall!.geometry as THREE.CylinderGeometry).parameters;
    // CylinderGeometry의 각도 0은 +Z이고, 몸의 정면은 −Z다(`yawFromAngle`).
    // 그래서 두르는 구간의 한가운데가 π에 와야 정면이 한가운데다.
    expect(thetaStart + thetaLength / 2).toBeCloseTo(Math.PI, 5);
    expect(thetaLength).toBeCloseTo(SHIELD.arc * 2, 5);
  });

  it('방패를 내린 자세가 바닥을 파고들지 않는다', () => {
    // 판이 곡면이라 양 끝이 가운데보다 아래로 처진다 — 앞쪽만 보고 값을 정하면
    // 옆쪽 아랫변이 바닥 밑으로 들어가 방패가 잘려 보인다.
    const view = createEnemy('shield');
    const plate = view.shieldPlate!;
    plate.position.y = SHIELD_POSE.loweredY;
    plate.rotation.x = SHIELD_POSE.loweredTilt;
    view.group.updateMatrixWorld(true);

    const low = new THREE.Box3().setFromObject(plate).min.y;
    expect(low).toBeGreaterThan(0);
    // 그렇다고 뜬 채로 내려오는 시늉만 하면 안 된다. 바닥 가까이 내려와야 한다.
    expect(low).toBeLessThan(0.2);
  });

  it('내린 방패는 올린 방패보다 눈에 띄게 낮다', () => {
    // 이 움직임이 정면이 열리는 유일한 예고다. 조금 흔들리는 정도로는 못 본다.
    // 실측 0.49m — 적의 키 2.23m의 5분의 1이 넘는다.
    const view = createEnemy('shield');
    const plate = view.shieldPlate!;
    const top = (tilt: number, y: number) => {
      plate.position.y = y;
      plate.rotation.x = tilt;
      view.group.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(plate).max.y;
    };
    const raised = top(SHIELD_POSE.raisedTilt, SHIELD_POSE.raisedY);
    const lowered = top(SHIELD_POSE.loweredTilt, SHIELD_POSE.loweredY);
    expect(raised - lowered).toBeGreaterThan(0.4);
  });

  it('방패는 방패병에게만 있다', () => {
    for (const kind of ['archer', 'charger'] as const) {
      const view = createEnemy(kind);
      expect(view.shieldPlate).toBeNull();
      expect(view.shieldMaterial).toBeNull();
    }
  });

  it('세 종류의 몸 색이 서로 다르다', () => {
    // 종류는 크기가 아니라 모양과 색으로 가른다(config의 `SHIELD` 머리말).
    // 반지름이 하나뿐이므로 색이 겹치면 난전에서 종류를 구별할 방법이 없어진다.
    const colors = (['archer', 'charger', 'shield'] as const).map((kind) =>
      createEnemy(kind).bodyMaterial.color.getHex(),
    );
    expect(new Set(colors).size).toBe(3);
    expect(colors).toEqual([PALETTE.enemy, PALETTE.charger, PALETTE.shield]);
  });
});
