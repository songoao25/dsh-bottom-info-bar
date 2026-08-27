# 智谱（BigModel / GLM）余额与 Coding Plan 订阅额度查询接口规格调研

**调研日期**: 2026-01  
**调研目标**: 彻底钉死智谱 BigModel / GLM 的余额与 Coding Plan 订阅额度查询接口的精确规格  
**可信度标识**: 
- 🟢 **官方** - 来自 docs.bigmodel.cn / docs.z.ai 官方文档
- 🔵 **社区逆向** - 来自 GitHub 开源项目实现，经过多个项目交叉验证
- 🟡 **待核实** - 信息来源有限或存在冲突

---

## 一、核心结论摘要

### 1.1 最关键的发现

**智谱没有传统意义上的"余额查询 API"**（如 OpenAI 那种 `GET /v1/billing/usage` 返回货币金额）。

智谱采用的是 **Coding Plan 订阅制**，通过以下接口查询额度使用情况：

```
GET {host}/api/monitor/usage/quota/limit
```

该接口返回的是：
- 订阅等级（Lite / Standard / Pro / Max）
- Token 使用百分比（5 小时窗口、周窗口等）
- MCP 工具调用次数限制
- 下次重置时间戳

---

## 二、智谱 BigModel 余额查询接口

### 2.1 是否存在官方余额查询 API？

**结论**: ❌ **不存在**传统意义的余额查询 API。

智谱采用的是 **Coding Plan 订阅制**（类似 Netflix 套餐），而非预充值余额制。用户购买 Lite / Standard / Pro / Max 等不同等级的套餐，每个套餐有固定的 Token 配额和时间窗口。

🟡 **待核实**: 是否有针对企业版或特殊账户的预充值余额系统，但目前公开文档和社区项目中均未发现相关 API。

### 2.2 官方或社区的额度查询接口

#### 接口规格

**接口 URL**（根据地区不同有两个端点）:

| 地区 | Host | 完整 URL |
|------|------|----------|
| 中国大陆 | `open.bigmodel.cn` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` |
| 国际版 | `api.z.ai` | `https://api.z.ai/api/monitor/usage/quota/limit` |

🔵 **来源**: [CodexBar PR #3109](https://github.com/steipete/CodexBar/pull/3109), [zai-quota](https://github.com/SeeYangZhi/zai-quota/blob/main/zai_quota.py), [harness-kit](https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py)

**请求方法**: `GET`

**认证方式**: 

⚠️ **重要差异**: 不同端点的认证方式不同！

| 端点 | Header 格式 | 示例 |
|------|------------|------|
| `open.bigmodel.cn` | `Authorization: {API_KEY}` (无 Bearer 前缀) | `Authorization: sk-abc123...` |
| `api.z.ai` | `Authorization: Bearer {API_KEY}` (有 Bearer 前缀) | `Authorization: Bearer sk-abc123...` |

🔵 **来源**: [harness-kit GLM provider](https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py#L87-L92), [glm_quota.py](https://raw.githubusercontent.com/Microck/hermes-nightshift-glm/main/glm_quota.py#L23)

**其他请求头**:
```
Accept: application/json
Content-Type: application/json
```

**团队模式额外头**（仅当查询团队用量时）:
```
Bigmodel-Organization: <org_id>
Bigmodel-Project: <project_id>
```

🔵 **来源**: [CodexBar zai.md](https://github.com/steipete/CodexBar/blob/main/docs/zai.md)

**请求参数**: 无需任何查询参数

### 2.3 响应字段结构与样例

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

🔵 **来源**: [quota-bar platform-api-reference.md](https://github.com/nmsn/quota-bar/blob/main/docs/platform-api-reference.md), [zai-quota.py](https://raw.githubusercontent.com/SeeYangZhi/zai-quota/main/zai_quota.py#L145-L175)

#### 关键字段说明

| 字段路径 | 类型 | 说明 |
|---------|------|------|
| `data.level` | string | 订阅等级: `lite`, `standard`, `pro`, `max` |
| `data.planName` | string | 套餐名称（可选，某些版本可能缺失） |
| `data.limits[]` | array | 配额限制列表 |
| `limits[].type` | string | 限制类型: `TOKENS_LIMIT`（Token 配额）, `TIME_LIMIT`（MCP 工具调用次数）, `CREDIT_LIMIT`（待核实） |
| `limits[].unit` | number | 时间窗口单位编码: `3` = 5 小时, 其他值表示不同窗口 |
| `limits[].percentage` | number | 使用百分比（0-100），表示已用配额比例 |
| `limits[].nextResetTime` | number | 下次重置时间戳（毫秒级 Unix 时间戳） |
| `limits[].usageDetails[]` | array | 按模型细分的使用详情 |
| `usageDetails[].modelCode` | string | 模型代码（如 `GLM-5`, `GLM-4.5`） |
| `usageDetails[].usage` | number | 该模型的 Token 使用量 |
| `limits[].currentValue` | number | TIME_LIMIT 类型的当前已用次数 |
| `limits[].remaining` | number | TIME_LIMIT 类型的剩余次数 |
| `limits[].usage` | number | TIME_LIMIT 类型的总配额 |

🟡 **待核实**: `CREDIT_LIMIT` 类型的存在和意义（见 [CodexBar issue #2724](https://github.com/steipete/CodexBar/issues/2724)）

#### 脱敏响应样例

基于多个开源项目的实现，典型的成功响应如下：

```json
{
  "code": 200,
  "success": true,
  "data": {
    "level": "pro",
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "percentage": 44.5,
        "nextResetTime": 1742832000000,
        "usageDetails": [
          {"modelCode": "GLM-5", "usage": 123456},
          {"modelCode": "GLM-4.5", "usage": 78901}
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

### 2.4 官方或社区文档链接

- 🟢 **官方文档**（套餐概览）: https://docs.bigmodel.cn/cn/coding-plan/overview
- 🟢 **官方文档**（使用须知）: https://docs.bigmodel.cn/cn/coding-plan/usage-notes
- 🟢 **官方文档**（常见问题）: https://docs.bigmodel.cn/cn/coding-plan/faq
- 🔵 **社区文档**（CodexBar）: https://github.com/steipete/CodexBar/blob/main/docs/zai.md
- 🔵 **社区文档**（OpenUsage）: https://openusage.sh/docs/providers/zai/
- 🔵 **社区实现**（zai-quota）: https://github.com/SeeYangZhi/zai-quota
- 🔵 **社区实现**（glm-quota-monitor）: https://github.com/ChenMengfang/glm-quota-monitor
- 🔵 **社区实现**（harness-kit）: https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py

### 2.5 稳定性评估

**稳定性**: 🟢 **高**

理由：
1. 该接口被多个成熟的开源项目广泛使用（CodexBar、zai-quota、opencode-glm-quota、harness-kit 等）
2. 接口路径和响应结构在多个项目中保持一致
3. 智谱官方 SDK 仓库中虽未明确文档化此接口，但社区实现已通过实际使用验证
4. 该接口用于 Web 端用量仪表盘的后端，属于核心功能

⚠️ **注意**: 
- 该接口未在官方 API 文档中明确列出，属于"未正式文档化但稳定可用"的内部 API
- 响应字段可能随版本变化（如 `planName` 字段在某些版本中缺失，需用 `level` 字段替代）
- 建议实现时做好容错处理（字段缺失检查）

---

## 三、GLM Coding Plan（订阅额度）查询

### 3.1 是否有可查询已用/剩余 token 的接口？

**结论**: ✅ **有**，但不是直接返回"剩余 Token 数量"，而是返回**使用百分比**。

接口：`GET {host}/api/monitor/usage/quota/limit`

关键特点：
- 返回的是 `percentage`（0-100），表示已用配额的比例
- 不直接返回剩余的绝对 Token 数量
- 需要结合套餐等级推断总配额（但官方未公开各等级的具体 Token 上限）

🔵 **来源**: [zai-quota.py](https://raw.githubusercontent.com/SeeYangZhi/zai-quota/main/zai_quota.py#L145-L175), [harness-kit](https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py#L160-L175)

### 3.2 Web 端用量查询界面背后的接口

#### Web 端用量仪表盘 URL

| 类型 | URL |
|------|-----|
| 国际版个人用量 | https://z.ai/manage-apikey/coding-plan/personal/my-plan |
| 中国大陆个人用量 | https://bigmodel.cn/coding-plan/personal/usage |
| 中国大陆团队用量 | https://bigmodel.cn/coding-plan/team/usage-stats |

🔵 **来源**: [CodexBar zai.md](https://github.com/steipete/CodexBar/blob/main/docs/zai.md)

#### Web 端背后调用的 API

Web 端用量仪表盘调用的正是上述的 `/api/monitor/usage/quota/limit` 接口。

此外，还有两个辅助接口用于更详细的用量统计：

1. **模型用量统计**（24 小时窗口）:
   ```
   GET {host}/api/monitor/usage/model-usage?startTime={start}&endTime={end}
   ```
   
   响应包含：
   - `x_time`: 时间点数组
   - `modelCallCount`: 各模型调用次数
   - `tokensUsage`: 各模型 Token 使用量
   - `totalUsage.totalModelCallCount`: 总调用次数
   - `totalUsage.totalTokensUsage`: 总 Token 使用量

2. **MCP 工具用量统计**（24 小时窗口）:
   ```
   GET {host}/api/monitor/usage/tool-usage?startTime={start}&endTime={end}
   ```
   
   响应包含：
   - `networkSearchCount`: 网络搜索调用次数
   - `webReadMcpCount`: Web 读取 MCP 调用次数
   - `zreadMcpCount`: ZRead MCP 调用次数

🔵 **来源**: [glm_quota.py](https://raw.githubusercontent.com/Microck/hermes-nightshift-glm/main/glm_quota.py#L110-L145), [harness-kit](https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py#L130-L150)

### 3.3 Web 端需要什么认证？

**Web 端用量仪表盘**: 
- 🟡 **待核实**: Web 端使用浏览器 Cookie / Session Token 进行认证（用户需登录智谱账号）
- 无法通过 API Key 直接访问 Web 端页面

**API 接口**（`/api/monitor/usage/quota/limit` 等）:
- 仅需 API Key（通过 `Authorization` header）
- 不需要 Cookie 或 Session Token
- API Key 可从智谱控制台获取：https://bigmodel.cn/usercenter/proj-mgmt/apikeys

🔵 **来源**: [CodexBar zai.md](https://github.com/steipete/CodexBar/blob/main/docs/zai.md), [glm_quota.py](https://raw.githubusercontent.com/Microck/hermes-nightshift-glm/main/glm_quota.py#L23)

### 3.4 Web 端响应结构

与 API 接口响应结构相同（见 2.3 节）。

---

## 四、z.ai 与 open.bigmodel.cn 的关系

### 4.1 两者的余额接口是否同一个？

**结论**: ✅ **是同一个后端**，只是不同地区的接入点。

| 特性 | `api.z.ai` | `open.bigmodel.cn` |
|------|-----------|-------------------|
| 地区 | 国际版 | 中国大陆 |
| 所属公司 | Z.AI（智谱 AI 国际品牌） | 智谱 AI（中国本土品牌） |
| 接口路径 | `/api/monitor/usage/quota/limit` | `/api/monitor/usage/quota/limit` |
| 认证方式 | `Authorization: Bearer {API_KEY}` | `Authorization: {API_KEY}`（无 Bearer） |
| 响应结构 | 相同 | 相同 |
| 套餐等级 | Lite / Standard / Pro / Max | Lite / Standard / Pro / Max |

🔵 **来源**: [zai-quota.py](https://raw.githubusercontent.com/SeeYangZhi/zai-quota/main/zai_quota.py#L25-L29), [CodexBar zai.md](https://github.com/steipete/CodexBar/blob/main/docs/zai.md), [harness-kit](https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py#L45-L52)

### 4.2 域名差异的原因

**原因**: 
1. **合规与地域隔离**: 中国大陆用户需使用 `open.bigmodel.cn`（符合国内数据合规要求），国际用户使用 `api.z.ai`
2. **品牌策略**: `z.ai` 是智谱 AI 的国际品牌，`bigmodel.cn` 是中国本土品牌
3. **技术架构**: 两者共享相同的后端服务和 API 设计，只是接入点不同

🟢 **官方说明**: https://docs.bigmodel.cn/cn/coding-plan/overview

### 4.3 如何选择使用哪个端点？

- **中国大陆用户**: 使用 `open.bigmodel.cn`（速度更快，符合合规要求）
- **国际用户**: 使用 `api.z.ai`
- **API Key 通用性**: 同一 API Key 可在两个端点使用，但建议根据所在地区选择对应端点

🔵 **来源**: [CodexBar zai.md](https://github.com/steipete/CodexBar/blob/main/docs/zai.md)

---

## 五、综合结论

### 5.1 对「只持有 DSH credentials 里 API Key」的普通用户，最可行的接入方式

#### 推荐方案

**使用 `/api/monitor/usage/quota/limit` 接口查询 Coding Plan 订阅额度**

**实现步骤**:

1. **从 DSH credentials 中提取 API Key**
   - 假设 API Key 存储在某个配置文件中（如 `~/.config/dsh/credentials.json` 或环境变量）

2. **确定使用的端点**
   - 默认使用 `open.bigmodel.cn`（中国大陆用户）
   - 可通过配置项切换为 `api.z.ai`（国际用户）

3. **发起 HTTP 请求**
   ```python
   import requests
   
   API_KEY = "sk-xxx"  # 从 DSH credentials 读取
   HOST = "https://open.bigmodel.cn"  # 或 "https://api.z.ai"
   
   headers = {
       "Authorization": f"{API_KEY}",  # open.bigmodel.cn 不需要 Bearer 前缀
       "Accept": "application/json"
   }
   
   response = requests.get(
       f"{HOST}/api/monitor/usage/quota/limit",
       headers=headers,
       timeout=10
   )
   
   data = response.json()
   ```

4. **解析响应**
   ```python
   quota_data = data.get("data", {})
   level = quota_data.get("level", "unknown")  # lite/standard/pro/max
   limits = quota_data.get("limits", [])
   
   # 找到 TOKENS_LIMIT 类型的配额（优先 unit=3 的 5 小时窗口）
   tokens_limits = [l for l in limits if l.get("type") == "TOKENS_LIMIT"]
   five_hour_limits = [l for l in tokens_limits if l.get("unit") == 3]
   
   primary_limit = five_hour_limits[0] if five_hour_limits else (
       max(tokens_limits, key=lambda x: x.get("percentage", 0)) if tokens_limits else None
   )
   
   if primary_limit:
       usage_pct = primary_limit.get("percentage")  # 已用百分比（0-100）
       reset_timestamp = primary_limit.get("nextResetTime")  # 下次重置时间戳（毫秒）
       
       # 计算剩余百分比
       remaining_pct = 100 - usage_pct if usage_pct is not None else None
       
       print(f"套餐等级: {level}")
       print(f"已用配额: {usage_pct}%")
       print(f"剩余配额: {remaining_pct}%")
       print(f"下次重置: {reset_timestamp}")
   ```

5. **错误处理**
   - HTTP 401: API Key 无效或过期
   - HTTP 404: 接口不可用（可能是端点选择错误）
   - 响应中 `success: false`: API 返回错误

#### 注意事项

⚠️ **关键差异**: 
- `open.bigmodel.cn` 的 `Authorization` header **不需要** `Bearer` 前缀
- `api.z.ai` 的 `Authorization` header **需要** `Bearer` 前缀

建议在代码中根据选择的端点动态调整认证方式。

### 5.2 风险等级

| 风险类型 | 等级 | 说明 |
|---------|------|------|
| **接口稳定性风险** | 🟢 低 | 该接口被多个成熟项目广泛使用，稳定性高 |
| **API 变更风险** | 🟡 中 | 该接口未在官方文档中明确列出，未来可能变更（但概率较低，因为是 Web 端核心功能） |
| **认证安全风险** | 🟢 低 | 仅需 API Key，不涉及敏感凭证；API Key 应妥善保管 |
| **合规风险** | 🟢 低 | 使用官方提供的 API Key，符合智谱使用条款 |
| **数据准确性风险** | 🟡 中 | 返回的是百分比而非绝对数值，无法得知具体剩余 Token 数量 |

**总体风险等级**: 🟡 **中低**

主要风险点：
1. 接口未正式文档化，存在未来变更的可能性
2. 只能获取使用百分比，无法获取绝对剩余 Token 数量
3. 需要正确区分 `open.bigmodel.cn` 和 `api.z.ai` 的认证方式差异

---

## 六、推荐接入方案

### 6.1 方案概述

对于 DSH Bottom Info Bar 插件，建议采用以下方案接入智谱 GLM Coding Plan 额度查询：

**核心思路**: 
- 使用 `/api/monitor/usage/quota/limit` 接口查询订阅额度
- 显示套餐等级、已用百分比、剩余百分比、下次重置时间
- 支持 `open.bigmodel.cn`（中国大陆）和 `api.z.ai`（国际）两个端点
- 自动检测端点并适配认证方式

### 6.2 技术实现要点

#### 1. 端点配置

提供配置项让用户选择端点：
```json
{
  "glm_endpoint": "cn",  // "cn" 或 "intl"
}
```

映射关系：
- `"cn"` → `https://open.bigmodel.cn`
- `"intl"` → `https://api.z.ai`

#### 2. 认证方式适配

```typescript
const getAuthHeader = (endpoint: string, apiKey: string): string => {
  if (endpoint.includes('open.bigmodel.cn') || endpoint.includes('bigmodel.cn')) {
    return apiKey;  // 无 Bearer 前缀
  } else {
    return `Bearer ${apiKey}`;  // 需要 Bearer 前缀
  }
};
```

#### 3. 数据解析逻辑

```typescript
interface GLMQuotaResponse {
  code: number;
  success: boolean;
  data: {
    level: string;  // "lite" | "standard" | "pro" | "max"
    limits: Array<{
      type: string;  // "TOKENS_LIMIT" | "TIME_LIMIT"
      unit?: number;  // 3 = 5 小时窗口
      percentage?: number;  // 0-100
      nextResetTime?: number;  // 毫秒时间戳
      currentValue?: number;
      remaining?: number;
      usage?: number;
      usageDetails?: Array<{
        modelCode: string;
        usage: number;
      }>;
    }>;
  };
}

function parseGLMQuota(response: GLMQuotaResponse): GLMQuotaInfo {
  const data = response.data;
  const level = data.level;
  
  // 优先找 TOKENS_LIMIT 且 unit=3（5 小时窗口）
  const tokensLimits = data.limits.filter(l => l.type === 'TOKENS_LIMIT');
  const fiveHourLimits = tokensLimits.filter(l => l.unit === 3);
  const primaryLimit = fiveHourLimits.length > 0 
    ? fiveHourLimits[0] 
    : tokensLimits.sort((a, b) => (b.percentage || 0) - (a.percentage || 0))[0];
  
  if (!primaryLimit) {
    return { level, error: 'No TOKENS_LIMIT found' };
  }
  
  const usagePct = primaryLimit.percentage;
  const remainingPct = usagePct !== undefined ? 100 - usagePct : undefined;
  const resetTimestamp = primaryLimit.nextResetTime;
  
  return {
    level,
    usagePct,
    remainingPct,
    resetTimestamp,
    details: primaryLimit.usageDetails || []
  };
}
```

#### 4. 显示内容建议

在 Bottom Info Bar 中显示：
```
GLM Pro | 已用 44% | 剩余 56% | 重置于 3h22m
```

或更简洁：
```
GLM Pro 44% | ↻ 3h
```

### 6.3 与其他服务商的差异处理

智谱 GLM 与其他服务商（如 DeepSeek、OpenAI）的关键差异：

| 特性 | 智谱 GLM | DeepSeek / OpenAI |
|------|---------|------------------|
| 计费模式 | 订阅制（Coding Plan） | 余额制（预充值） |
| 查询接口 | `/api/monitor/usage/quota/limit` | `/v1/billing/usage` 或类似 |
| 返回数据 | 使用百分比（0-100） | 货币金额（USD / CNY） |
| 时间窗口 | 5 小时 / 周 / 月 | 按月结算 |
| 认证方式 | 因端点而异（有无 Bearer） | 统一 `Bearer {API_KEY}` |

在插件中需要针对不同服务商做差异化处理。

### 6.4 测试建议

1. **单元测试**: 模拟不同响应结构（有/无 `planName`、不同 `unit` 值等）
2. **集成测试**: 使用真实 API Key 测试两个端点
3. **错误处理测试**: 测试 401、404、超时等情况
4. **兼容性测试**: 测试不同套餐等级（Lite / Standard / Pro / Max）

### 6.5 后续优化方向

1. **缓存机制**: 避免频繁调用 API（建议缓存 5-10 分钟）
2. **多账户支持**: 支持多个 API Key 切换
3. **详细用量统计**: 可选展示各模型的使用详情
4. **告警功能**: 当使用百分比超过阈值时提醒用户

---

## 七、参考资料清单

### 官方资源
1. 🟢 智谱 AI 开放文档 - 套餐概览: https://docs.bigmodel.cn/cn/coding-plan/overview
2. 🟢 智谱 AI 开放文档 - 使用须知: https://docs.bigmodel.cn/cn/coding-plan/usage-notes
3. 🟢 智谱 AI 开放文档 - 常见问题: https://docs.bigmodel.cn/cn/coding-plan/faq
4. 🟢 Z.AI Developer Document: https://docs.z.ai/api-reference/introduction

### 社区实现
5. 🔵 CodexBar - z.ai Provider: https://github.com/steipete/CodexBar/blob/main/docs/zai.md
6. 🔵 CodexBar PR #3109 - Add BigModel CN account balance: https://github.com/steipete/CodexBar/pull/3109
7. 🔵 zai-quota (Python): https://github.com/SeeYangZhi/zai-quota
8. 🔵 glm-quota-monitor: https://github.com/ChenMengfang/glm-quota-monitor
9. 🔵 harness-kit GLM Provider: https://github.com/deepklarity/harness-kit/blob/main/harness_usage_status/src/harness_usage_status/providers/glm.py
10. 🔵 opencode-glm-quota: https://github.com/guyinwonder168/opencode-glm-quota
11. 🔵 quota-bar Platform API Reference: https://github.com/nmsn/quota-bar/blob/main/docs/platform-api-reference.md
12. 🔵 OpenUsage Z.AI Provider: https://openusage.sh/docs/providers/zai/

### GitHub Issues
13. 🟡 Z.AI SDK Python Issue #71 - Feature request for billing API: https://github.com/zai-org/z-ai-sdk-python/issues/71
14. 🟡 CodexBar Issue #2724 - CREDIT_LIMIT handling: https://github.com/steipete/CodexBar/issues/2724

---

**调研完成时间**: 2026-01  
**调研工程师**: AI Agent (委托执行)  
**审核状态**: 待主 Agent 验收
