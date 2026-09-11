// 会话级实时模型同步回归：不能再把进程全局默认模型显示给另一个已激活会话。
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../plugin/src/client-bundle.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../plugin/src/host.js', import.meta.url), 'utf8')
let failed = 0
function check(name, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name)
  if (!ok) failed += 1
}

check('客户端订阅 DSH 的会话级 modelDirectories 服务', client.includes("ctx.get('modelDirectories')")
  && client.includes('directories.directoryFor(sessionId)')
  && client.includes('typeof directory.load === \'function\'')
  && client.includes('directory.store.subscribe(publish)'))
// 曾经的实现用 setInterval 每 2 秒轮询 getBillingMode 来猜测模型切换：费电、滞后、且与会话脱钩。
// 现在改为订阅 DSH 的会话级目录（见上一条断言）。
// 断言只针对「2 秒轮询」这一形态，不要退化成禁止任何 2000 —— 一次性反馈计时器
// （例如「更新命令已复制」2 秒后复原标签）与轮询毫无关系，属合法用法。
check('客户端不再以 2 秒轮询 getBillingMode 检测模型切换',
  !/setInterval\([\s\S]{0,200}?,\s*2000\s*\)/.test(client)
  && !client.includes('模型/服务商切换秒级同步'))
check('会话切换时立即清除上一个会话的模型状态', client.includes('setSessionModel(null);'))
check('模型/服务商显示以会话状态优先，慢速 RPC 不阻塞', client.includes('const visiblePricing = activeSessionModel')
  && client.includes('const visibleBillingMode = activeSessionModel'))
check('不保留跨会话模型缓存，避免 remount 后显示旧模型', !client.includes('sessionModelCache')
  && !client.includes('cachedSessionModel')
  && client.includes('const activeSessionModel = sessionModel && sessionModel.sessionId === sessionId ? sessionModel : null'))
check('模型或订阅额度未到时不渲染加载中文字', !client.includes("key: 'loading' }, '加载中…'")
  && !client.includes("key: 'subload' }, '订阅额度加载中…'"))
check('模型切换不注入插件自定义动画，交给宿主默认行为', !client.includes('bi-model-crossfade')
  && !client.includes('@keyframes bi-model-enter')
  && !client.includes('modelTransitionKey'))
check('视觉能力只接受 DSH 明确 metadata，未知时不暂按文本模型显示', client.includes('const inputModalities = model && Array.isArray(model.inputModalities) ? model.inputModalities : null;')
  && client.includes("acceptsImageInput: activeSessionModel.acceptsImageInput")
  && client.includes("className: 'bi-model-capability-pending bi-model-name'")
  && client.includes("title: t('ui.modelCapabilityPending')")
  && !client.includes("'aria-hidden': 'true' }, modelLabel"))
check('旧会话的迟到响应不能覆盖新会话', client.includes('requestVersion !== loadVersionRef.current'))
check('新会话等待 RPC 时不显示旧余额/花费', client.includes('const stateMatchesActiveSelection = !activeSessionModel || state.selectionKey === activeSelectionKey')
  && client.includes('const renderedState = stateMatchesActiveSelection ? state : {')
  && client.includes('mergeLoadResults(s, results, selectionKey)'))
check('会话选择连同所有相关 RPC 发送到 host', client.includes('const selectionArgs = activeSelection')
  && client.includes("rpc('getPricing', selectionArgs")
  && client.includes("rpc('getBillingMode', selectionArgs")
  && client.includes("rpc('getSubscriptionSnapshot', selectionArgs"))
check('host 校验会话选择，缺失时保持待识别', host.includes('function selectionFromArgs(args)')
  && host.includes("reason = 'selection-incomplete'")
  && host.includes("reason: raw ? 'selection-incomplete' : 'selection-required'")
  && !host.includes('return modelSelection();'))
check('host 的定价、模式、订阅和花费汇总均接受会话选择', host.includes('computePricing(Date.now(), sel)')
  && host.includes('getSubscriptionSnapshotRpc(selectionFromArgs(args), force)')
  && host.includes('getUsageSummary(Date.now(), sessionId, selectionFromArgs(args))'))

console.log(failed === 0 ? '\n结果：全部 PASS' : '\n结果：' + failed + ' 项 FAIL')
process.exit(failed === 0 ? 0 : 1)
