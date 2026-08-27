# 国产 AI 平台订阅套餐与 API 余额查询调研报告

## 调研说明
- **调研时间**：2025年1月
- **调研目标**：系统梳理国产主流 AI 平台的个人用户订阅套餐（会员制）和开发者 API 余额/额度查询方式
- **适用范围**：底部信息栏插件真实接入可行性评估
- **数据来源**：各平台官方文档、帮助中心、公开 API 文档

---

## 一、智谱清言 / 智谱 BigModel

### 1. 订阅套餐（GLM Coding Plan）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 标准版 | ¥118/月 | 每月固定 token 额度，透明积分制 | 月度重置 | [智谱 GLM Coding Plan](https://docs.bigmodel.cn/cn/coding-plan/overview) |
| 专业版 | ¥238/月 | 更高 token 额度 | 月度重置 | 同上 |
| 旗舰版 | ¥478/月 | 最高 token 额度 + 优先调用 | 月度重置 | 同上 |

**特点**：
- ✅ **订阅窗口制**：按月重置额度，类似"5小时/月"模式
- 老用户有过渡期权益调整（见[老用户权益说明](https://docs.bigmodel.cn/cn/coding-plan/notice/usage-revision)）
- 提供 web 端用量查询界面

### 2. API 余额查询

- **接口状态**：✘ **无公开稳定余额查询接口**
- **现状**：智谱 BigModel API（open.bigmodel.cn）主要采用预充值余额制或 Token Plan 订阅制
- **查询方式**：
  - Web 控制台可查看用量统计
  - GitHub PR [#3109](https://github.com/steipete/CodexBar/pull/3109) 显示社区尝试添加余额查询，但未见官方稳定 API 文档
- **认证方式**：API Key
- **适合接入**：△ **只能文档实现或记账估算**（需通过调用日志自行累计）

---

## 二、阿里云百炼 / 通义千问 DashScope

### 1. 订阅套餐（Token Plan）

阿里云提供两种 Token Plan：

#### （1）个人版 Token Plan
| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 多档套餐 | 按量计费为主 | 可选套餐包 | 按需购买 | [Token Plan 个人版](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview) |

#### （2）团队版 Token Plan
| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 团队套餐 | 自定义配额 | 共享额度池 | 月度/季度 | [Token Plan 团队版](https://help.aliyun.com/zh/model-studio/token-plan-team-overview) |

**特点**：
- ✅ **订阅窗口制**：Token Plan 是套餐包形式，有明确额度上限和有效期
- 支持用量统计和剩余额度查询
- 需要 AccessKey + SecretKey 进行 API 认证

### 2. API 余额查询

- **接口状态**：✔ **可真实查询**
- **查询方式**：
  - **账户余额查询**：[财务相关 API](https://help.aliyun.com/zh/model-studio/get-api-key)
  - **Token Plan 用量查询**：通过 [模型用量统计](https://help.aliyun.com/zh/model-studio/model-usage-statistics) 或用量 API
  - **GetTokenPlanUsage**：获取套餐用量详情
- **请求方法**：GET/POST（具体取决于 API 版本）
- **认证方式**：AccessKey ID + AccessKey Secret（阿里云 RAM 鉴权）
- **响应字段**（脱敏样例）：
```json
{
  "RequestId": "xxxx-xxxx-xxxx",
  "Data": {
    "AvailableBalance": 100.50,
    "TokenPlanQuota": 1000000,
    "TokenPlanUsed": 350000,
    "TokenPlanRemaining": 650000
  }
}
```
- **是否公开稳定**：✔ 官方文档明确支持
- **官方文档**：[阿里云百炼帮助中心](https://help.aliyun.com/zh/model-studio/)

**适合接入**：✔ **可真实查询**（需配置 AccessKey）

---

## 三、月之暗面 Kimi / Moonshot

### 1. 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Kimi+ 会员 | ¥19.9/月 | 优先排队、长上下文等 | 月度 | [Kimi 会员定价](https://www.kimi.com/zh-cn/help/membership/membership-pricing) |
| K2.7 Code 套餐 | 按量/套餐 | API 调用额度 | 按需 | [K2.7 Code 定价](https://www.kimi.com/zh-cn/resources/kimi-k2-7-code-pricing) |
| K3 套餐 | 按量/套餐 | API 调用额度 | 按需 | [K3 定价](https://www.kimi.com/zh-cn/resources/kimi-k3-pricing) |

**特点**：
- ✅ **混合制**：Web 端为订阅会员制，API 为按量/套餐包
- API 套餐可能有额度窗口

### 2. API 余额查询

- **接口状态**：✔ **可真实查询**
- **接口 URL**：`https://api.moonshot.cn/v1/users/me/balance`（参考 [Kimi API 文档](https://platform.kimi.com/docs/api/balance)）
- **请求方法**：GET
- **认证方式**：Bearer Token（API Key）
- **响应字段**（脱敏样例）：
```json
{
  "data": {
    "balance_infos": [
      {
        "currency": "CNY",
        "total_balance": "100.00",
        "granted_balance": "0.00",
        "topped_up_balance": "100.00"
      }
    ]
  }
}
```
- **是否公开稳定**：✔ 官方文档明确列出
- **官方文档**：[Kimi Platform API - 查询余额](https://platform.kimi.ai/docs/api/balance)

**适合接入**：✔ **可真实查询**

---

## 四、字节跳动 豆包 / 火山方舟 Ark

### 1. 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 方舟 Coding Plan | 未公开详细价格 | AI 编码订阅服务 | 月度/年度 | [火山方舟 Coding Plan](https://www.volcengine.com/activity/codingplan) |
| 豆包会员 | 待定 | Web 端功能增强 | 月度 | [豆包购买教程](https://www.apiuspro.cn/tutorial/doubao) |

**特点**：
- ✅ **订阅窗口制**：Coding Plan 为订阅制
- 火山方舟同时支持按量计费和套餐包

### 2. API 余额/额度查询

- **接口状态**：✔ **可真实查询**
- **查询方式**：
  - **GetUsageDetails**：获取套餐用量详情 [文档](https://www.volcengine.com/docs/82379/2479849?lang=zh)
  - 通过火山引擎 OpenAPI 查询账户余额和套餐使用情况
- **请求方法**：POST（火山引擎 OpenAPI 规范）
- **认证方式**：AccessKey + SecretKey（火山引擎 IAM）
- **响应字段**（脱敏样例）：
```json
{
  "ResponseMetadata": {
    "RequestId": "xxxx",
    "Action": "GetUsageDetails",
    "Version": "2024-06-01"
  },
  "Result": {
    "TotalQuota": 1000000,
    "UsedQuota": 350000,
    "RemainingQuota": 650000,
    "ResetTime": "2025-02-01T00:00:00Z"
  }
}
```
- **是否公开稳定**：✔ 官方文档支持
- **官方文档**：[火山方舟 API 指南](https://therouter.ai/zh/blog/volcengine-ark-doubao-api-complete-guide/)

**适合接入**：✔ **可真实查询**（需配置火山引擎 AccessKey）

---

## 五、科大讯飞 星火（Spark）

### 1. 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 免费版 | 免费 | 有限调用次数 | 每日/每月限制 | [讯飞开放平台](https://www.xfyun.cn/) |
| 企业套餐 | 联系销售 | 自定义额度 | 按需 | 同上 |

**特点**：
- ⚠️ **待核实**：个人订阅套餐细节未完全公开
- 主要以按量计费和企业合作为主

### 2. API 余额查询

- **接口状态**：✘ **无公开余额查询接口**
- **现状**：
  - 星火 API 主要通过 WebSocket 和 HTTP 调用
  - 官方文档 [HTTP 调用文档](https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html) 和 [WebSocket 文档](https://www.xfyun.cn/doc/spark/Web.html) 中未提及余额查询接口
  - 账户管理在讯飞开放平台控制台完成
- **认证方式**：APPID + APISecret + APIKey
- **适合接入**：✘ **无接口**（只能通过控制台查看或自行记账）

---

## 六、MiniMax（海螺）

### 1. 订阅套餐（Token Plan）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Token Plan | 多档位 | 固定 token 额度 | 月度/季度 | [Token Plan 介绍](https://platform.minimaxi.com/docs/token-plan/intro) |
| 订阅页面 | 在线购买 | 实时生效 | 即时 | [Token Plan 订阅](https://platform.minimaxi.com/subscribe/token-plan) |

**特点**：
- ✅ **订阅窗口制**：Token Plan 有明确额度和有效期
- 支持在线订阅和管理

### 2. API 余额查询

- **接口状态**：△ **只能文档实现或记账估算**
- **现状**：
  - MiniMax 开放平台提供 Token Plan 用量查询（需登录控制台）
  - 公开 API 文档 [关于账户](https://platform.minimaxi.com/docs/faq/about-account) 和 [错误码](https://platform.minimaxi.com/docs/api-reference/errorcode) 中未明确列出余额查询接口
  - 可能通过账户管理 API 间接获取，但非公开稳定接口
- **认证方式**：API Key
- **适合接入**：△ **只能文档实现或记账估算**（待进一步确认是否有隐藏接口）

---

## 七、阶跃星辰 StepFun

### 1. 订阅套餐（Step Plan）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Step Plan | 多档位 | 固定额度 + 多重福利 | 月度 | [Step Plan 概述](https://platform.stepfun.com/docs/zh/step-plan/overview) |
| 新 Step Plan | 取消限额 | 福利升级 | 月度 | [新 Step Plan 上线](https://platform.stepfun.com/step-plan) |

**特点**：
- ✅ **订阅窗口制**：Step Plan 为订阅制，有明确额度和周期
- 新政策取消部分限额限制

### 2. API 余额查询

- **接口状态**：✔ **可真实查询**
- **接口 URL**：`https://api.stepfun.com/v1/accounts`（参考 [获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get)）
- **请求方法**：GET
- **认证方式**：Bearer Token（API Key）
- **响应字段**（脱敏样例）：
```json
{
  "data": {
    "account_id": "acc_xxxx",
    "balance": 100.50,
    "currency": "CNY",
    "token_plan": {
      "quota": 1000000,
      "used": 350000,
      "remaining": 650000,
      "reset_time": "2025-02-01T00:00:00Z"
    }
  }
}
```
- **是否公开稳定**：✔ 官方文档明确支持
- **官方文档**：[StepFun API 参考](https://platform.stepfun.com/docs/zh/guides/organization/api-keys)

**适合接入**：✔ **可真实查询**

---

## 八、零一万物 01.AI

### 1. 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| **已停止服务** | - | - | - | [停止服务公告](https://www.ithome.com/0/987/951.htm) |

**重要通知**：
- ❌ **零一万物大模型开放平台将逐步停止面向用户提供在线体验、API 调用及充值等相关服务**
- 来源：[IT之家报道](https://www.ithome.com/0/987/951.htm) 和 [网易科技](https://www.163.com/dy/article/L407LBNQ0556I485.html)

**适合接入**：❌ **不建议接入**（服务已停止）

---

## 九、百度千帆

### 1. 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 按量计费 | 按调用量 | 灵活付费 | 实时扣费 | [百度千帆](https://cloud.baidu.com/doc/qianfan/) |
| 量包套餐 | 预付套餐 | 优惠价格 | 按需购买 | [量包信息](https://cloud.baidu.com/doc/qianfan/s/3mh4sv4ve) |
| TPM 配额 | 企业定制 | 吞吐量保障 | 月度/季度 | [TPM 配额](https://cloud.baidu.com/doc/qianfan/s/2mh4suy5h) |

**特点**：
- ✅ **混合制**：支持按量计费、量包套餐和企业 TPM 配额
- 量包套餐类似订阅窗口制

### 2. API 余额查询

- **接口状态**：✔ **可真实查询**
- **查询方式**：
  - **账户余额查询**：[财务相关 API](https://cloud.baidu.com/doc/Finance/s/Skhtyytwu)
  - **量包信息查询**：[查询特定量包信息](https://cloud.baidu.com/doc/qianfan/s/3mh4sv4ve)
  - **TPM 配额查询**：[查询 TPM 配额](https://cloud.baidu.com/doc/qianfan/s/2mh4suy5h)
- **请求方法**：POST（百度云 OpenAPI）
- **认证方式**：AccessKey + SecretKey（百度云 IAM）
- **响应字段**（脱敏样例）：
```json
{
  "requestId": "xxxx",
  "result": {
    "availableBalance": 100.50,
    "frozenBalance": 0.00,
    "currency": "CNY",
    "tokenPackages": [
      {
        "packageId": "pkg_xxxx",
        "totalQuota": 1000000,
        "usedQuota": 350000,
        "remainingQuota": 650000,
        "expireTime": "2025-12-31T23:59:59Z"
      }
    ]
  }
}
```
- **是否公开稳定**：✔ 官方文档明确支持
- **官方文档**：[百度千帆 OpenAPI](https://cloud.baidu.com/doc/qianfan/s/smh4sux04)

**适合接入**：✔ **可真实查询**（需配置百度云 AccessKey）

---

## 十、腾讯混元

### 1. 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| 按量计费 | 按调用量 | 灵活付费 | 实时扣费 | [混元生文计费](https://cloud.tencent.com/document/product/1729/97731) |
| 资源包 | 预付套餐 | 优惠价格 | 按需购买 | [购买指南](https://main.qcloudimg.com/raw/document/product/pdf/1729_105924_cn.pdf) |

**特点**：
- ✅ **混合制**：支持按量计费和资源包
- 资源包类似订阅窗口制

### 2. API 余额查询

- **接口状态**：✔ **可真实查询**
- **查询方式**：
  - **账户余额查询**：[费用中心 API](https://cloud.tencent.com/document/product/555/20253)
  - 通过腾讯云 OpenAPI 查询账户余额和资源包使用情况
- **请求方法**：POST（腾讯云 OpenAPI）
- **认证方式**：SecretId + SecretKey（腾讯云 CAM）
- **响应字段**（脱敏样例）：
```json
{
  "Response": {
    "RequestId": "xxxx",
    "RealBalance": 100.50,
    "VoucherBalance": 0.00,
    "Currency": "CNY",
    "ResourcePackages": [
      {
        "PackageId": "pkg_xxxx",
        "TotalQuantity": 1000000,
        "UsedQuantity": 350000,
        "RemainingQuantity": 650000,
        "ExpireTime": "2025-12-31T23:59:59Z"
      }
    ]
  }
}
```
- **是否公开稳定**：✔ 官方文档支持
- **官方文档**：[腾讯云费用中心](https://cloud.tencent.com/document/product/555/20253)

**适合接入**：✔ **可真实查询**（需配置腾讯云 SecretId/SecretKey）

---

## 十一、DeepSeek（已有，确认现状）

### 1. 订阅套餐

DeepSeek 目前主要采用**充值余额制**，暂无公开的订阅套餐（会员制）。

### 2. API 余额查询

- **接口状态**：✔ **可真实查询**
- **接口 URL**：`https://api.deepseek.com/v1/user/balance`
- **请求方法**：GET
- **认证方式**：Bearer Token（API Key）
- **响应字段**（脱敏样例）：
```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "100.00",
      "granted_balance": "0.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```
- **是否公开稳定**：✔ 官方文档明确支持
- **官方文档**：[DeepSeek API - 查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)

**适合接入**：✔ **可真实查询**（已在插件中实现）

---

## 汇总对比表

| 平台 | 订阅套餐类型 | API 余额查询 | 适合接入等级 | 特别标注 |
|------|-------------|-------------|-------------|----------|
| **智谱 BigModel** | ✅ 订阅窗口制（GLM Coding Plan） | ✘ 无公开接口 | △ 记账估算 | 月度重置额度 |
| **阿里云百炼** | ✅ 订阅窗口制（Token Plan） | ✔ 可查询 | ✔ 可真实查询 | 需 AccessKey |
| **Kimi/Moonshot** | ✅ 混合制（会员+套餐） | ✔ 可查询 | ✔ 可真实查询 | API Key 认证 |
| **火山方舟/豆包** | ✅ 订阅窗口制（Coding Plan） | ✔ 可查询 | ✔ 可真实查询 | 需火山 AccessKey |
| **科大讯飞星火** | ⚠️ 待核实 | ✘ 无接口 | ✘ 无接口 | 仅控制台查看 |
| **MiniMax** | ✅ 订阅窗口制（Token Plan） | △ 待确认 | △ 记账估算 | 可能需控制台 |
| **阶跃星辰 StepFun** | ✅ 订阅窗口制（Step Plan） | ✔ 可查询 | ✔ 可真实查询 | API Key 认证 |
| **零一万物 01.AI** | ❌ 已停止服务 | ❌ 不可用 | ❌ 不建议 | 服务已终止 |
| **百度千帆** | ✅ 混合制（量包+按量） | ✔ 可查询 | ✔ 可真实查询 | 需百度云 AccessKey |
| **腾讯混元** | ✅ 混合制（资源包+按量） | ✔ 可查询 | ✔ 可真实查询 | 需腾讯云 SecretId |
| **DeepSeek** | ❌ 充值余额制 | ✔ 可查询 | ✔ 可真实查询 | 已在插件中实现 |

---

## 接入建议分级

### ✔ 优先接入（公开稳定接口，可真实查询）
1. **Kimi/Moonshot** - API 简洁，文档完善
2. **阶跃星辰 StepFun** - 接口清晰，认证简单
3. **DeepSeek** - 已实现，作为参考模板
4. **阿里云百炼** - 功能全面，但需 AccessKey 配置较复杂
5. **火山方舟/豆包** - 接口完整，需火山引擎配置
6. **百度千帆** - 接口丰富，需百度云配置
7. **腾讯混元** - 接口可用，需腾讯云配置

### △ 次优选择（需记账估算或待确认）
1. **智谱 BigModel** - 订阅制明确，但无公开余额 API，需通过调用日志累计
2. **MiniMax** - 订阅制明确，但余额查询接口不明确，待进一步确认

### ✘ 暂不接入
1. **科大讯飞星火** - 无公开余额查询接口
2. **零一万物 01.AI** - 服务已停止

---

## 技术实现要点

### 认证方式分类
- **API Key（Bearer Token）**：Kimi、StepFun、DeepSeek（最简单）
- **AccessKey/SecretKey**：阿里云、火山方舟、百度、腾讯（需签名计算，复杂度中等）
- **无公开接口**：智谱、讯飞、MiniMax（需记账或控制台）

### 订阅窗口制 vs 充值余额制
- **订阅窗口制**（显示百分比）：智谱、阿里云、Kimi、火山、MiniMax、StepFun、百度量包、腾讯资源包
  - 需要显示：已用额度 / 总额度 = 使用百分比
  - 需要显示：重置时间（月度/季度）
- **充值余额制**（显示金额）：DeepSeek、阿里云余额、百度余额、腾讯余额
  - 需要显示：当前余额（CNY/USD）

### 下一步行动
1. **优先实现**：Kimi、StepFun（接口最简单，认证容易）
2. **中期实现**：阿里云、火山、百度、腾讯（需封装 AccessKey 签名逻辑）
3. **后期考虑**：智谱、MiniMax（需设计记账方案或等待官方开放接口）
4. **放弃**：讯飞、零一万物

---

## 附录：关键文档链接汇总

- 智谱 BigModel：[https://docs.bigmodel.cn/cn/coding-plan/overview](https://docs.bigmodel.cn/cn/coding-plan/overview)
- 阿里云百炼：[https://help.aliyun.com/zh/model-studio/token-plan-overview](https://help.aliyun.com/zh/model-studio/token-plan-overview)
- Kimi API：[https://platform.kimi.ai/docs/api/balance](https://platform.kimi.ai/docs/api/balance)
- 火山方舟：[https://www.volcengine.com/docs/82379/2479849](https://www.volcengine.com/docs/82379/2479849)
- MiniMax：[https://platform.minimaxi.com/docs/token-plan/intro](https://platform.minimaxi.com/docs/token-plan/intro)
- StepFun：[https://platform.stepfun.com/docs/zh/step-plan/overview](https://platform.stepfun.com/docs/zh/step-plan/overview)
- 百度千帆：[https://cloud.baidu.com/doc/qianfan/s/smh4sux04](https://cloud.baidu.com/doc/qianfan/s/smh4sux04)
- 腾讯混元：[https://cloud.tencent.com/document/product/1729/97731](https://cloud.tencent.com/document/product/1729/97731)
- DeepSeek：[https://api-docs.deepseek.com/zh-cn/api/get-user-balance/](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)
