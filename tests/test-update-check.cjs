// 版本检查与极简信息提醒静态回归
const fs = require('fs')
const host = fs.readFileSync('src/host.js', 'utf8')
const client = fs.readFileSync('src/client-bundle.js', 'utf8')
let pass = 0
let fail = 0
function check(name, actual, expected = true) {
  if (actual === expected) { pass++; console.log('PASS ', name) }
  else { fail++; console.log('FAIL ', name, '—', actual, '!==', expected) }
}

const logicStart = host.indexOf('function stableVersion')
const logicEnd = host.indexOf('const UPDATE_LATEST_TTL_MS')
const { stableVersion, compareVersions } = Function(host.slice(logicStart, logicEnd) + '; return { stableVersion, compareVersions }')()

check('实际识别普通稳定版本号', JSON.stringify(stableVersion('1.4.1')) === JSON.stringify([1, 4, 1]))
check('实际识别 v 前缀版本号', JSON.stringify(stableVersion('v2.0.0')) === JSON.stringify([2, 0, 0]))
check('实际拒绝预发布版本号', stableVersion('1.4.1-rc.1') === null)
check('实际比较新版本大于当前版本', compareVersions('1.4.1', '1.4.0') > 0)
check('实际比较相同版本', compareVersions('1.4.0', '1.4.0') === 0)
check('实际比较旧版本小于当前版本', compareVersions('1.3.9', '1.4.0') < 0)
const registryMatch = host.match(/const UPDATE_REGISTRY_URL = '([^']+)'/)
let registryUrl = null
try { registryUrl = registryMatch ? new URL(registryMatch[1]) : null } catch { /* 静态检查失败 */ }
check('host 使用固定 NPM registry 地址', !!registryUrl
  && registryUrl.protocol === 'https:'
  && registryUrl.hostname === 'registry.npmjs.org'
  && registryUrl.pathname === '/dsh-bottom-info-bar/latest')
check('host 从 package.json 动态读取当前版本', host.includes("new URL('../package.json', import.meta.url)") && host.includes('packageVersion()'))
check('host 版本检查有 5 秒超时', host.includes('UPDATE_CHECK_TIMEOUT_MS = 5000') && host.includes('controller.abort()'))
// 2026-09-24 起：npm 最新版本按 TTL 重查（不再是进程内一次性检查），
// 本机已安装版本每次从磁盘重读 —— 否则「更新完还显示提醒」要等刷新页面/重启宿主才消失。
check('host 按 TTL 缓存 npm 最新版本（默认 15 分钟，失败 1 分钟后重试）',
  host.includes('const UPDATE_LATEST_TTL_MS = 15 * 60 * 1000')
  && host.includes('const UPDATE_LATEST_RETRY_MS = 60 * 1000')
  && host.includes('if (now < updateLatestCache.expiresAt) return Promise.resolve(updateLatestCache.value)'))
check('host 的 getUpdateInfo 每次重读已安装版本并重算可用性',
  host.includes('getUpdateInfo: async function ()')
  && host.includes('const latest = await latestVersion()')
  && host.includes('const current = packageVersion()')
  && host.includes('available: !!latest && compareVersions(latest, current) > 0'))
check('host 启动时预热一次版本查询（失败不影响信息栏）',
  host.includes('预热一次 npm 版本查询') && /\n    latestVersion\(\)\n/.test(host))
check('host 查询失败时保留上一次已知版本（不闪提醒）',
  host.includes('if (value !== null) updateLatestCache.value = value'))
check('host 版本查询留了 TTL 测试覆盖口（生产不设置）',
  host.includes('DSH_BOTTOM_INFO_BAR_UPDATE_TTL_MS') && host.includes('function updateLatestTtlMs()'))
check('client 只保留一处 getUpdateInfo 调用点（供定期 / 可见性重读复用）',
  (client.match(/rpc\('getUpdateInfo'/g) || []).length === 1
  && client.includes('const readUpdateInfo = function ()'))
check('client 每 60 秒重读版本信息（用于版本诊断，不占聊天信息栏）',
  client.includes('const UPDATE_INFO_REFRESH_MS = 60000;')
  && client.includes('window.setInterval(readUpdateInfo, UPDATE_INFO_REFRESH_MS)'))
check('client 在页面重新可见 / 窗口获得焦点时也重读版本信息',
  client.includes("document.addEventListener('visibilitychange', onVisible)")
  && client.includes("window.addEventListener('focus', onVisible)"))
check('client 卸载时清理定时器与监听（不留悬挂副作用）',
  client.includes('window.clearInterval(timer)')
  && client.includes("document.removeEventListener('visibilitychange', onVisible)")
  && client.includes("window.removeEventListener('focus', onVisible)"))
check('client 无论是否有更新都保存当前插件版本', client.includes("typeof info.current === 'string') setUpdateInfo(info)"))
check('余额制服务商/模型 hover 显示当前插件版本', client.includes("t('ui.pluginVersion', { current: updateInfo.current })"))
check('余额/订阅/账单制 hover 均显示当前插件版本（≥2 处）', (client.match(/t\('ui\.pluginVersion', \{ current: updateInfo\.current \}\)/g) || []).length >= 2)
check('client 不把新版本作为聊天信息栏标签', !client.includes("fieldSpan('updateNotice'"))
check('client 不再引导复制更新命令', !client.includes('copyTextToClipboard') && !client.includes('updateCommandCopied'))
// host 侧连「探测 git 仓库状态」都不许开子进程（v1.14.3）：更新命令只被复制、绝不执行，
// 探测只读文件系统完成。锁死这条，避免以后有人图省事改成 spawnSync('git', …)。
check(
  '不包含自动更新命令执行逻辑（host/client 均不引入子进程）',
  !client.includes('child_process') && !host.includes('child_process')
  && !host.includes('exec(') && !host.includes('spawn(')
)

console.log(`结果：${pass} PASS / ${fail} FAIL`)
process.exit(fail > 0 ? 1 : 0)
