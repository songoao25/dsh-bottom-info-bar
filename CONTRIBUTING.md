# 贡献指南（Contributing）

感谢你考虑为本项目贡献！以下是指南，请先阅读再提交。

## 如何贡献

### 报告 Bug
- 先搜索 [Issues](https://github.com/songoao25/dsh-bottom-info-bar/issues) 是否已存在；
- 新建 Issue 时请包含：复现步骤、期望行为、实际行为、环境信息。

### 提出新功能
- 先在 Issues 中发起讨论，说明用途和场景，避免重复劳动；
- 讨论通过后再实现。

### 提交代码
1. Fork 本仓库并创建功能分支：`git checkout -b feature/xxx`
2. 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范：
   - `feat: 新功能`
   - `fix: 修复`
   - `docs: 文档`
   - `test: 测试`
   - `chore: 杂项`
3. 提交信息用英文或中文均可，但需清晰描述改动；
4. 通过 Pull Request 提交，描述清楚改动内容和验证方式。

### 提交前请自测

```bash
node tests/run-all.mjs     # 会自动先 build 再跑全部测试
```

CI 还会强制执行几条硬规矩（违反即红），请提前了解：

- **不要手工修改版本号**：`plugin/package.json` 的 `version`、`.release-please-manifest.json`、`CHANGELOG.md` 由 [Release Please](https://github.com/googleapis/release-please) 自动维护，手工改会破坏它的发布基准。
- **不要裸读宿主服务属性**（如 `ctx.someService`）。cordis 4 的 Context 是 Proxy，读取未声明 `inject` 的服务属性会抛错——请用 `ctx.get('name')` 或声明注入。这是本项目踩过三次的坑。
- 细节见仓库根目录 `AGENTS.md`。

### 合并与发布（外部贡献者请注意）

- **你自己的 PR 不会自动合并**，需要维护者 review 后手动合并；仓库主人的 PR 才会自动合并（trust-by-author）。
- 合并进 main 后，Release Please 会自动算出新版本号并开一个「发布 PR」，该 PR 需维护者确认后才会打标签并发布到 npm。所以你的改动会在**下一个版本**里与用户见面。
- 详细流程见 `docs/WORKFLOW.md`。

## 开发环境

- 本项目是 DeepSeek Harness 的静态 bundle 插件；
- 主要文件结构：
  - `plugin/src/` — 源码（host.js + client-bundle.js）
  - `plugin/` — npm 包
  - `tests/` — 测试（`node tests/run-all.mjs` 自动先 build 再测）
- 修改源码后需重建：`cd plugin && npm run build`。

## 行为准则

请遵守 [行为准则](CODE_OF_CONDUCT.md)。参与本项目即表示你同意遵守它。

## 许可证

贡献的代码将采用与本项目相同的 [MIT 许可证](LICENSE)。
