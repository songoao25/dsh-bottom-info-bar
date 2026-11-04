// Bottom Info Bar — 启动诊断采样器（默认关闭，独立模块以便单测）
//
// 为什么需要它：issue #260 报告 DSH NEXT 桌面端（Linux）只加载本插件时，host 进程在启动
// 约 10 秒后停止 accept 新 TCP 连接；卡住时宿主 inspector 也打不开，用户侧拿不到任何进程内
// 状态。这里提供一个只靠环境变量打开的采样器：按固定时间点记录「已打开 fd 数 / 活动 handle
// 数 / 距 apply 的毫秒数」，并用 1 秒定时器测事件循环滞后——三者足以区分三种假设：
//   · 插件代码同步阻塞主线程 → 滞后采样有大幅 lag，fd 平稳；
//   · fd 泄漏到 EMFILE → fd 单调增长直到接近上限，lag 很小；
//   · 宿主自身 IO 停摆（插件采样正常但端口不响应）→ 采样一路正常，说明要往宿主侧查。
//
// 硬边界：
//   ① 默认关闭，只有 DSH_BOTTOM_INFO_BAR_STARTUP_TRACE=1 才启用；
//   ② 只写 console.warn，不落盘、不联网、不读用户数据；
//   ③ 所有定时器 unref，清理走 dispose()，不拖住宿主退出；
//   ④ 非 Linux 不读 /proc（fd 记 null），采样本身不申请长期 fd。
import { readdirSync } from 'node:fs'

export const STARTUP_TRACE_ENV = 'DSH_BOTTOM_INFO_BAR_STARTUP_TRACE'
export const STARTUP_TRACE_OFFSETS_MS = [2000, 8000, 15000, 30000, 60000]
export const EVENT_LOOP_SAMPLE_MS = 1000
export const EVENT_LOOP_LAG_ALERT_MS = 200

export function isStartupTraceEnabled(env) {
  return !!env && env[STARTUP_TRACE_ENV] === '1'
}

// Linux 上 /proc/self/fd 是当前进程已打开 fd 的直接视图；其它平台返回 null 而不是猜。
export function countOpenFds(dir) {
  try { return readdirSync(dir || '/proc/self/fd').length } catch (err) { return null }
}

// 活动 handle 数：Node 内部 API，取不到就降级为 null（诊断项不能反过来影响插件）。
export function countActiveHandles() {
  try {
    return typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null
  } catch (err) { return null }
}

/**
 * 创建采样器。所有依赖可注入，便于单测在没有真实定时器/时钟的情况下验证行为。
 * @param {object} [options]
 * @param {object} [options.env] 环境变量表（默认 process.env）
 * @param {Function} [options.log] 一行文本的接收者（默认 console.warn）
 * @param {Function} [options.now] 时钟（默认 Date.now）
 * @param {Function} [options.setTimeout] / [options.setInterval] / [options.clearTimeout] / [options.clearInterval]
 * @param {Function} [options.countFds] / [options.countHandles] 采样实现
 * @param {number} [options.pid] 记录用的进程号
 */
export function createStartupTrace(options) {
  const config = options || {}
  const enabled = isStartupTraceEnabled(config.env || process.env)
  const log = typeof config.log === 'function' ? config.log : function (line) {
    try { console.warn(line) } catch (err) { /* 诊断日志失败无害 */ }
  }
  const now = typeof config.now === 'function' ? config.now : function () { return Date.now() }
  const schedule = typeof config.setTimeout === 'function' ? config.setTimeout : setTimeout
  const repeat = typeof config.setInterval === 'function' ? config.setInterval : setInterval
  const cancel = typeof config.clearTimeout === 'function' ? config.clearTimeout : clearTimeout
  const cancelRepeat = typeof config.clearInterval === 'function' ? config.clearInterval : clearInterval
  const readFds = typeof config.countFds === 'function' ? config.countFds : countOpenFds
  const readHandles = typeof config.countHandles === 'function' ? config.countHandles : countActiveHandles
  const pid = Number.isInteger(config.pid) ? config.pid : process.pid
  const startedAt = now()
  const timers = []
  let disposed = false

  function keepAlive(timer) {
    if (timer && typeof timer.unref === 'function') timer.unref()
    return timer
  }
  function emit(record) {
    if (disposed) return
    try { log('[dsh-bottom-info-bar] startup-trace ' + JSON.stringify(record)) } catch (err) { /* 诊断日志失败无害 */ }
  }
  function snapshot(stage) {
    return { stage: stage, t: now() - startedAt, pid: pid, fds: readFds(), handles: readHandles() }
  }

  function start() {
    if (!enabled || disposed) return false
    emit(snapshot('apply'))
    for (const offset of STARTUP_TRACE_OFFSETS_MS) {
      timers.push(keepAlive(schedule(function () { emit(snapshot('t+' + offset)) }, offset)))
    }
    let last = now()
    timers.push(keepAlive(repeat(function () {
      const at = now()
      const lag = at - last - EVENT_LOOP_SAMPLE_MS
      last = at
      if (lag >= EVENT_LOOP_LAG_ALERT_MS) emit(Object.assign(snapshot('event-loop-lag'), { lagMs: lag }))
    }, EVENT_LOOP_SAMPLE_MS)))
    return true
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const timer of timers) {
      try { cancel(timer); cancelRepeat(timer) } catch (err) { /* 已触发或已清理 */ }
    }
    timers.length = 0
  }

  return {
    enabled: enabled,
    start: start,
    dispose: dispose,
    snapshot: snapshot,
    stage: function (name) { emit(snapshot(name)) },
  }
}
