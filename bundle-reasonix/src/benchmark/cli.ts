import { evaluate, thresholdViolations, DEFAULT_BENCH_THRESHOLDS } from "./benchmark";
import { createSimulatedEngine, DEFAULT_ENGINE_OPTIONS, E2E_TASKS } from "./engine";

/** 基准 CLI：npm run bench --workspace bundle-reasonix */
async function main(): Promise<void> {
  const engine = createSimulatedEngine(DEFAULT_ENGINE_OPTIONS);
  const report = await evaluate(engine, E2E_TASKS);

  console.log("== Reasonix 基准验证（M4） ==");
  console.log(`缓存命中率（稳态）: ${(report.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`单任务成本比:       ${report.overallCostRatio.toFixed(3)}（阈值 ≤ ${DEFAULT_BENCH_THRESHOLDS.maxCostRatio}）`);
  console.log(`E2E 成功率:         ${(report.successRate * 100).toFixed(0)}%（基线 ${(report.baselineSuccessRate * 100).toFixed(0)}%）`);
  console.log("");
  console.log("任务明细:");
  for (const t of report.tasks) {
    console.log(`  ${t.id.padEnd(14)} success=${t.success} cost=$${t.costUsd.toFixed(4)} (baseline $${t.baselineCostUsd.toFixed(4)}, ratio ${t.costRatio.toFixed(2)})`);
  }

  const violations = thresholdViolations(report);
  console.log("");
  if (violations.length === 0) {
    console.log("结果: 全部达标");
  } else {
    console.log("结果: 未达标");
    for (const v of violations) console.log(`  - ${v}`);
    process.exitCode = 1;
  }
}

void main();
