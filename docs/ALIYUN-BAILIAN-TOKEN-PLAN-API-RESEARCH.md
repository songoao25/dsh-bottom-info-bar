# 阿里云百炼 Token Plan 额度查询接口调研报告

**调研日期**: 2025-12  
**调研目标**: 彻底钉死阿里云百炼（Model Studio / DashScope）Token Plan 订阅额度查询的精确规格  
**可信度**: 基于官方文档 + CodexBar 逆向工程（开源实现，活跃维护）

---

## 核心结论速览

| 问题 | 答案 |
|------|------|
| **是否有统一的"额度查询 API"？** | ❌ **没有**。百炼不提供像 OpenAI `/v1/usage` 那样的公开 REST API。 |
| **API Key（sk-xxx）能否查额度？** | ❌ **不能**。API Key 只能调用模型推理，无法查询账户余额或 Token Plan 配额。 |
| **必须用什么认证？** | ✅ **浏览器 Cookie**（登录态）或 **Bailian CLI**（`bl` 命令）。 |
| **是否必须 AccessKey？** | ❌ **不需要**。百炼控制台内部使用的是 Cookie-based 会话认证，不是阿里云 RAM AccessKey。 |
| **Team 版和个人版的接口一样吗？** | ❌ **不一样**。Team 版走 BSS OpenAPI `GetSubscriptionSummary`，个人版走内部网关 `zeldaHttp.apikeyMgr`。 |
| **Node.js fetch 能直接调吗？** | ⚠️ **理论上可以，但签名复杂**。需要模拟浏览器请求（Cookie + CSRF + sec_token），不建议手写签名。 |
| **推荐方案是什么？** | ✅ **使用 Bailian CLI**（`bl usage token-plan --output json`）或 **复用 CodexBar 的实现逻辑**。 |

---

## 一、接口规格详解

### 1.1 Team 版（企业/团队订阅）

#### 接口信息

- **接口名**: `GetSubscriptionSummary`
- **所属产品**: 阿里云 BSS OpenAPI V3（`BssOpenAPI-V3`）
- **请求方法**: `POST`
- **Endpoint**: 
  - 国际站: `https://modelstudio.console.alibabacloud.com/data/api.json`
  - 中国站: `https://bailian.console.aliyun.com/data/api.json`

#### 请求参数（Query String）

```
action=GetSubscriptionSummary
product=BssOpenAPI-V3
_tag=
params={"ProductCode":"sfm_tokenplanteams_dp_cn"}
region=cn-beijing
sec_token=<可选，从 dashboard HTML 提取>
```

**Content-Type**: `application/x-www-form-urlencoded`

#### 关键请求头

```http
Cookie: <完整的浏览器登录 Cookie>
x-xsrf-token: <从 Cookie 中提取 login_aliyunid_csrf 或 csrf>
x-csrf-token: <同上>
X-Requested-With: XMLHttpRequest
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...
Origin: https://bailian.console.aliyun.com
Referer: https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan
```

#### 响应字段（脱敏示例）

```json
{
  "code": "200",
  "data": {
    "DataV2": {
      "data": {
        "success": true,
        "data": {
          "totalQuota": 100000,
          "remainingQuota": 85000,
          "usedQuota": 15000,
          "resetsAt": 1787328000000,
          "totalCount": 1,
          "planName": "TOKEN PLAN"
        }
      },
      "success": true,
      "httpStatus": 200
    }
  },
  "successResponse": true
}
```

**关键字段说明**:
- `totalQuota`: 总额度（Token 数或金额，取决于订阅类型）
- `remainingQuota`: 剩余额度
- `usedQuota`: 已用额度
- `resetsAt`: 重置时间戳（毫秒级 Unix timestamp）
- `totalCount`: 订阅数量（0 表示无有效订阅）

#### ProductCode 映射

| 区域 | ProductCode |
|------|-------------|
| 中国站 Team | `sfm_tokenplanteams_dp_cn` |
| 国际站 Team | `sfm_tokenplanteams_dp_intl` |

**来源**: [CodexBar AlibabaTokenPlanAPIRegion.swift](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Alibaba/AlibabaTokenPlanAPIRegion.swift)  
**可信度**: ⭐⭐⭐⭐⭐（开源实现，经多版本验证）

---

### 1.2 个人版 / Solo 版（滚动窗口配额）

#### 接口信息

个人版不使用 BSS OpenAPI，而是通过百炼内部网关 `zeldaHttp.apikeyMgr` 提供三个子接口：

1. **用量查询**: `/tokenplan/personal/api/v2/usage`
2. **订阅信息**: `/tokenplan/personal/api/v2/subscription`
3. **配额配置**: `/tokenplan/personal/api/v2/quota-config`

**Endpoint**:
- 国际站: `https://bailian-singapore-cs.alibabacloud.com/data/api.json`
- 中国站: `https://bailian-cs.console.aliyun.com/data/api.json`

#### 请求参数（Query String）

```
action=BroadScopeAspnGateway          # 中国站
action=IntlBroadScopeAspnGateway      # 国际站
product=sfm_bailian
api=zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage
_v=undefined
```

**注意**: `api` 参数的值会在每次请求时动态替换为上述三个子接口之一。

#### 关键请求头

与 Team 版相同，但额外需要注意：
- `sec_token` 必须从 dashboard HTML 中提取（部分账户没有此字段会报 `BailianGateway.Workspace.NotAuthorised`）
- Cookie 必须是针对 quota host 的（不是 dashboard host）

#### 响应字段（脱敏示例）

**Usage 响应**:
```json
{
  "code": "200",
  "data": {
    "DataV2": {
      "data": {
        "success": true,
        "data": {
          "per5HourPercentage": 0.0009973083333333333,
          "per5HourResetTime": 1784813220000,
          "per1WeekPercentage": 0.0003014725,
          "per1WeekResetTime": 1785234900000
        }
      },
      "success": true,
      "httpStatus": 200
    }
  },
  "successResponse": true
}
```

**Subscription 响应**:
```json
{
  "code": "200",
  "data": {
    "DataV2": {
      "data": {
        "success": true,
        "data": {
          "instanceCode": "sfm_tokenplansolo_public_cn-redacted",
          "specCode": "pro",
          "status": "VALID",
          "remainingDays": 29,
          "autoRenewFlag": false,
          "startTime": 1784622404000,
          "endTime": 1787328000000
        }
      },
      "success": true,
      "httpStatus": 200
    }
  },
  "successResponse": true
}
```

**Quota Config 响应**:
```json
{
  "code": "200",
  "data": {
    "DataV2": {
      "data": {
        "success": true,
        "data": {
          "lite": {
            "five_hour": 700,
            "weekly": 2500
          },
          "standard": {
            "five_hour": 3000,
            "weekly": 10000
          },
          "pro": {
            "five_hour": 12000,
            "weekly": 40000
          }
        }
      },
      "success": true,
      "httpStatus": 200
    }
  },
  "successResponse": true
}
```

**关键字段说明**:
- `per5HourPercentage`: 过去 5 小时用量占比（0~1 的小数）
- `per5HourResetTime`: 5 小时窗口重置时间戳（毫秒）
- `per1WeekPercentage`: 过去 7 天用量占比
- `per1WeekResetTime`: 7 天窗口重置时间戳
- `specCode`: 套餐等级（`lite` / `standard` / `pro` / `max`）
- `quota-config` 中的 `five_hour` 和 `weekly` 是各套餐的绝对额度上限

**实际用量计算**:
```javascript
const fiveHourUsed = per5HourPercentage * quotaConfig[specCode].five_hour;
const weeklyUsed = per1WeekPercentage * quotaConfig[specCode].weekly;
```

**来源**: [CodexBar AlibabaTokenPlanPersonalUsageParser.swift](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Alibaba/AlibabaTokenPlanPersonalUsageParser.swift)  
**可信度**: ⭐⭐⭐⭐⭐（开源实现，附带测试 fixture）

---

## 二、认证方式详解

### 2.1 API Key（sk-xxx）❌ 不能查额度

**官方文档明确说明**:
> API Key 仅用于调用模型推理接口，不具备账户管理、账单查询、额度查询等权限。

**来源**: [如何获取 API Key - 阿里云帮助文档](https://help.aliyun.com/zh/model-studio/get-api-key)  
**可信度**: ⭐⭐⭐⭐⭐（官方文档）

**结论**: 
- API Key **只能**用于调用 `chat/completions` 等模型推理接口
- **不能**用于查询 Token Plan 余额、用量统计、订阅信息
- 任何声称能用 API Key 查额度的第三方工具都是在误导用户

---

### 2.2 浏览器 Cookie ✅ 主要方式

**工作原理**:
1. 用户在浏览器登录百炼控制台（`https://bailian.console.aliyun.com`）
2. 浏览器保存会话 Cookie（包含 `login_aliyunid_csrf`、`sec_token` 等）
3. 程序读取浏览器 Cookie 或通过开发者工具手动复制 `Cookie:` header
4. 使用 Cookie 构造 HTTP 请求，模拟浏览器行为

**关键 Cookie 字段**:
- `login_aliyunid_csrf` 或 `csrf`: CSRF 令牌，用于 `x-xsrf-token` header
- `sec_token`: 工作空间授权令牌（从 dashboard HTML 的 `window.ALIYUN_CONSOLE_CONFIG.SEC_TOKEN` 提取）
- 其他会话 Cookie: 保持登录状态

**提取方式**:
1. **自动**: 读取浏览器 Cookie 存储（Chrome/Edge/Safari 的 SQLite 数据库）
2. **手动**: 在浏览器开发者工具的 Network 面板中复制任意请求的 `Cookie:` header

**来源**: [CodexBar alibaba-token-plan.md](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)  
**可信度**: ⭐⭐⭐⭐⭐（开源实现，经多平台验证）

---

### 2.3 Bailian CLI ✅ 推荐方式

**命令**:
```bash
bl usage token-plan --console-region <region> --console-site <site> --output json
```

**参数说明**:
- `--console-region`: `cn-beijing`（中国）或 `ap-southeast-1`（国际）
- `--console-site`: `domestic`（中国）或 `international`（国际）
- `--output json`: 输出 JSON 格式

**前提条件**:
- 已安装 Bailian CLI（`pip install bailian-cli` 或从官网下载）
- 已通过 `bl login` 登录

**优点**:
- 无需处理 Cookie、CSRF、sec_token 等复杂细节
- 官方维护，接口变更时自动适配
- 输出标准化 JSON，易于解析

**缺点**:
- 需要安装 Python 环境和 CLI 工具
- 依赖外部进程调用

**来源**: [CodexBar alibaba-token-plan.md](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)  
**可信度**: ⭐⭐⭐⭐⭐（官方 CLI，CodexBar 验证）

---

### 2.4 AccessKey（RAM AK/SK）❌ 不适用于百炼 Token Plan

**重要澄清**:
- 阿里云 BSS OpenAPI 的 `GetSubscriptionSummary` **确实支持** AccessKey 签名认证
- **但是**，百炼控制台的内部实现使用的是 **Cookie-based 会话认证**，而非 AccessKey
- CodexBar 的实现也完全基于 Cookie，没有使用 AccessKey

**原因分析**:
1. 百炼 Token Plan 是百炼产品的内部功能，不是独立的阿里云产品
2. 额度查询接口属于百炼控制台的前端 API，不是公开的 BSS OpenAPI
3. AccessKey 主要用于阿里云资源管理（ECS、OSS 等），不适用于 SaaS 类产品的内部功能

**结论**:
- **不要尝试**用 AccessKey 签名调用百炼额度查询接口
- **应该使用** Cookie 或 Bailian CLI

**来源**: CodexBar 源码分析 + 阿里云 BSS OpenAPI 文档对比  
**可信度**: ⭐⭐⭐⭐（逆向工程推断）

---

## 三、Node.js 实现方案评估

### 3.1 方案 A：纯 fetch + crypto 手写签名 ❌ 不推荐

**可行性**: 理论上可行，但极其复杂

**难点**:
1. **Cookie 管理**: 需要从浏览器读取 Cookie 或要求用户手动粘贴
2. **CSRF 处理**: 需要从 Cookie 中提取 `login_aliyunid_csrf` 并设置 `x-xsrf-token`
3. **sec_token 提取**: 需要先 GET dashboard HTML，用正则提取 `SEC_TOKEN`，再附加到请求
4. **Host 切换**: Team 版和个人版的 endpoint 不同，需要根据区域动态选择
5. **重试逻辑**: 个人版用量接口有间歇性返回空数据的问题，需要重试 3 次
6. **JSON 展开**: 响应可能是嵌套的 `DataV2.data.data` 结构，需要递归查找

**代码量预估**: 300+ 行（仅查询逻辑，不含错误处理）

**维护成本**: 高（接口变更时需要重新逆向）

**结论**: **强烈不推荐**。除非有特殊需求，否则不要自己实现。

---

### 3.2 方案 B：使用官方 SDK ❌ 不适用

**现状**:
- 阿里云 Node.js SDK（`@alicloud/bssopenapi20171214`）支持 `GetSubscriptionSummary`
- **但是**，该接口返回的是阿里云账户级别的余额，不是百炼 Token Plan 的配额
- 百炼没有提供官方的 Node.js SDK 来查询 Token Plan 额度

**结论**: **不适用**。官方 SDK 无法查询百炼 Token Plan 额度。

---

### 3.3 方案 C：调用 Bailian CLI ✅ 强烈推荐

**实现方式**:
```javascript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function getBailianTokenPlanUsage(region = 'cn-beijing') {
  const site = region === 'cn-beijing' ? 'domestic' : 'international';
  
  try {
    const { stdout } = await execFileAsync('bl', [
      'usage',
      'token-plan',
      '--console-region', region,
      '--console-site', site,
      '--output', 'json'
    ]);
    
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Bailian CLI not found. Install it first: pip install bailian-cli');
    }
    throw error;
  }
}

// 使用示例
const usage = await getBailianTokenPlanUsage();
console.log(`Remaining: ${usage.remainingQuota}`);
```

**优点**:
- ✅ 零签名复杂度
- ✅ 官方维护，接口变更自动适配
- ✅ 代码简洁，易于维护
- ✅ 支持 Team 版和个人版

**缺点**:
- ⚠️ 需要安装 Bailian CLI
- ⚠️ 依赖子进程调用

**适用场景**: 
- DSH 插件、桌面应用、本地工具
- 对性能要求不极致的场景

**推荐指数**: ⭐⭐⭐⭐⭐

---

### 3.4 方案 D：复用 CodexBar 的逻辑 ⚠️ 中等推荐

**实现方式**:
将 CodexBar 的 Swift 实现移植到 Node.js，核心逻辑包括：
1. Cookie 读取（从浏览器数据库或手动输入）
2. sec_token 提取（正则匹配 HTML）
3. HTTP 请求构造（带 CSRF、Origin、Referer）
4. 响应解析（递归查找 `DataV2.data.data`）

**代码量预估**: 200-300 行

**优点**:
- ✅ 经过验证的实现
- ✅ 无需安装 CLI
- ✅ 纯 Node.js，无外部依赖

**缺点**:
- ⚠️ 需要处理浏览器 Cookie 读取（平台差异大）
- ⚠️ 接口变更时需要手动更新
- ⚠️ 代码复杂度高

**适用场景**:
- 需要零依赖的场景
- 已经有浏览器自动化能力的场景（如 Puppeteer）

**推荐指数**: ⭐⭐⭐

---

## 四、推荐接入方案

### 4.1 最佳实践（DSH 插件场景）

**方案**: **Bailian CLI + 降级策略**

```javascript
// 伪代码
async function getAliyunBailianQuota() {
  // 1. 优先尝试 Bailian CLI
  try {
    const cliResult = await execBlCli();
    if (cliResult.success) return parseCliOutput(cliResult);
  } catch (e) {
    log.warn('CLI failed, falling back to cookie method');
  }
  
  // 2. 降级：尝试读取浏览器 Cookie
  try {
    const cookies = await readBrowserCookies();
    if (cookies) return fetchWithCookies(cookies);
  } catch (e) {
    log.warn('Cookie method failed');
  }
  
  // 3. 最后降级：提示用户手动配置
  return {
    error: 'Please install Bailian CLI or configure browser cookies',
    setupGuide: 'https://...'
  };
}
```

**理由**:
1. **CLI 优先**: 最稳定，官方维护
2. **Cookie 降级**: 覆盖未安装 CLI 的用户
3. **优雅降级**: 失败时给出明确的引导

---

### 4.2 技术选型对比表

| 方案 | 复杂度 | 稳定性 | 维护成本 | 推荐度 |
|------|--------|--------|----------|--------|
| Bailian CLI | ⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| CodexBar 移植 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 纯 fetch 手写 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ |
| 官方 BSS SDK | ⭐⭐ | ⭐ | ⭐⭐ | ❌ |

---

## 五、常见问题 FAQ

### Q1: 为什么不能用 API Key 查额度？

**A**: API Key 的设计目标是**最小权限原则**，只授予模型推理权限。额度查询涉及账户级别的敏感信息，需要更强的身份认证（登录态 Cookie 或 CLI 登录）。

### Q2: Team 版和个人版的接口能混用吗？

**A**: **不能**。Team 版走 BSS OpenAPI，个人版走内部网关。混用会导致 403 错误或空数据。需要根据用户的订阅类型动态选择 endpoint。

### Q3: sec_token 必须提取吗？

**A**: **部分账户必须**。CodexBar 的实测表明，某些账户没有 `sec_token` 会报 `BailianGateway.Workspace.NotAuthorised`。建议始终尝试提取，失败后再重试不带 sec_token 的请求。

### Q4: 个人版的用量为什么是百分比而不是绝对值？

**A**: 百炼个人版采用**滚动窗口**设计（5 小时 + 7 天），用量是相对于套餐上限的比例。需要结合 `quota-config` 接口获取各套餐的绝对额度，才能计算出实际用量。

### Q5: 接口会变吗？如何保证长期稳定？

**A**: 
- **Team 版**: 基于 BSS OpenAPI，相对稳定
- **个人版**: 内部网关，可能变更
- **最佳策略**: 使用 Bailian CLI，由阿里云官方维护适配

---

## 六、参考资源

### 官方文档
- [如何获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- [Token Plan 个人版概述](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)
- [Token Plan 团队版概述](https://help.aliyun.com/zh/model-studio/token-plan-team-overview)
- [模型用量统计](https://help.aliyun.com/zh/model-studio/model-usage-statistics)
- [BSS OpenAPI GetSubscriptionSummary](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)

### 开源实现
- [CodexBar - Alibaba Token Plan Provider](https://github.com/steipete/CodexBar/tree/main/Sources/CodexBarCore/Providers/Alibaba)
- [CodexBar 文档](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)
- [coding-plan-usage](https://github.com/aneryu/coding-plan-usage)
- [coding-plan-monitor](https://github.com/JinHanAI/coding-plan-monitor)

### 社区讨论
- [阿里云百炼 Coding Plan 额度查看方法](https://developer.aliyun.com/ask/699053)
- [MiniMax /coding_plan/remains API 讨论](https://github.com/openclaw/openclaw/issues/63056)（注意：这是 MiniMax，不是阿里云）

---

## 七、总结

1. **百炼 Token Plan 没有公开的额度查询 API**，只能通过模拟浏览器请求或调用 CLI 实现
2. **API Key 不能查额度**，必须使用 Cookie 或 CLI
3. **AccessKey 不适用于百炼内部接口**，不要用 BSS SDK
4. **Team 版和个人版的接口完全不同**，需要分别处理
5. **推荐方案**: Bailian CLI + Cookie 降级，兼顾稳定性和覆盖率
6. **不推荐**: 纯 fetch 手写签名，复杂度太高且易失效

**最终建议**: 对于 DSH 插件这类桌面应用场景，直接使用 Bailian CLI 是最稳妥的选择。如果用户未安装 CLI，则引导其安装或提供手动配置 Cookie 的选项。

---

**报告完成时间**: 2025-12  
**下次更新触发条件**: 百炼官方发布新的额度查询 API 或 CodexBar 重大版本更新
