# 循环与条件分支 · Dify 单步状态迁移工作流

在 Dify 工作室选择「导入 DSL 文件」，上传 workflow.yml。DSL 使用 0.3.1 基础格式；按官方源码与节点结构生成，较新版本可通过导入迁移读取。

## 使用

1. 自己的 Agent 按 handoff 的 decisionFormat 返回结构化决策。
2. record_json 首次留空，从定义入口创建实例；context 填写本次真实执行证据。decision_json 首次可留空，获得 handoff_json；有决策时填写 decision_json。
3. 读取 status：advanced 表示迁移成功，held 表示保持原状态，completed 表示实例结束。保存返回的 record_json，下一次原样传入；同一实例按顺序调用，避免并发覆盖。
4. 宿主根据 current_state 执行下一节点业务，再提交新证据。循环返回同样经过显式调用；等待外部执行时由宿主保管 job ID 并查询原任务。

## 这一条接入路线的边界

这是可导入的「单步迁移」强校验工作流。完整状态机嵌入 Code 节点，保持自由回路、子状态机和多条件选路。它没有把任意回边强行改成 Dify 的层级 Loop，也不会自动绑定业务 LLM 或工具。需要在 Dify 画布继续增加业务节点，或由自己的服务/Agent 按状态反复调用工作流 API。

每个节点的配置和策略保存在 state-machine.json、完整 Mermaid 总图在 state-machine.md。代码、状态记录与交接包大小受目标 Dify 部署限制；长实例请归档并在宿主中管理上下文。导入、配置完成后请在自己的 Dify 实例中运行验收。

## 推进方式

当前选择：自己的 Agent，根据 handoff 中的路径、质量要求与实际证据返回 decision。

业务动作、工具权限、外部任务结果由宿主负责。导出保留全部状态、条件、质量、策略、循环与子流程；自然语言说明不会被自动伪造为可执行工具。没有匹配、质量未通过或判断不确定时保持当前状态。

参考：[Dify 导入 / 导出](https://docs.dify.ai/en/cloud/use-dify/workspace/app-management)、[Code 节点](https://docs.dify.ai/en/cloud/use-dify/nodes/code)。
