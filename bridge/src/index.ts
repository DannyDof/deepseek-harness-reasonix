import { EventEmitter } from "events";
import { ReasonixEvent } from "./events/reasonix";
import { DshEvent } from "./events/dsh";
import { EventMapper } from "./mapping/event-map";
import { Sidecar, SidecarOptions } from "./sidecar";

export { BackendSwitch, BackendKind, BackendSwitchOptions, BackendState } from "./backend-switch";
export { exportCheckpoint, importCheckpoint } from "./session/checkpoint";
export type { ReasonixCheckpoint, ReasonixCheckpointMessage, ReasonixToolCall } from "./session/checkpoint";
export type { ReasonixEvent } from "./events/reasonix";
export type { DshEvent } from "./events/dsh";

/**
 * 桥接层门面（reasonix-bridge 对外入口）。
 *
 * 职责：接收 Reasonix 前端事件并映射上送 dsh；接收 dsh 事件并投影回
 * Reasonix 前端渲染模型；编排 dsh Sidecar 生命周期。
 * 这是两路高频上游（Reasonix 前端、dsh）之间唯一的缓冲层
 * （docs/architecture.md 13.8）。
 */
export class Bridge {
  private readonly bus = new EventEmitter();
  private readonly mapper: EventMapper;
  private readonly sidecar: Sidecar | null;

  constructor(options: { mapper?: EventMapper; sidecar?: SidecarOptions | null } = {}) {
    this.mapper = options.mapper ?? new EventMapper();
    this.sidecar = options.sidecar ? new Sidecar(options.sidecar) : null;
  }

  /** 前端事件 -> 桥接层（自动映射上送引擎） */
  emitReasonix(ev: ReasonixEvent): DshEvent[] {
    const upstream = this.mapper.reasonixToDsh(ev);
    for (const d of upstream) this.bus.emit("dsh", d);
    return upstream;
  }

  /** 引擎事件 -> 桥接层（自动投影回前端渲染模型） */
  emitDsh(ev: DshEvent): ReasonixEvent[] {
    const projected = this.mapper.dshToReasonix(ev);
    for (const r of projected) this.bus.emit("reasonix", r);
    return projected;
  }

  /** 订阅投影回前端的事件 */
  onReasonix(listener: (ev: ReasonixEvent) => void): void {
    this.bus.on("reasonix", listener);
  }

  /** 订阅映射上送引擎的事件 */
  onDsh(listener: (ev: DshEvent) => void): void {
    this.bus.on("dsh", listener);
  }

  /** 启动 dsh Sidecar（若配置） */
  async startEngine(): Promise<ReturnType<Sidecar["start"]> | null> {
    if (!this.sidecar) return null;
    return this.sidecar.start();
  }

  /** 停止 dsh Sidecar（若配置） */
  async stopEngine(): Promise<void> {
    if (this.sidecar) await this.sidecar.stop();
  }
}
