import { AIM } from '../data/config';
import { applyDeadzone, type Vec2 } from '../core/math';
import type { InputSource, InputState } from './types';

/** 스틱 반지름(px). 이 거리만큼 끌면 입력이 최대가 된다. */
const STICK_RADIUS = 56;

interface StickState {
  root: HTMLElement;
  knob: HTMLElement;
  pointerId: number | null;
  origin: Vec2;
  value: Vec2;
}

/**
 * 화면을 좌/우로 나눠 각각 가상 스틱을 만든다.
 * 스틱은 "손가락이 닿은 자리"에 생긴다 — 고정 위치라면 화면 크기와 손 크기마다
 * 엄지가 닿는 지점이 달라 매번 스틱을 찾아 더듬게 된다.
 */
export class TouchInput implements InputSource {
  private readonly move: StickState;
  private readonly aim: StickState;
  private readonly sticks: StickState[];
  private used = false;

  constructor(private readonly host: HTMLElement) {
    this.move = this.createStick('stick--move');
    this.aim = this.createStick('stick--aim');
    this.sticks = [this.move, this.aim];

    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('pointercancel', this.onPointerUp);
  }

  /** 한 번이라도 터치가 있었는지. 데스크톱에서 스틱을 숨기는 판단에 쓴다. */
  get wasUsed(): boolean {
    return this.used;
  }

  read(): InputState {
    const move = applyDeadzone(this.move.value, AIM.deadzone);
    const rawAim = applyDeadzone(this.aim.value, AIM.deadzone);
    const aiming = this.aim.pointerId !== null && (rawAim.x !== 0 || rawAim.y !== 0);
    return { move, aim: aiming ? rawAim : null };
  }

  dispose(): void {
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('pointercancel', this.onPointerUp);
    for (const stick of this.sticks) stick.root.remove();
  }

  private createStick(modifier: string): StickState {
    const root = document.createElement('div');
    root.className = `stick ${modifier}`;
    const knob = document.createElement('div');
    knob.className = 'stick__knob';
    root.appendChild(knob);
    this.host.appendChild(root);
    return { root, knob, pointerId: null, origin: { x: 0, y: 0 }, value: { x: 0, y: 0 } };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    this.used = true;
    document.body.dataset['input'] = 'touch';

    const stick = event.clientX < window.innerWidth / 2 ? this.move : this.aim;
    if (stick.pointerId !== null) return;

    stick.pointerId = event.pointerId;
    stick.origin = { x: event.clientX, y: event.clientY };
    stick.root.dataset['active'] = '1';
    // 스틱을 손가락이 닿은 자리로 옮긴다.
    stick.root.style.left = `${event.clientX - STICK_RADIUS - 10}px`;
    stick.root.style.top = `${event.clientY - STICK_RADIUS - 10}px`;
    stick.root.style.right = 'auto';
    stick.root.style.bottom = 'auto';
    this.updateKnob(stick);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const stick = this.sticks.find((s) => s.pointerId === event.pointerId);
    if (!stick) return;
    const dx = event.clientX - stick.origin.x;
    const dy = event.clientY - stick.origin.y;
    const dist = Math.hypot(dx, dy);
    const scale = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    stick.value = { x: (dx * scale) / STICK_RADIUS, y: (dy * scale) / STICK_RADIUS };
    this.updateKnob(stick);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const stick = this.sticks.find((s) => s.pointerId === event.pointerId);
    if (!stick) return;
    stick.pointerId = null;
    stick.value = { x: 0, y: 0 };
    stick.root.dataset['active'] = '0';
    stick.root.style.left = '';
    stick.root.style.top = '';
    stick.root.style.right = '';
    stick.root.style.bottom = '';
    this.updateKnob(stick);
  };

  private updateKnob(stick: StickState): void {
    stick.knob.style.transform = `translate(${stick.value.x * STICK_RADIUS}px, ${
      stick.value.y * STICK_RADIUS
    }px)`;
  }
}
