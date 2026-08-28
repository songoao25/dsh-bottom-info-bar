# 性能审计报告（v1.9.0 立项依据）

- 日期：2026-08-28
- 审计人：性能审计工程师（独立子代理）
- 性质：只读审计，未修改任何文件
- 触发来源：安装前检测插件反馈的「性能退化隐患」
- 结论：**反馈四条隐患全部属实，实测数据比反馈更严峻**——本机 usage-records.json 已 2.07MB/6050 条（仅 7.8 天），.bak 再 2.07MB，journal 已 3056 行/979KB

## ① 核实结论表

1. **「journal 永不截断」→ 属实。** appendUsageJournal 只以 'a' 追加（src/host.js:2025-2035，flags 'a' 在 2030）；全文件无任何 compact/truncate/rotate 逻辑（grep 0 命中）；注释明示 journal 是 source of truth（host.js:19-21）。flushSave 只重写 JSON 快照、从不清理 journal（host.js:2037-2058）。
2. **「内存记录数组无限增长」→ 属实。** loadUsageRecords 全量载入（host.js:701-743），recordUsage push（host.js:2132），无任何淘汰/上限；flushSave 全量 JSON.stringify(usageRecords)（host.js:2045），且每次落盘把旧快照 rotate 成 .bak（2046-2049）。历史版本曾有 3000 条上限，已被有意移除并有回归测试锁死「不许静默丢账」（tests/test-usage-ledger.mjs:2,57-70）——修复必须用汇总替代明细，不能恢复静默截断。
3. **「客户端 30s 轮询 + 每次回复后额外触发」→ 属实。** window.setInterval(load, 30000)（src/client-bundle.js:372）；statsProj 的 turns/steps/decodeTokens 任一变化 → 800ms 防抖后再 load（client-bundle.js:393-402，流式回复中持续重置、回复结束约 800ms 后触发，长回复多个空档会触发多次）；模型切换也触发（387-389）；每次 load 并发打 6 个 RPC（356-363）；首启 6s 窗口 force（29-30,351）。宿主侧 getUsageSummary 是唯一重负载路由。
4. **「每次全量扫 6+ 遍」→ 属实，实测 getUsageSummary 一次 = 8 遍全量扫**：sessionTotals(host.js:2212-2232)、currentSessionSummary 两遍(2265-2269 起点扫描 + 2272-2285 聚合)、spendSummary(2325-2337，每条 2 次 costOf：2331/2334)、todaySpend(2362-2370)、monthSpend(2382-2391)、last30dSpend(2400-2408)、totalSpend(2495-2502)。附加遍历点：providerSpend 因 openai 无余额 API 每 60s 全扫一遍(936,1045,2762)；启动 backfillUnpricedRecords 一遍(1985-2006,2755)+远程价目合并后再一遍(861)；getEstimate 调 sessionTotals 两次(2457,2481)；getSpendTrend 7/30 天=8/31 遍(2551-2579)——后两个 RPC 当前客户端未调用（client 0 命中），但已暴露。
5. **「单条记录大小/数月规模」→ 记录 15 字段**（id,ts,model,provider,sessionId,purpose,input,cacheRead,cacheWrite,output,status,cost,currency,pricingStatus,pricingVersion），快照实测均值 370B/条、journal 328B/行；本机峰值日 1786 条。重度 6 个月 ≈ 27-32 万条 → 磁盘（快照+.bak+journal）≈ 300MB；堆内存 ≈ 120-180MB；每次汇总 8×30 万=240 万次迭代（估 150-400ms 主线程阻塞，每 30s+每次回复各一次）；flushSave 每 4s 防抖全量 stringify 百 MB 级字符串。反馈的「持续拖慢宿主」机制成立且可量化。

## ② 现状数据流

llm/stream 结束 → recordUsage：journal 追加 fsync 成功才 push 内存 + 防抖 4s 全量重写快照；客户端 30s/回复后 load → getUsageSummary 在宿主同步全扫 8 遍组装 JSON。

## ③ 修复方案

**A. journal 滚动截断**——flushSave 原子写快照成功且 journal > 2000 行或 > 2MB 时，把 journal 原子替换为「快照之后新增的残留行」（tmp+rename）；任何中断点靠「快照/journal 至少其一完整」+ 既有 id 去重（host.js:694-699,722-730）兜底，天然幂等。

**B. 明细保留窗 + 汇总**——新增 usage-summaries.json：
- dayBuckets（北京日键 × 账户 × 币种 → {input, cacheRead, cacheWrite, output, cost, costOffpeak, records, unpriced}，costOffpeak 供 spendSummary/spendTrend 的全空闲口径）
- sessionIndex（normalizeSessionId → {minTs, maxTs, tokens, costs}，无 sessionId 记录沿用 provider/model#ts 兜底键）

仅折叠「priced 且 cost 有限」且超过保留窗（建议 90 天）的记录；**unpriced 永不折叠**（保住 backfillUnpricedRecords 1985-2006 与远程目录 6h 回填 861 的语义），另设十万条硬顶。被折叠明细可选追加进 usage-archive/YYYY-MM.jsonl 冷归档（只顺序写、运行期绝不读）。

**C. 增量缓存**——recordUsage push 后 O(1) 更新当日桶与 sessionIndex；version 计数器在 push/backfill(count>0)/折叠时 +1，getUsageSummary 等先比对 version 命中即 O(桶数) 组装。「本会话」语义原样保留：起点由 sessionIndex.minTs O(1) 取得；起点之后的天直接读桶，起点当天（边界天）在 ts 有序明细上二分后逐条过滤 r.ts>=start && recordAccount===activeAccount——桶与边界天不重复计算，等价于现行两遍全扫。sessionTotals 改由 sessionIndex 直接输出。

**D. 8 遍全扫全部改读桶/索引**；providerSpend 读账户累计器 O(1)；getEstimate 两次 sessionTotals 合并为一次；spendTrend 改一次按桶扫描。**客户端 30s 轮询与回复后刷新节奏完全不动**，用户可感知行为零变化。

## ④ 兼容与迁移

usage-records.json 保持纯数组格式不变（readUsageSnapshot 要求 Array，host.js:686-692；恢复链 snapshot→.bak→tmp 及旧版回滚兼容）；新增文件仅 summaries/归档。首次升级：无 summaries 且明细超阈值 → 启动时一次性 O(N) 全量建桶+sessionIndex（6050 条 <50ms）→ 标 foldedUpTo → 首次压缩时才重写快照为窗内明细（复用原子写）→ 失败则丢 summaries 重来（动快照前绝不删数据）。回滚到旧版仅显示窗内累计，CHANGELOG 注明。

## ⑤ 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 会话起点早于压缩窗 | 中 | sessionIndex 永不清空 + 等价性测试 |
| unpriced × 压缩交互 | 低 | unpriced 不折叠 |
| 多实例重叠截断竞态 | 低 | id 去重 + 偏移基线，重叠恢复已有测试 tests/test-usage-stream-ledger.mjs:92-112 |
| 维度漏聚合 | 低 | 随机数据属性测试 |
| 压缩中途崩溃 | 低 | 沿用 .bak/tmp 恢复链 |

## ⑥ 工作量

总体=**中（3-4 人日）**：journal 截断=小 0.5 天；桶+索引+持久化=中 1-1.5 天；8 聚合改造+边界天=中 1 天；等价性/迁移/崩溃测试=中 1 天。

## ⑦ 验收标准建议（全部可写成测试）

1. 90 天 5000 条压缩后 totalSpend/todaySpend/last30dSpend 与全扫基线逐字段相等，快照条数≤保留窗、journal 行数≤阈值，重启后总额不变（幂等）
2. 会话起点在压缩窗之前的 sessionId，currentSessionSummary tokens/costs 压缩前后相等（v1.7「起点+同账户含子代理」语义回归锁）
3. unpriced 明细压缩后仍可被远程价目合并回填
4. 明细遍历计数断言：getUsageSummary 一次仅扫边界天（不随总记录数增长），recordUsage 单条 O(1)
5. 压缩中途杀进程 → 重启总额一致无重复计费
6. 既有三套账本测试保持 PASS（尤其「超过 3000 条完整加载」tests/test-usage-ledger.mjs:69 与「无静默丢账」）

证据基于 src/host.js、src/client-bundle.js、src/constants.js 及三份测试逐行核实；lib/index.js、lib/client.js 为构建产物（diff 仅差生成头与常量注入，行号 +1 偏移）。
