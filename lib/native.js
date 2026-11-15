// DSH Go native integration — the info-bar card lives in the plugin page.
//
// The native conversation has no inline slot below the composer, so the card is
// contributed as a native panel. The "Plugins" button opens the second-level
// plugin page and renders this view there. It is not the web page.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { LOCALES } from './locales.js'

const REFRESH_MS = 15000
const SESSION_CACHE_MS = 5000
const sessionCache = new Map()

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function safeEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return []
  }
}

function normalizeSessionId(id) {
  return String(id || '').replace(/^session-/, '')
}

function listSessionFiles() {
  const root = join(dshHome(), 'sessions')
  const out = []
  for (const ws of safeEntries(root)) {
    if (!ws.isDirectory() || ws.name.startsWith('.')) continue
    const wsDir = join(root, ws.name)
    for (const session of safeEntries(wsDir)) {
      if (!session.isDirectory()) continue
      const id = normalizeSessionId(session.name)
      if (!id) continue
      const dir = join(wsDir, session.name)
      for (const file of safeEntries(dir)) {
        if (!file.isFile() || !/^session\.v\d+\.jsonl\.zstd$/.test(file.name)) continue
        const path = join(dir, file.name)
        try {
          out.push({ id: id, path: path, mtimeMs: statSync(path).mtimeMs })
        } catch (err) { /* ignore */ }
      }
    }
  }
  return out
}

function recentSession() {
  const files = listSessionFiles()
  let best = null
  for (const file of files) if (!best || file.mtimeMs > best.mtimeMs) best = file
  return best ? best.id : ''
}

function findSessionFile(sessionId) {
  const norm = normalizeSessionId(sessionId)
  if (!norm) return ''
  const root = join(dshHome(), 'sessions')
  for (const ws of safeEntries(root)) {
    if (!ws.isDirectory() || ws.name.startsWith('.')) continue
    const dir = join(root, ws.name, 'session-' + norm)
    for (const file of safeEntries(dir)) {
      if (file.isFile() && /^session\.v\d+\.jsonl\.zstd$/.test(file.name)) return join(dir, file.name)
    }
  }
  return ''
}

function readSessionSelection(sessionId) {
  const file = findSessionFile(sessionId)
  if (!file) return null
  let st
  try {
    st = statSync(file)
  } catch (err) {
    return null
  }
  const hit = sessionCache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && Date.now() - hit.at < SESSION_CACHE_MS) return hit.selection
  let provider = ''
  let model = ''
  try {
    const raw = zstdDecompressSync(readFileSync(file)).toString('utf8')
    for (const line of raw.split('\n')) {
      if (!line) continue
      let rec
      try {
        rec = JSON.parse(line)
      } catch (err) {
        continue
      }
      if (!rec || rec.type !== 'assistant/message') continue
      const src = rec.data && rec.data.message && rec.data.message.source
      if (src && src.kind === 'model' && typeof src.provider === 'string' && typeof src.model === 'string') {
        provider = src.provider.trim()
        model = src.model.trim()
      }
    }
  } catch (err) {
    return null
  }
  const selection = provider && model ? { provider: provider, model: model, fallback: false, reason: 'native-session' } : null
  sessionCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, at: Date.now(), selection: selection })
  return selection
}

function localeDict(locale) {
  const raw = String(locale || '')
  const candidates = [raw, raw.split('-')[0], 'en', 'zh']
  for (const key of candidates) {
    if (key && Object.prototype.hasOwnProperty.call(LOCALES, key)) return LOCALES[key]
  }
  return LOCALES.en || {}
}

function tr(locale, key, fallback) {
  const dict = localeDict(locale)
  if (Object.prototype.hasOwnProperty.call(dict, key) && dict[key]) return dict[key]
  const en = LOCALES.en || {}
  if (Object.prototype.hasOwnProperty.call(en, key) && en[key]) return en[key]
  return fallback === undefined ? key : fallback
}

function hasKey(locale, key) {
  const dict = localeDict(locale)
  return Object.prototype.hasOwnProperty.call(dict, key) && !!dict[key]
}

function chatLabel(locale) {
  return hasKey(locale, 'ui.thisChat') ? tr(locale, 'ui.thisChat') : tr(locale, 'ui.session', 'Session')
}

function plainLabel(locale, key) {
  return String(tr(locale, key, '')).replace(/\s*\{symbol\}\{value\}\s*$/, '')
}

function windowLabel(locale, key) {
  if (key === 'five_hour') return tr(locale, 'host.hour', '5h')
  if (key === 'seven_day') return tr(locale, 'ui.weekly', 'wk')
  if (key === 'monthly') return tr(locale, 'ui.monthly', 'mo')
  return String(key || '')
}

function moneyText(currency, value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (n === null) return '—'
  const symbol = currency === 'USD' ? '$' : '¥'
  const abs = Math.abs(n)
  if (abs >= 10000) {
    const scaled = abs / 10000
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')
    return symbol + (n < 0 ? '-' : '') + text + '万'
  }
  return symbol + (n < 0 ? '-' : '') + abs.toFixed(2)
}

function pickMoney(costs) {
  if (!costs || typeof costs !== 'object') return null
  if (costs.CNY != null && Number.isFinite(Number(costs.CNY))) return { currency: 'CNY', value: Number(costs.CNY) }
  if (costs.USD != null && Number.isFinite(Number(costs.USD))) return { currency: 'USD', value: Number(costs.USD) }
  return null
}

function percent(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(100, Math.round(n))) + '%'
}

function clock(now) {
  const d = new Date(now)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function modeText(locale, mode) {
  if (mode === 'subscription') return tr(locale, 'ui.subscriptionQuota', 'Subscription')
  if (mode === 'billing') return tr(locale, 'ui.billing', 'Billing')
  if (mode === 'balance') return tr(locale, 'ui.balance.pushBalanceGroups', 'Balance')
  return tr(locale, 'ui.unknown', 'Unknown')
}

export function registerNative(ctx, deps) {
  if (!ctx || typeof ctx.inject !== 'function') return
  const {
    getUsageSummary,
    currentSessionSummary,
    activeBalanceSummary,
    refreshBalanceForNative,
    getSubscriptionSnapshotRpc,
    getBillingSnapshotRpc,
    detectBillingMode,
    modelSelection,
    selectionIsResolved,
    fieldSettings,
  } = deps

  const cache = new Map()
  let last = null
  let timer = null
  let busy = false
  let started = false

  function keyOf(scope) {
    return String((scope && scope.sessionId) || '')
  }

  async function load(scope, force) {
    const now = Date.now()
    const sessionId = scope && scope.sessionId ? String(scope.sessionId) : ''
    const fromSession = sessionId ? readSessionSelection(sessionId) : null
    const fallback = modelSelection()
    const selection = fromSession && selectionIsResolved(fromSession) ? fromSession : fallback
    const resolved = selectionIsResolved(selection)
    const mode = resolved ? detectBillingMode(selection.provider).mode : 'unknown'

    let usage = null
    if (resolved) {
      try {
        usage = await getUsageSummary(now, sessionId, selection)
      } catch (err) {
        usage = null
      }
    }
    let costs = usage && usage.currentSession ? usage.currentSession.costs : null
    if (!costs && sessionId) {
      try {
        const current = await currentSessionSummary(null, sessionId)
        costs = current ? current.costs : null
      } catch (err) {
        costs = null
      }
    }

    let balance = null
    if (resolved) {
      try {
        balance = force && typeof refreshBalanceForNative === 'function'
          ? await refreshBalanceForNative(selection)
          : activeBalanceSummary(now, selection)
      } catch (err) {
        balance = null
      }
    }
    let subscription = null
    let billing = null
    if (resolved && mode === 'subscription') {
      try {
        subscription = await getSubscriptionSnapshotRpc(selection, !!force)
      } catch (err) {
        subscription = null
      }
    }
    if (resolved && mode === 'billing') {
      try {
        billing = await getBillingSnapshotRpc(selection, !!force)
      } catch (err) {
        billing = null
      }
    }

    const sessionMoney = pickMoney(costs)
    const currency = sessionMoney ? sessionMoney.currency : 'CNY'
    const today = usage && typeof usage.todaySpend === 'number' ? { currency: currency, value: usage.todaySpend } : null
    const last30 = usage && typeof usage.last30dSpend === 'number' ? { currency: currency, value: usage.last30dSpend } : null
    const balanceMoney = balance && balance.data && typeof balance.data.total === 'number'
      ? { currency: balance.currency || 'CNY', value: balance.data.total }
      : null
    const billingMoney = billing && billing.data && typeof billing.data.currentPeriodSpend === 'number'
      ? { currency: billing.data.currency || currency, value: billing.data.currentPeriodSpend }
      : null
    const quotaMode = fieldSettings && fieldSettings.quotaDisplayMode === 'used' ? 'used' : 'remaining'
    const windows = subscription && Array.isArray(subscription.windows)
      ? subscription.windows.filter(function (w) { return w && typeof w.usedPercent === 'number' }).map(function (w) {
        const used = Math.max(0, Math.min(100, w.usedPercent))
        return { key: w.key, value: quotaMode === 'used' ? used : 100 - used }
      })
      : []

    const snapshot = {
      sessionId: sessionId,
      mode: mode,
      provider: resolved ? selection.provider : '',
      model: resolved ? selection.model : '',
      session: sessionMoney,
      today: today,
      last30: last30,
      balance: balanceMoney,
      windows: windows,
      billing: billingMoney,
      updated: clock(now),
    }
    cache.set(keyOf(scope), snapshot)
    last = snapshot
    return snapshot
  }

  async function tick(force) {
    if (busy) return
    busy = true
    try {
      const recent = recentSession()
      if (recent) await load({ sessionId: recent }, force)
    } catch (err) {
      /* keep the previous snapshot */
    } finally {
      busy = false
    }
  }

  function startPoller() {
    if (started) return
    started = true
    tick(false).catch(function () {})
    timer = setInterval(function () { tick(false).catch(function () {}) }, REFRESH_MS)
    if (timer && typeof timer.unref === 'function') timer.unref()
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () { return function () { if (timer) clearInterval(timer); timer = null } }, 'dsh-bottom-info-bar: native panel snapshot')
      }
    } catch (err) { /* older hosts */ }
  }

  function view(scope, caps) {
    const locale = caps && caps.locale ? caps.locale : ''
    const exact = cache.get(keyOf(scope))
    // A scope-less panel may fall back to the latest poll; a panel for a specific
    // conversation must never show another conversation's numbers.
    const snap = exact || (scope && scope.sessionId ? null : last)
    if (!exact && scope && scope.sessionId) load(scope, false).catch(function () {})
    const chat = chatLabel(locale)
    const labels = {
      provider: tr(locale, 'field.anchorGroup.label', 'Provider & model'),
      mode: tr(locale, 'ui.mode', 'Mode'),
      updated: String(locale).startsWith('zh') ? '更新时间' : 'Updated',
      refresh: tr(locale, 'ui.refresh', 'Refresh'),
      title: tr(locale, 'meta.title', 'Bottom Info Bar'),
    }
    const money = function (m) { return m ? moneyText(m.currency, m.value) : '—' }
    const metrics = []
    if (snap && snap.mode === 'subscription' && snap.windows.length > 0) {
      snap.windows.slice(0, 3).forEach(function (w) {
        metrics.push({ label: windowLabel(locale, w.key), value: percent(w.value) })
      })
      while (metrics.length < 3) {
        if (metrics.length === 1) metrics.push({ label: chat, value: money(snap.session) })
        else metrics.push({ label: plainLabel(locale, 'ui.today'), value: money(snap.today) })
      }
    } else if (snap && snap.mode === 'billing') {
      metrics.push({ label: tr(locale, 'ui.thisMonth', 'This month'), value: money(snap.billing) })
      metrics.push({ label: plainLabel(locale, 'ui.today'), value: money(snap.today) })
      metrics.push({ label: plainLabel(locale, 'ui.lastDays'), value: money(snap.last30) })
    } else {
      metrics.push({ label: tr(locale, 'ui.balance.pushBalanceGroups', 'Balance'), value: money(snap && snap.balance) })
      metrics.push({ label: plainLabel(locale, 'ui.today'), value: money(snap && snap.today) })
      metrics.push({ label: plainLabel(locale, 'ui.lastDays'), value: money(snap && snap.last30) })
    }
    const identity = snap && snap.provider && snap.model ? snap.provider + ' · ' + snap.model : '—'
    return {
      type: 'stack',
      title: labels.title,
      children: [
        { type: 'row', children: metrics.map(function (m) { return { type: 'metric', label: m.label, value: m.value } }) },
        {
          type: 'keyValue',
          items: [
            [chat, snap ? money(snap.session) : '…'],
            [labels.provider, identity],
            [labels.mode, snap ? modeText(locale, snap.mode) : '…'],
            [labels.updated, snap ? snap.updated : '…'],
          ],
        },
        { type: 'actions', items: [{ label: labels.refresh, action: 'refresh', icon: 'refresh' }] },
      ],
    }
  }

  ctx.inject(['dshGo'], function (goCtx) {
    if (!goCtx || !goCtx.dshGo || typeof goCtx.dshGo.panel !== 'function') return
    goCtx.dshGo.panel('info-panel', {
      view: view,
      actions: {
        refresh: function (event) {
          const scope = event && event.scope && event.scope.sessionId
            ? event.scope
            : { sessionId: recentSession() }
          load(scope, true).catch(function () {})
          return { refresh: true }
        },
      },
    })
    startPoller()
  })
}
