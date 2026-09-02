/**
 * 고정 시간 간격 루프.
 * 프레임이 흔들려도 시뮬레이션은 항상 같은 dt로 돈다 —
 * 프레임 수에 따라 이동 속도나 발사 속도가 달라지면 밸런스를 잡을 수 없다.
 */
export class Ticker {
  /** 시뮬레이션 한 스텝의 길이(s). */
  readonly fixedDt = 1 / 60;
  /** 한 프레임에 몰아서 돌릴 수 있는 최대 스텝 수. 탭이 오래 꺼져 있다 돌아와도 멈춰 보이지 않게 한다. */
  private readonly maxSteps = 5;

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  /** 최근 프레임 기준 초당 프레임 수. HUD 표시용. */
  fps = 0;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const elapsed = Math.min((now - this.lastTime) / 1000, this.fixedDt * this.maxSteps);
    this.lastTime = now;
    if (elapsed > 0) this.fps += ((1 / elapsed) - this.fps) * 0.1;

    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;

    this.render(this.accumulator / this.fixedDt);
  };
}
