// Bottom Info Bar — 宿主启动窗口策略（issue #260）
//
// 为什么需要它：DSH NEXT（Linux）报告「只加载本插件时宿主约 10 秒后停止响应新连接」。
// 插件侧无法证明宿主原生层的原因，但可以保证自己不占用宿主启动窗口：
//   normal   当前行为：apply() 里立即开始价目/余额/会话目录等刷新；
//   deferred 把上述启动刷新推迟到「页面发来第一个 RPC」或 20 秒兜底定时器，
//            让宿主自己的 boot（含 shell 的 injections 请求、页面加载）先完成；
//   inert    apply() 什么都不注册（只保留启动采样），用于和宿主/桌面壳做二分对照。
//
// 硬边界：
//   ① 默认 normal，行为与之前完全一致；只有显式设置环境变量才改变；
//   ② deferred 的兜底定时器 unref，dispose 时清理，绝不拖住宿主退出；
//   ③ 触发是幂等的：多个 RPC 同时到达也只启动一次；启动异常只记录，不影响 RPC。
import { setTimeout as defaultSetTimeout, clearTimeout as defaultClearTimeout } from 'node:timers'

export const BOOT_MODE_ENV = 'DSH_BOTTOM_INFO_BAR_BOOT'
export const BOOT_MODES = Object.freeze(['normal', 'deferred', 'inert'])
/** deferred 模式下，即使页面一直没发 RPC 也在这之后启动后台刷新。 */
export const DEFERRED_FALLBACK_MS = 20000

/**
 * 解析启动模式。未知值/缺省一律 normal，避免用户拼错环境变量后插件静默变哑。
 * @param {object} [env] 环境变量表（默认 process.env）
 * @returns {'normal' | 'deferred' | 'inert'}
 */
export function parseBootMode(env) {
  const value = env && env[BOOT_MODE_ENV]
  return BOOT_MODES.includes(value) ? value : 'normal'
}

/**
 * 创建启动闸门：normal 立即执行；deferred 等第一次 trigger() 或兜底定时器。
 * @param {object} [options]
 * @param {'normal' | 'deferred'} [options.mode]
 * @param {Function} [options.run] 启动时要执行的同步/异步初始化
 * @param {Function} [options.setTimeout] / [options.clearTimeout] 可注入定时器（单测用）
 * @param {number} [options.fallbackMs] deferred 兜底延迟（默认 DEFERRED_FALLBACK_MS）
 */
export function createStartupGate(options) {
  const settings = options || {}
  const mode = settings.mode === 'deferred' ? 'deferred' : 'normal'
  const run = typeof settings.run === 'function' ? settings.run : function () {}
  const schedule = typeof settings.setTimeout === 'function' ? settings.setTimeout : defaultSetTimeout
  const cancel = typeof settings.clearTimeout === 'function' ? settings.clearTimeout : defaultClearTimeout
  const fallbackMs = Number.isFinite(settings.fallbackMs) ? settings.fallbackMs : DEFERRED_FALLBACK_MS
  let started = false
  let disposed = false
  let timer = null

  function trigger() {
    if (started || disposed) return false
    started = true
    if (timer !== null) {
      try { cancel(timer) } catch (err) { /* 已触发或已清理 */ }
      timer = null
    }
    try { run() } catch (err) {
      // 启动刷新失败只影响数据新鲜度，UI 的 RPC 重试路径会再拉一次。
      try { console.warn('[dsh-bottom-info-bar] background startup failed: ' + String((err && err.message) || err)) } catch (err2) { /* 日志失败无害 */ }
    }
    return true
  }

  if (mode === 'normal') trigger()
  else {
    timer = schedule(trigger, fallbackMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  return {
    mode: mode,
    started: function () { return started },
    trigger: trigger,
    dispose: function () {
      disposed = true
      if (timer !== null) {
        try { cancel(timer) } catch (err) { /* 已触发或已清理 */ }
        timer = null
      }
    },
  }
}
