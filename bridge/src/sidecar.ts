import { spawn, ChildProcess } from "child_process";

/**
 * dsh Sidecar 进程编排（原型）。
 *
 * 默认进程模型为 Sidecar：以独立 dsh 子进程拉起引擎，
 * 桥接层负责生命周期与健康监控（对应 docs/architecture.md 5.3）。
 * 本实现为结构骨架：dsh 可执行路径、就绪探测与实际拉起待 M2 接入。
 */

export interface SidecarOptions {
  /** dsh 可执行文件路径；缺省时按 PATH 中的 "dsh" 解析 */
  dshBin?: string;
  /** dsh profile 名 */
  profile: string;
  /** 工作目录（reasonix 仓库根） */
  cwd?: string;
  /** 就绪超时（毫秒） */
  readyTimeoutMs?: number;
}

export type SidecarStatus = "stopped" | "starting" | "ready" | "exited" | "error";

export interface SidecarHandle {
  pid: number | undefined;
  status: SidecarStatus;
  stop(): Promise<void>;
}

/** 就绪探测：在 stdout 中匹配的标记（dsh 启动后应输出此类标记） */
const READY_MARKER = /dsh.*(ready|listening|started)/i;

export class Sidecar {
  private proc: ChildProcess | null = null;
  private status: SidecarStatus = "stopped";

  constructor(private readonly opts: SidecarOptions) {}

  getStatus(): SidecarStatus {
    return this.status;
  }

  /**
   * 拉起 dsh 子进程，并在就绪标记出现后 resolve。
   */
  async start(): Promise<SidecarHandle> {
    if (this.proc) throw new Error("sidecar already running");
    this.status = "starting";

    const timeoutMs = this.opts.readyTimeoutMs ?? 30_000;
    const bin = this.opts.dshBin ?? "dsh";

    return new Promise<SidecarHandle>((resolve, reject) => {
      const child = spawn(bin, ["--profile", this.opts.profile], {
        cwd: this.opts.cwd,
        stdio: ["inherit", "pipe", "pipe"],
        windowsHide: true,
      });
      this.proc = child;

      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        this.status = "ready";
        resolve(this.handle());
      };
      const onFail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.status = "error";
        reject(err);
      };

      const timer = setTimeout(() => onFail(new Error(`dsh sidecar ready timeout (${timeoutMs}ms)`)), timeoutMs);

      child.stdout?.on("data", (buf: Buffer) => {
        const line = buf.toString("utf8");
        process.stdout.write(`[dsh] ${line}`);
        if (!settled && READY_MARKER.test(line)) {
          clearTimeout(timer);
          onReady();
        }
      });
      child.stderr?.on("data", (buf: Buffer) => process.stderr.write(`[dsh:err] ${buf.toString("utf8")}`));
      child.on("error", (err) => {
        clearTimeout(timer);
        onFail(err);
      });
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (!settled) onFail(new Error(`dsh exited before ready (code=${code} signal=${signal})`));
        this.status = "exited";
        this.proc = null;
      });
    });
  }

  /** 停止 Sidecar（SIGTERM，超时后 SIGKILL） */
  async stop(): Promise<void> {
    const child = this.proc;
    if (!child) {
      this.status = "stopped";
      return;
    }
    await new Promise<void>((resolve) => {
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 3000);
      child.on("exit", () => {
        clearTimeout(killer);
        resolve();
      });
      child.kill("SIGTERM");
      this.status = "stopped";
    });
    this.proc = null;
  }

  private handle(): SidecarHandle {
    return {
      pid: this.proc?.pid,
      status: this.status,
      stop: () => this.stop(),
    };
  }
}
