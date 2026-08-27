# AI 服务商额度查询接口精确规格（可写代码版）

**生成日期**: 2025-08-27  
**用途**: DSH Bottom Info Bar 插件多平台支持的技术依据  
**可信度标识**: 
- 🟢 **官方** - 来自官方文档或 SDK
- 🔵 **社区逆向** - 来自 GitHub 开源项目实现，经多项目交叉验证
- 🟡 **待核实** - 信息来源有限或存在冲突

---

## 📊 总览对比表

| 平台 | 计费模式 | 查询方式 | 认证要求 | 稳定性 | 推荐接入等级 |
|------|---------|---------|---------|--------|-------------|
| **智谱 BigModel** | 订阅制（Coding Plan） | API 接口 | API Key | 🟢 高 | ✅ 优先 |
| **阿里云百炼** | 订阅制（Token Plan） | CLI / Cookie | 浏览器登录态 | 🟡 中 | ⚠️ 次优 |

---

## 一、智谱 BigModel / GLM

### 1.1 核心结论

**✅ 有稳定可用的额度查询接口**

- **接口路径**: `GET /api/monitor/usage/quota/limit`
- **返回数据**: 使用百分比（0-100），不是绝对 Token 数量
- **认证方式**: API Key（根据端点不同，有无 Bearer 前缀的差异）
- **稳定性**: 🟢 高（多个成熟开源项目验证）

### 1.2 接口规格

#### 端点选择

| 地区 | Host | 完整 URL |
|------|------|----------|
| 中国大陆 | `open.bigmodel.cn` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` |
| 国际版 | `api.z.ai` | `https://api.z.ai/api/monitor/usage/quota/limit` |

🔵 **来源**: [CodexBar PR #3109](https://github.com/steipete/CodexBar/pull/3109), [zai-quota](https://github.com/SeeYangZhi/zai-quota), [harness-kit](https://github.com/deepklarity/harness-kit)

#### 请求规范

**方法**: `GET`

**Headers**:

⚠️ **关键差异** - 不同端点的认证格式不同：

| 端点 | Authorization Header | 示例 |
|------|---------------------|------|
| `open.bigmodel.cn` | `{API_KEY}`（无 Bearer） | `Authorization: sk-abc123...` |
| `api.z.ai` | `Bearer {API_KEY}`（有 Bearer） | `Authorization: Bearer sk-abc123...` |

其他 Headers:
```
Accept: application/json
Content-Type: application/json
```

**团队模式额外 Headers**（可选）:
```
Bigmodel-Organization: <org_id>
Bigmodel-Project: <project_id>
```

**请求参数**: 无需任何 query 参数或 body

#### 响应结构

```json
{
  "code": 200,
  "success": true,
  "data": {
    "level": "pro",
    "planName": "Pro",
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "percentage": 44.5,
        "nextResetTime": 1742832000000,
        "usageDetails": [
          {
            "modelCode": "GLM-5",
            "usage": 123456
          },
          {
            "modelCode": "GLM-4.5",
            "usage": 78901
          }
        ]
      },
      {
        "type": "TIME_LIMIT",
        "currentValue": 72,
        "remaining": 928,
        "usage": 1000,
        "percentage": 7.2,
        "nextResetTime": 1745424000000
      }
    ]
  }
}
```

🔵 **来源**: [quota-bar platform-api-reference.md](https://github.com/nmsn/quota-bar/blob/main/docs/platform-api-reference.md), [zai-quota.py](https://raw.githubusercontent.com/SeeYangZhi/zai-quota/main/zai_quota.py)

#### 关键字段说明

| 字段路径 | 类型 | 说明 |
|---------|------|------|
| `data.level` | string | 订阅等级: `"lite"`, `"standard"`, `"pro"`, `"max"` |
| `data.planName` | string | 套餐名称（可选，某些版本可能缺失） |
| `data.limits[]` | array | 配额限制列表 |
| `limits[].type` | string | 限制类型: `"TOKENS_LIMIT"`（Token 配额）, `"TIME_LIMIT"`（MCP 工具调用次数） |
| `limits[].unit` | number | 时间窗口单位编码: `3` = 5 小时窗口 |
| `limits[].percentage` | number | 使用百分比（0-100），表示已用配额比例 |
| `limits[].nextResetTime` | number | 下次重置时间戳（毫秒级 Unix 时间戳） |
| `limits[].usageDetails[]` | array | 按模型细分的使用详情 |
| `usageDetails[].modelCode` | string | 模型代码（如 `"GLM-5"`, `"GLM-4.5"`） |
| `usageDetails[].usage` | number | 该模型的 Token 使用量 |

### 1.3 Node.js 实现示例

```javascript
/**
 * 查询智谱 GLM Coding Plan 额度
 * @param {string} apiKey - 智谱 API Key
 * @param {string} region - 地区: 'cn' 或 'intl'
 * @returns {Promise<Object>} 额度信息
 */
async function getGLMQuota(apiKey, region = 'cn') {
  const host = region === 'cn' 
    ? 'https://open.bigmodel.cn' 
    : 'https://api.z.ai';
  
  // 根据端点决定是否需要 Bearer 前缀
  const authValue = region === 'cn' 
    ? apiKey 
    : `Bearer ${apiKey}`;
  
  const response = await fetch(`${host}/api/monitor/usage/quota/limit`, {
    method: 'GET',
    headers: {
      'Authorization': authValue,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`API error: ${JSON.stringify(data)}`);
  }
  
  const quotaData = data.data;
  const level = quotaData.level;
  
  // 优先找 TOKENS_LIMIT 且 unit=3（5 小时窗口）
  const tokensLimits = quotaData.limits.filter(l => l.type === 'TOKENS_LIMIT');
  const fiveHourLimits = tokensLimits.filter(l => l.unit === 3);
  const primaryLimit = fiveHourLimits.length > 0 
    ? fiveHourLimits[0] 
    : tokensLimits.sort((a, b) => (b.percentage || 0) - (a.percentage || 0))[0];
  
  if (!primaryLimit) {
    return {
      level,
      error: 'No TOKENS_LIMIT found'
    };
  }
  
  const usagePct = primaryLimit.percentage;
  const remainingPct = usagePct !== undefined ? 100 - usagePct : undefined;
  const resetTimestamp = primaryLimit.nextResetTime;
  
  return {
    level,
    planName: quotaData.planName,
    usagePct,           // 已用百分比（0-100）
    remainingPct,       // 剩余百分比（0-100）
    resetTimestamp,     // 下次重置时间戳（毫秒）
    details: primaryLimit.usageDetails || []
  };
}

// 使用示例
const quota = await getGLMQuota('sk-your-api-key', 'cn');
console.log(`GLM ${quota.level}: 已用 ${quota.usagePct}%, 剩余 ${quota.remainingPct}%`);
console.log(`下次重置: ${new Date(quota.resetTimestamp).toLocaleString()}`);
```

### 1.4 风险与注意事项

**风险等级**: 🟡 **中低**

| 风险类型 | 等级 | 说明 |
|---------|------|------|
| 接口稳定性 | 🟢 低 | 被多个成熟项目广泛使用，稳定性高 |
| API 变更 | 🟡 中 | 未在官方文档明确列出，但作为 Web 端核心功能，变更概率较低 |
| 认证安全 | 🟢 低 | 仅需 API Key，符合最小权限原则 |
| 数据准确性 | 🟡 中 | 返回百分比而非绝对数值，无法得知具体剩余 Token 数量 |

**注意事项**:
1. ⚠️ `open.bigmodel.cn` 和 `api.z.ai` 的认证方式不同，务必区分
2. ⚠️ `planName` 字段在某些版本中可能缺失，需用 `level` 字段替代
3. ⚠️ 建议缓存结果 5-10 分钟，避免频繁调用

### 1.5 显示建议

在 Bottom Info Bar 中显示：
```
GLM Pro | 已用 44% | 剩余 56% | 重置于 3h22m
```

或更简洁：
```
GLM Pro 44% | ↻ 3h
```

---

## 二、阿里云百炼 Model Studio

### 2.1 核心结论

**❌ 没有公开的额度查询 REST API**

- **API Key（sk-xxx）不能查额度**，仅用于模型推理
- **必须使用浏览器登录态（Cookie）或 Bailian CLI**
- **AccessKey（RAM AK/SK）不适用于百炼内部接口**
- **Team 版和个人版的接口完全不同**

### 2.2 两种实现路径

#### 路径 A：Bailian CLI（✅ 强烈推荐）

**命令**:
```bash
bl usage token-plan --console-region <region> --console-site <site> --output json
```

**参数**:
- `--console-region`: `cn-beijing`（中国）或 `ap-southeast-1`（国际）
- `--console-site`: `domestic`（中国）或 `international`（国际）
- `--output json`: 输出 JSON 格式

**前提条件**:
- 已安装 Bailian CLI: `pip install bailian-cli`
- 已通过 `bl login` 登录

**优点**:
- ✅ 零签名复杂度
- ✅ 官方维护，接口变更自动适配
- ✅ 代码简洁，易于维护

**缺点**:
- ⚠️ 需要安装 Python 环境和 CLI 工具
- ⚠️ 依赖子进程调用

**Node.js 调用示例**:
```javascript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function getBailianQuota(region = 'cn-beijing') {
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
      throw new Error('Bailian CLI not found. Install with: pip install bailian-cli');
    }
    throw error;
  }
}

// 使用示例
const quota = await getBailianQuota();
console.log(`总额度: ${quota.totalQuota}, 剩余: ${quota.remainingQuota}`);
```

#### 路径 B：浏览器 Cookie + HTTP 请求（⚠️ 中等推荐）

**适用场景**: 用户未安装 CLI，但有浏览器登录态

**工作原理**:
1. 读取浏览器 Cookie（包含登录会话）
2. 从 Dashboard HTML 提取 `sec_token`
3. 构造 HTTP 请求模拟浏览器行为
4. 解析嵌套的 JSON 响应

**复杂度**: 高（约 250 行代码，不含错误处理）

**关键难点**:
- Cookie 管理（平台差异大）
- CSRF 处理（需要 `x-xsrf-token` header）
- `sec_token` 提取（正则匹配 HTML）
- 重试逻辑（个人版接口间歇性返回空数据）
- JSON 嵌套解析（`DataV2.data.data` 结构）

**不推荐手写的原因**:
- ❌ 维护成本高（接口变更需手动更新）
- ❌ 平台差异大（Chrome/Edge/Safari 的 Cookie 存储方式不同）
- ❌ 易失效（百炼内部接口可能随时变更）

**完整实现参考**: 见 [`docs/ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md`](docs/ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md) 中的代码示例

### 2.3 Team 版 vs 个人版接口对比

| 特性 | Team 版 | 个人版 |
|------|---------|--------|
| **接口名** | `GetSubscriptionSummary` | 内部网关（3 个子接口） |
| **所属产品** | BSS OpenAPI V3 | 百炼内部网关 |
| **Endpoint** | `https://bailian.console.aliyun.com/data/api.json` | `https://bailian-cs.console.aliyun.com/data/api.json` |
| **ProductCode** | `sfm_tokenplanteams_dp_cn` | `sfm_bailian` |
| **返回数据** | 绝对数值（totalQuota, remainingQuota） | 百分比（per5HourPercentage）+ 配置上限 |
| **认证方式** | Cookie + sec_token | Cookie + sec_token + CSRF |

**重要**: 两者接口完全不同，不能混用。需要根据用户的订阅类型动态选择。

### 2.4 响应结构（Team 版示例）

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

### 2.5 风险与注意事项

**风险等级**: 🟡 **中**

| 风险类型 | 等级 | 说明 |
|---------|------|------|
| 接口稳定性 | 🟡 中 | Team 版基于 BSS OpenAPI 较稳定，个人版为内部网关可能变更 |
| 实现复杂度 | 🔴 高 | Cookie 方式需要处理大量细节，CLI 方式简单但需安装依赖 |
| 认证安全 | 🟡 中 | 需要浏览器登录态，存在 Cookie 泄露风险 |
| 跨平台兼容 | 🟡 中 | Cookie 读取在不同操作系统/浏览器上实现差异大 |

**注意事项**:
1. ❌ **不要用 API Key 查额度**，它只能用于模型推理
2. ❌ **不要用 AccessKey 签名**，百炼内部接口不使用 RAM 认证
3. ⚠️ Team 版和个人版的接口完全不同，需分别处理
4. ⚠️ 个人版用量是百分比，需结合 `quota-config` 获取绝对额度
5. ⚠️ 部分账户需要 `sec_token`，否则报 `BailianGateway.Workspace.NotAuthorised`

### 2.6 推荐接入策略

**最佳实践**: **Bailian CLI + Cookie 降级**

```javascript
async function getAliyunBailianQuota(options = {}) {
  const { region = 'cn-beijing' } = options;
  
  // 1. 优先尝试 Bailian CLI
  try {
    const cliResult = await getBailianQuota(region);
    if (cliResult && cliResult.totalQuota > 0) {
      return { type: 'cli', ...cliResult };
    }
  } catch (e) {
    console.warn('CLI failed, falling back to cookie method');
  }
  
  // 2. 降级：尝试读取浏览器 Cookie
  try {
    const cookies = await readBrowserCookies();
    if (cookies) {
      const cookieResult = await fetchWithCookies(cookies, region);
      return { type: 'cookie', ...cookieResult };
    }
  } catch (e) {
    console.warn('Cookie method failed');
  }
  
  // 3. 最后降级：提示用户手动配置
  return {
    error: 'Please install Bailian CLI or configure browser cookies',
    setupGuide: 'https://help.aliyun.com/zh/model-studio/get-api-key'
  };
}
```

### 2.7 显示建议

**Team 版**（绝对数值）:
```
百炼 Team | 已用 15K / 100K | 剩余 85K | 重置于 30天
```

**个人版**（百分比 + 套餐等级）:
```
百炼 Pro | 5h: 0.1% | 7d: 0.03% | 重置于 4h
```

---

## 三、技术选型建议

### 3.1 优先级排序

| 平台 | 优先级 | 理由 |
|------|--------|------|
| **智谱 BigModel** | ✅ P0（立即实现） | 接口稳定、认证简单、只需 API Key |
| **阿里云百炼** | ⚠️ P1（中期实现） | 需要 CLI 或 Cookie，复杂度较高 |

### 3.2 实现难度对比

| 维度 | 智谱 BigModel | 阿里云百炼 |
|------|--------------|-----------|
| 接口稳定性 | 🟢 高 | 🟡 中 |
| 认证复杂度 | 🟢 低（仅 API Key） | 🔴 高（CLI 或 Cookie） |
| 代码量 | ~50 行 | CLI: ~20 行 / Cookie: ~250 行 |
| 维护成本 | 🟢 低 | 🟡 中（CLI）/ 🔴 高（Cookie） |
| 用户体验 | 🟢 好（配置 API Key 即可） | 🟡 中（需安装 CLI 或登录浏览器） |

### 3.3 开发路线图

**Phase 1**（本周）:
- ✅ 实现智谱 BigModel 支持
- 测试两个端点（`open.bigmodel.cn` 和 `api.z.ai`）
- 添加单元测试和集成测试

**Phase 2**（下周）:
- ⚠️ 实现阿里云百炼 CLI 支持
- 提供安装引导（`pip install bailian-cli`）
- 添加优雅降级（CLI 失败时提示用户）

**Phase 3**（后续）:
- ⚠️ （可选）实现 Cookie 方式作为备选
- 需要处理跨平台 Cookie 读取
- 仅在用户需求强烈时考虑

---

## 四、附录：参考资源

### 智谱 BigModel
- 🟢 [官方文档 - 套餐概览](https://docs.bigmodel.cn/cn/coding-plan/overview)
- 🔵 [CodexBar PR #3109](https://github.com/steipete/CodexBar/pull/3109)
- 🔵 [zai-quota](https://github.com/SeeYangZhi/zai-quota)
- 🔵 [harness-kit GLM Provider](https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py)
- 📄 [详细调研报告](docs/GLM-BALANCE-API-RESEARCH.md)

### 阿里云百炼
- 🟢 [如何获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- 🟢 [Token Plan 团队版概述](https://help.aliyun.com/zh/model-studio/token-plan-team-overview)
- 🔵 [CodexBar Alibaba Provider](https://github.com/steipete/CodexBar/tree/main/Sources/CodexBarCore/Providers/Alibaba)
- 🔵 [CodexBar 文档](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)
- 📄 [详细调研报告](docs/ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md)

---

**报告完成时间**: 2025-08-27  
**调研工程师**: AI Agent（委托执行）  
**审核状态**: 待主 Agent 验收
