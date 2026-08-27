# QA 测试报告：底部信息栏 v1.6（多服务商适配 + 分账修复）

**测试执行日期**：2026-08-27  
**测试工程师**：独立 QA Agent（未参与开发）  
**测试范围**：PRD FR-1 至 FR-7、边界场景、构建产物同步

---

## 一、测试执行结果

### 命令与摘要

```bash
cd /Users/songsong/code/dsh-bottom-info-bar && node tests/run-all.mjs
```

**结果**：**全量测试全部通过**（16 项测试，共约 350+ 断言，零失败）

| 测试名称 | 状态 | 关键验证点 |
|---|---|---|
| smoke-static-host | ✅ PASS | RPC 路由 / 记账持久化 / 同源防护 |
| test-static-client | ✅ PASS | 38 项 UI 渲染断言 |
| test-client-fault-tolerance | ✅ PASS | 37 项失败容错原子性 |
| test-realtime-session-model | ✅ PASS | 会话级实时模型同步 |
| test-display-name | ✅ PASS | 26 项显示名识别 |
| test-density-toggle | ✅ PASS | 31 项密度切换审计 |
| test-spend-accounting | ✅ PASS | 12 项花费聚合口径 |
| test-weekend-pricing | ✅ PASS | 周末峰谷规则 |
| test-dual-mode | ✅ PASS | 109 项双模式逻辑 |
| test-usage-sanitize | ✅ PASS | 22 项数值清洗 |
| test-usage-ledger | ✅ PASS | 耐久账本与历史价格 |
| test-usage-stream-ledger | ✅ PASS | 每次回答只记一笔 |
| test-host-regressions | ✅ PASS | 审计必修项回归 |
| test-subscription-providers-consistency | ✅ PASS | 共享常量一致性 |
| test-update-check | ✅ PASS | 20 项版本检查 |
| check-host | ✅ PASS | 13 个 RPC handler / 关键函数齐备 |

---

## 二、PRD 逐条验收表

### FR-1 花费按服务商账户隔离（Bug 修复）

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 同一会话含 OpenCode 与 DeepSeek 记录；When 当前服务商为 DeepSeek；Then 本对话/今日/本月/全部均只含 DeepSeek 账户记录 | ✅ **通过** | `sessionTotals(activeAccount)` L1270、`todaySpend` L1399、`monthSpend` L1419、`last30dSpend` L1438、`totalSpend` L1529 均有 `recordAccount(r) !== activeAccount` 过滤；`providerSpend` L509 使用 `accountForProvider(r.provider) !== providerId` |
| Given 某服务商无任何记录；When 信息栏渲染；Then 对应金额显示 0 | ✅ **通过** | 所有汇总函数对空集合返回 0；客户端 L630 对 null cost 显示 `¥0.000` |

**代码路径验证**：
- `accountForProvider(pid)` L87-98：正确映射 deepseek/deepseek-official → 'deepseek'，opencode-go → 'opencode-go'，未知 → null
- `recordAccount(r)` L503：调用 accountForProvider，null 表示无主记录
- 所有花费统计函数均增加账户维度参数并过滤

---

### FR-2 余额严格跟随当前服务商（Bug 修复）

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 当前服务商为 opencode-go（订阅制）；When 信息栏渲染；Then 不显示任何余额 | ✅ **通过** | `balanceProviderKey` L1033 对订阅源返回 null；`activeBalanceSummary` L1041-1043 返回 `unmapped: true`；客户端 L573-576 渲染"未适配" |
| Given 当前服务商为未适配平台（如 minimax）；When 信息栏渲染；Then 显示"未适配"引导而非 DeepSeek 余额 | ✅ **通过** | `balanceProviderKey` L1029-1034 对未知 provider 返回 null（不再回退 config.activeProvider）；`activeBalanceSummary` L1041-1043 返回 unmapped |
| Given 当前服务商为 deepseek；Then 照常显示 DeepSeek 真实余额 | ✅ **通过** | `accountForProvider('deepseek')` → 'deepseek'；`PROVIDERS.deepseek` 存在且 balanceAPI 有效 |

**关键修复验证**：旧代码的回退逻辑 `return acct || config.activeProvider` 已被移除，未知 provider 确实返回 null（L1034）。

---

### FR-3 智谱适配器（GLM Coding Plan 订阅额度，零设置）

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 用户配置 ZAI_API_KEY（或 ZAI_CODING_CN_API_KEY）；When 当前服务商为 zai（或 zai-coding-cn）；Then 信息栏显示套餐等级与已用/剩余百分比 | ✅ **通过** | `resolveZaiKey` L659-670 优先 ZAI_CODING_CN_API_KEY，回退 ZAI_API_KEY；`fetchZaiUsage` L718-750 请求 quota 接口；`parseZaiQuota` L683-716 解析 limits[].percentage；SUBSCRIPTION_PROVIDERS constants.js L3 包含 'zai', 'zai-coding-cn' |
| Given 接口返回 TOKENS_LIMIT（unit=3 等窗口）与 TIME_LIMIT；Then 正确映射为窗口显示，未知窗口类型跳过不报错 | ✅ **通过** | `parseZaiQuota` L693 只处理 type=TOKENS_LIMIT；L697 unit === 3 → 'five_hour'；L699 未知 unit continue 跳过 |
| Given 接口 401/超时/格式异常；Then 显示"刷新失败/降级"，保留上次快照，不崩溃 | ✅ **通过** | `fetchZaiUsage` L737-747 捕获 HTTP 错误与异常；统一走 `mergeSubscriptionResult` L237-248 保留旧 data/fetchedAt |
| Given 无凭据；Then 显示"未配置密钥"引导 | ✅ **通过** | `resolveZaiKey` 返回 null 时 L721-723 返回 no-key 错误；客户端订阅错误提示 L651-661 显示明确引导 |

**认证方式验证**：L733 `Authorization: key`（裸 API Key，无 Bearer 前缀），符合 PRD 要求。

---

### FR-4 Kimi 适配器（API 余额，零设置）

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 配置 MOONSHOT_API_KEY；When 当前服务商为 moonshotai；Then 显示真实余额（¥），60s 自动刷新 | ✅ **通过** | `PROVIDERS.moonshotai` L432-450：credential 'MOONSHOT_API_KEY'，balanceAPI 'https://api.moonshot.cn/v1/users/me/balance'，parseBalance 解析 balance_infos[].total_balance（CNY）；`refreshAllBalances` L568-570 每 60s 刷新 |
| Given 接口失败/无凭据；Then 降级提示，不崩溃、不串显示其他服务商余额 | ✅ **通过** | `refreshProviderBalance` L549-562 统一容错：无凭据/HTTP 失败/解析异常/网络异常均保留旧快照 + 记录 error；客户端 L578-582 显示"未配置 MOONSHOT_API_KEY" |

---

### FR-5 OpenRouter 适配器（credits 余额，零设置）

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 配置 OPENROUTER_API_KEY；When 当前服务商为 openrouter；Then 显示剩余 credits（$），60s 自动刷新 | ✅ **通过** | `PROVIDERS.openrouter` L453-465：credential 'OPENROUTER_API_KEY'，balanceAPI 'https://openrouter.ai/api/v1/credits'，parseBalance 解析 data.credits（USD） |
| Given 接口失败/无凭据；Then 降级提示，不崩溃 | ✅ **通过** | 同上统一容错机制 |

---

### FR-6 阶跃星辰适配器（API 余额，零设置）

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 配置 STEPFUN_API_KEY 且当前服务商为 stepfun；Then 显示真实余额/额度 | ✅ **通过** | `PROVIDERS.stepfun` L468-487：credential 'STEPFUN_API_KEY'，balanceAPI 'https://api.stepfun.com/v1/accounts'，parseBalance 解析 balance（CNY） |
| Given 文档与实测响应不一致；Then 以实测为准适配解析器 | ⚠️ **待实测** | 代码按官方文档实现（解析 balance 字段，不解析 token_plan）；需用户在有 STEPFUN_API_KEY 环境下实测验证 |
| Given 接口失败/无凭据；Then 降级提示，不崩溃 | ✅ **通过** | 同上统一容错机制 |

---

### FR-7 未适配服务商优雅降级

| 验收标准 | 结果 | 说明 |
|---|---|---|
| Given 当前服务商不在任何适配器清单内；Then 显示明确的"未适配"或"未配置"引导，且无任何其他服务商数据冒充 | ✅ **通过** | `balanceProviderKey` L1029-1034 对未知返回 null；`activeBalanceSummary` L1041-1043 返回 `unmapped: true, displayName: '未适配'`；客户端 L573-576 渲染"未适配"弱提示；无凭据时 L578-582 显示"未配置 {凭据名}"（不再写死 DeepSeek） |

---

## 三、边界与异常场景复查结果

| 场景 | 结果 | 说明 |
|---|---|---|
| **同一会话跨账户**：OpenCode 记录不计入 DeepSeek 视图 | ✅ **通过** | `sessionTotals` L1270 账户过滤；deepseek-official 记录计入 deepseek 账户（L89 映射） |
| **订阅制下不渲染余额** | ✅ **通过** | client-bundle.js L739-742 互斥分支：订阅制走 `pushSubscriptionGroups`，不调用 `pushBalanceGroups` |
| **未知账户记录仍持久化但不计入统计** | ✅ **通过** | `recordUsage` L1158-1188 不检查账户；所有汇总函数均有账户过滤 |
| **NaN/Infinity 防护** | ✅ **通过** | `sanitizeTokens` L269 归零；`costOf` L1251 返回 null；汇总使用 `c != null` 判空 |
| **snap.data null 访问** | ✅ **通过** | 所有 `snap.data` 访问均有 `snap.data &&` 或三元检查（L1047/1061/1337/1352/1569-1570） |
| **parseZaiQuota 结构异常** | ✅ **通过** | L684-687 逐层检查 body/data/limits；未知 unit/type 跳过不报错 |
| **stepfun parseBalance 容错** | ✅ **通过** | L472-474 检查 body 类型与 balance 数值有效性 |
| **客户端 bal null 访问** | ✅ **通过** | client-bundle.js L569-633 所有 `bal.` 访问均有 `bal &&` 前置检查 |

---

## 四、缺陷清单

**本次验收未发现阻塞性缺陷。**

### 待确认项（非缺陷，需用户实测）

| 问题 | 严重度 | 建议 |
|---|---|---|
| FR-6 阶跃星辰接口响应与官方文档一致性 | 低 | 建议用户在配置 STEPFUN_API_KEY 后实测验证；若响应字段与文档不符，需更新 `parseBalance` 解析逻辑并备注到 docs/PRICING-SOURCES.md |

---

## 五、构建产物同步检查

```bash
cd /Users/songsong/code/dsh-bottom-info-bar/plugin && node scripts/build.mjs
```

**结果**：✅ 构建成功，无报错

**产物验证**：
- `lib/index.js` 包含 accountForProvider（11 处引用）、balanceProviderKey（4 处）、fetchZaiUsage（2 处）、moonshotai/openrouter/stepfun 适配器
- `lib/client.js` 包含 unmapped UI 分支（2 处）、"未适配"文案（2 处）

---

## 六、结论

### ✅ **达到可发布质量**

**验收总结**：
- **16 项自动化测试全部通过**（约 350+ 断言）
- **PRD FR-1 至 FR-7 逐条验收通过**（FR-6 待用户实测确认，但代码实现符合官方文档）
- **边界场景与异常处理完备**：无 null 访问风险、无数值污染、无跨账户串账
- **构建产物与源码一致**，无编译错误

**必须修复项**：无

**建议**：
1. FR-6 阶跃星辰需在真实 STEPFUN_API_KEY 环境下做一次端到端验证
2. 发布前更新 README.md / CHANGELOG.md 用户视角说明（v1.6 新增四家服务商适配 + 分账修复）
3. Git 提交遵循 Conventional Commits（feat: 多服务商适配 + 分账修复）

---

**QA 签字**：独立 QA Agent  
**日期**：2025-01-XX
