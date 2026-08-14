/**
 * 后端切换 + 回滚通道冻结（方案 8.3 + M5）。
 *
 * 通过配置开关在 dsh 后端与保留的 Go Controller 之间切换，无需重新分发二进制；
 * freezeRollback() 将 Go 后端冻结为回滚通道，确保任何时刻可切回原内核。
 */

export type BackendKind = "dsh" | "go";

export interface BackendSwitchOptions {
  /** 默认后端（M5 默认切换为 dsh） */
  backend?: BackendKind;
  /** 是否启用回滚通道（Go Controller） */
  rollbackEnabled?: boolean;
}

export interface BackendState {
  active: BackendKind;
  rollbackEnabled: boolean;
  frozen: boolean;
}

export class BackendSwitch {
  private active: BackendKind;
  private rollbackEnabled: boolean;
  private frozen = false;

  constructor(options: BackendSwitchOptions = {}) {
    this.active = options.backend ?? "dsh";
    this.rollbackEnabled = options.rollbackEnabled ?? true;
  }

  get activeBackend(): BackendKind {
    return this.active;
  }

  state(): BackendState {
    return { active: this.active, rollbackEnabled: this.rollbackEnabled, frozen: this.frozen };
  }

  /** 切换后端（无需重新分发二进制）。 */
  select(kind: BackendKind): void {
    if (kind === "go" && !this.rollbackEnabled) {
      throw new Error("rollback channel (go) is disabled");
    }
    this.active = kind;
  }

  /** 切回回滚通道（Go Controller）。 */
  switchToRollback(): void {
    this.select("go");
  }

  /** 冻结回滚通道：锁定 Go 后端作为稳定回退，禁止关闭。 */
  freezeRollback(): void {
    this.rollbackEnabled = true;
    this.frozen = true;
  }

  /** 回滚通道是否已冻结。 */
  isRollbackFrozen(): boolean {
    return this.frozen;
  }
}
