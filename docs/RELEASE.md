# v1.9.0 发布记录（RELEASE）

- 日期：2026-08-28
- 执行：主 Agent（发布/运维），经用户 Gate 4 确认后进入发布阶段

## 版本与范围
- semver：**1.9.0**（新功能 + 修复：信息底栏设置页 + 性能地基）
- 提交流（分支 feat/v1.9.0-perf，全部 Conventional Commits）：
  - `acc6f28` docs 性能审计报告
  - `1bb1eca` feat(ledger) PR1 性能地基
  - `6603ca1` test(ledger) PR1 验收测试
  - `c690896` docs 立项材料归档
  - `d06b415`/`6a8b5d6`/`876baff`/`ce80f8c` feat(info-bar/settings-page) PR2 四里程碑
  - `8461cf1`/`d7a1c28`/`5b86f99` fix+docs QA 修复轮（D1-D5/L1）
  - `0842c09`/`0f8a359` feat+test D6 用户拍板改动
  - `ba80ffc` chore(release) 发布准备（版本号/CHANGELOG/README）

## 发布流程（既定：主分支保护，squash PR 合并）
1. Gate 4：QA 回归复验与小范围 QA-3 复核 + 门禁负责人独立取证 → 判定「可进入发布准备」（docs/QA-REPORT-v1.9.md 回归复验章节；子任务执行环境两次故障已如实记录）
2. 安全审计：docs/AUDIT-v1.9.md，零高危零中危，1 低危（L1 权限自愈，已随修复落地）
3. 发布准备提交：版本号 1.8.0→1.9.0、CHANGELOG [1.9.0]、README 中英新增两处用户视角特性
4. push 分支 → PR #27（--head 显式指定）→ `gh pr merge --squash --delete-branch --auto` 挂自动合并等 CI
5. CI 通过后 squash 合并 → 本地 `git reset --hard origin/main` 对齐 → tag v1.9.0 → `gh release create`

## 发布产物
- GitHub Release：https://github.com/SONGOAO25/dsh-bottom-info-bar/releases/tag/v1.9.0
- 合并提交：`2cfc84c`（PR #27 squash）；tag v1.9.0 指向该提交（与 origin/main 一致，已复核 rev-parse 相等）
- Release 说明：本仓库 CHANGELOG [1.9.0] 用户视角内容
- 徽章更新：README Release 徽章随 tag 自动指向 v1.9.0（curl -I 均 200）
- 远程价目目录：catalog/pricing.json raw 链接 200，25 条目（无新增服务商）

## 发布过程备注（如实记录）
- 首次打标签时因未先 fetch 导致 tag 误指 v1.8.0 提交，已当场修正：fetch → 删除误标 tag 与 Release → 重打 tag 于合并提交 2cfc84c → 重建 Release → rev-parse 复核相等。GitHub 无残留错误指针对。
- 安装脚本末尾出现一条执行环境杂音报错（PROFILE� unbound variable，install.sh 无此变量，非脚本缺陷）；安装已用 `dsh --profile web --dump-config | grep dsh-bottom-info-bar`（3 命中）官方方式验证生效。

## 回滚方案
- 插件回滚：`./uninstall.sh` 卸载 → 检出/安装上一版本（v1.8.0 的 lib 或重新 `dsh plugin add` 旧目录）→ 重启 dsh web。旧版插件读 usage-records.json（窗内明细）显示窗内累计，不报错。
- 数据回滚：账本数据未因发布丢失（明细折叠有冷归档 usage-archive/ 与 .bak 链）；若出现汇总异常，删 usage-summaries.json 重启即从明细重建。
- 远端回滚：main 为保护分支；如需回滚版本，`git revert` 相关 commit 或重发旧 tag Release（本仓库历史无此需求先例）。

## v1.9.1 补录（2026-08-28）
- 性质：真机验收发现「信息底栏」设置页空白（信息栏正常）→ 用户拍板删除旧实现重构
- 重构方向：设置页并入 client-bundle.js 已验证的 apply 路径（单文件单导出，废除 client-settings.js 拼接 + module.exports 包装机制）+「渲染出错即屏显」防白屏；分支 fix/v1.9.1-settings-page
- 全量 21/21 套件 716 断言全绿；发布流程同 v1.9.0（PR → squash → tag v1.9.1 → Release）
