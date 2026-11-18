export type FrameScheduler = (callback: FrameRequestCallback) => number;
export type FrameCanceller = (handle: number) => void;

export class ControlsUpdateLoop {
  readonly #update: () => void;
  readonly #schedule: FrameScheduler;
  readonly #cancel: FrameCanceller;
  #frame: number | null = null;
  #active = false;

  constructor(
    update: () => void,
    schedule: FrameScheduler = (callback) => window.requestAnimationFrame(callback),
    cancel: FrameCanceller = (handle) => window.cancelAnimationFrame(handle),
  ) {
    this.#update = update;
    this.#schedule = schedule;
    this.#cancel = cancel;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#frame = this.#schedule(this.#tick);
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    if (this.#frame !== null) this.#cancel(this.#frame);
    this.#frame = null;
    this.#update();
  }

  dispose(): void {
    this.#active = false;
    if (this.#frame !== null) this.#cancel(this.#frame);
    this.#frame = null;
  }

  readonly #tick = (): void => {
    if (!this.#active) {
      this.#frame = null;
      return;
    }
    this.#update();
    this.#frame = this.#schedule(this.#tick);
  };
}
