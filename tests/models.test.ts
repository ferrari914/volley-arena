import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHIELD } from '../src/data/config';
import { PALETTE, SHIELD_GLOW, SHIELD_POSE, applyShieldLook, createEnemy } from '../src/render/models';

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

/**
 * 방패판이 화면에서 하는 말 둘 — **얼마나 남았는가**와 **방금 받아 냈는가** — 이
 * 서로를 지우지 않는지 본다. 둘 다 같은 재질 하나의 밝기를 쓰기 때문에,
 * 한쪽을 세게 주면 다른 쪽이 조용히 사라진다. 실제로 그렇게 됐던 자리다:
 * 받아 낸 순간의 흰빛이 0.75였을 때 판은 통째로 하얘져 남은 내구도가 지워졌고,
 * 정면으로 쏘는 내내 매 발 다시 켜지는 빛이라 **그 흰색이 방패의 평소 색**이었다.
 *
 * 눈이 아니라 밝기(상대 휘도)로 잰다. 사람이 "밝다/어둡다"로 읽는 값이 그것이고,
 * 색을 바꾸더라도 관계가 지켜지는지는 이 자만 잴 수 있다.
 */
describe('방패판의 빛깔', () => {
  /** 재질이 화면에 내놓는 밝기. 바탕색에 스스로 내는 빛을 더한다. */
  function brightness(shieldHp: number, flash: number): number {
    const material = new THREE.MeshStandardMaterial();
    applyShieldLook(material, shieldHp, flash);
    const lum = (color: THREE.Color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    return lum(material.color) + material.emissiveIntensity * lum(material.emissive);
  }

  it('방패는 닳을수록 어두워진다', () => {
    const steps = [5, 4, 3, 2, 1, 0].map((hp) => brightness(hp, 0));
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    }
    // 눈에 보일 만큼 갈려야 한다. 성한 판과 마지막 한 대 남은 판이 같아 보이면
    // 정면으로 쏘는 사람은 진척을 볼 곳이 없다(몸 체력바는 꿈쩍도 하지 않는다).
    expect(steps[0]! - steps[4]!).toBeGreaterThan(0.1);
  });

  it('받아 낸 순간이 평소보다 밝다', () => {
    for (const hp of [5, 3, 1]) {
      expect(brightness(hp, 1)).toBeGreaterThan(brightness(hp, 0) + 0.1);
    }
  });

  it('성한 방패는 받아 내는 순간에도 닳은 방패보다 밝다', () => {
    // 이것이 깨지면 번쩍임이 남은 내구도를 덮은 것이다 — 정면 사격 중에는
    // 판이 늘 번쩍이고 있으므로, 그 화면에서 진척이 통째로 안 보이게 된다.
    // 0.2는 "다르다"가 아니라 **눈에 보이게 다르다**는 선이다. 흰빛이 세던 때의
    // 두 판도 숫자로는 달랐다(0.09) — 화면에서는 둘 다 그냥 흰 띠였다.
    expect(brightness(5, 1) - brightness(1, 1)).toBeGreaterThan(0.2);
    expect(brightness(5, 1) - brightness(0, 1)).toBeGreaterThan(0.2);
  });

  it('번쩍임은 판을 흰빛으로 덮어 버리지 않는다', () => {
    // 값 자체에 선을 걸어 둔다. 0.75로 되돌리면 위의 검사들이 아니라 여기가 먼저 걸려,
    // 다음 세션이 "왜 이 값인가"를 주석과 함께 보게 된다(`SHIELD_GLOW`).
    expect(SHIELD_GLOW.spark).toBeLessThan(0.5);
    expect(SHIELD_GLOW.intact).toBeGreaterThan(0.2);
  });
});
