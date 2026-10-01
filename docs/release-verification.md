# 发布验证记录 · 2026-10-01

版本：DecoupleFlow 0.5.0。验证环境：Linux / WSL、Node.js 22.23.3、Chromium 140.0.7339.16。

| 项目 | 结果 | 记录 |
|---|---|---|
| MIT 许可证 | 完成；版权主体为 DecoupleFlow contributors，年份 2026 | [LICENSE](../LICENSE)，package.json 中 `license: MIT` |
| Mermaid 与 high 告警 | Mermaid 11.11.0 → 11.17.2；Vite 6.4.1 → 6.4.3；high 从 2 降至 0 | [审计记录](verification/audit.json) |
| 单元测试 | **102 / 102 通过**，15 个测试文件 | [测试记录](verification/tests.json) |
| E2E | **34 / 34 通过** | [测试记录](verification/tests.json) |
| 类型检查与生产构建 | `npm run check`、`npm run build` 通过 | 构建仍有现有的大分包提示，不影响构建成功 |
| GitHub Actions | 已配置 Node 22 / 24 检查、全部测试、构建、依赖审计、LangGraph / Dify 本地实测；独立 Chromium E2E 任务 | [ci.yml](../.github/workflows/ci.yml) |
| README 首屏 | 中英文重写为独立状态机编辑器 → Markdown / Agent Skill；加入演示与恢复示例入口 | [English](../README.md)、[中文](../README.zh-CN.md) |
| 演示与截图 | 新增核心演示 GIF；全部 8 张既有截图更新，并新增列表与 Dify 截图 | [媒体说明](media.md)、[捕获清单](media-manifest.json) |
| Codex Harness | 两个独立 CLI 进程，同一 Codex 会话、同一 Skill 实例恢复成功；原草稿未重写；完成后归档 | [示例](../examples/codex-resume/)、[实测结果](../examples/verified/results/codex.json) |
| 集成示例 | 真实 LangGraph 与本地 Dify Code 节点通过；Jev / Dify 服务端需要外部配置 | [逐项结果与复现方式](../examples/verified/) |
| 名称查询 | 已有同名公开项目；npm 精确包名、GitHub 精确账号和组织 API 均返回 404 | [查询说明](name-availability.md)、[原始结果](verification/name-availability.json) |

用户最初提到的 86 项测试和 23 项 E2E 已被新增测试扩充。本次运行当前完整套件，没有通过删除、跳过或降低断言来凑出通过数量。

## 三个 Demo 与 README 示意图补充验证

2026-10-01 新增 Bug 修复、来源选型简报、发布前验收三个 Demo，均已接入「新建状态机」，附中英文 JSON、完整 Mermaid Markdown、Codex / Claude Code / Copilot Skill ZIP 和示例输入。

- 当前完整套件：**105 / 105 单元测试、37 / 37 E2E 通过**；类型检查与生产构建通过。
- 三个离线演练通过真实导出的 Skill 执行，验证返工、等待、列表恢复、完成与自动归档。[运行记录](../examples/demos/verification.json)明确记录模型调用为零；CI、人工批准和选型产品使用标记清楚的示例数据。
- 六张中英文 SVG 已检查布局和文字边界，已放入两份 README 的用途、工作原理和 Agent 安装位置。[生成脚本](../scripts/draw-readme-diagrams.mjs)可重建全部图。
- Demo 项目 JSON 可直接导入，Markdown 包含完整状态图；18 个平台 ZIP 的定义、说明和文件哈希已校验，README 本地链接均有效。

## 安全审计范围

`npm audit --audit-level=high` **返回 0**。最新全量审计为 high 0、critical 0、moderate 2。两个 moderate 包是 Vitest 3.2.7 及其 `@vitest/mocker` 依赖，指向同一个[路径遍历公告](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)。它们属于开发测试依赖，未通过忽略审计结果来消除告警；本次没有强行跨主版本升级测试框架。

升级使用同一 Mermaid 主版本中的安全修订版 11.17.2，锁文件已更新。新版依赖 `marked` 要求 Node.js 20+，因此应用的最低 Node 版本与两份 README 已同步提高；CI 采用 Node 22 / 24。

新增 LangGraph 实测示例的独立依赖也已审计：[0 项告警](verification/integration-audit.json)。CI 同时检查这份锁文件。

## 仍需外部环境的验证

- **GitHub 托管运行：** 2026-10-01 的验证记录来自本机。现已将本目录连接到 [Silicontoy/DecoupleFlow](https://github.com/Silicontoy/DecoupleFlow)，推送后的托管结果见 [GitHub Actions](https://github.com/Silicontoy/DecoupleFlow/actions/workflows/ci.yml)，与上述本地记录分别查看。
- **Jev 线上实测：** 当前未提供 `TYPESAFE_API_KEY`。已提供真实 API 验证脚本，缺少凭据时明确退出为 blocked，不使用模拟结果冒充实测。
- **Dify 服务端实测：** 当前未提供 Dify 地址和已发布应用的 API Key。本地通过的是导出 Code 节点的执行与状态语义，尚未验证目标 Dify 的 DSL 导入、沙盒与工作流 API。配置 `DIFY_BASE_URL`、`DIFY_API_KEY` 后可执行已准备好的验收脚本。

## 本地复现

```bash
npm ci
npm run check
npm test
npm run build
npm audit --audit-level=high
npx playwright install --with-deps chromium
npm run test:e2e
npm ci --prefix examples/verified --ignore-scripts
npm run example:verify -- langgraph
npm run example:verify -- dify
npm run example:codex -- start
npm run example:codex -- resume
```

Codex 两个命令会实际使用本机已登录账号进行模型调用。公共 CI 只运行无需账号的验证。原始 Codex 会话日志、实例目录和演示录像中间文件保存在忽略目录中；提交的实测结果只包含版本、断言结果和时间。
