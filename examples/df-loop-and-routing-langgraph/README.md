# 循环与条件分支 · LangChain / LangGraph

这是独立的 LangGraph JavaScript StateGraph 工程，不依赖 DecoupleFlow 服务。

```bash
npm install
npm start
```

交互示例在工作/等待节点暂停，输入 {"context":"实际执行结果"} 恢复；Agent 决策暂停时输入 decisionFormat 格式的 JSON。Jev 模式由 Adapter 直接检查下一条路径。

## 接入已有 Agent

从 workflow.mjs 导入 createWorkflow 和 makeInput。通过 handlers[stateId] 绑定节点：函数接收 {state, record, context}，调用你的 Agent / LangChain Runnable / 工具，并返回最新证据字符串。工作与等待节点未绑定时使用 interrupt 暂停。自己的 Agent 模式可以传入 decide(handoff) 返回结构化决策；未绑定时暂停等待宿主决策。

使用 graph.invoke(makeInput(context, instanceId), {configurable:{thread_id: instanceId}, recursionLimit:1000}) 启动。使用同一个 thread_id 与 Command({resume: ...}) 恢复。示例使用内存检查点；重启后恢复请传入宿主已有的持久化 checkpointer。业务处理器需自行保障外部动作幂等。

分支按迁移 ID 区分，相同目标的不同条件不会合并。图中拆分工作与判断节点，质量未通过时只补充判断证据，不重复执行业务节点。子流程内部结束后回到父节点判断阶段。

## 推进方式

当前选择：自己的 Agent，根据 handoff 中的路径、质量要求与实际证据返回 decision。

业务动作、工具权限、外部任务结果由宿主负责。导出保留全部状态、条件、质量、策略、循环与子流程；自然语言说明不会被自动伪造为可执行工具。没有匹配、质量未通过或判断不确定时保持当前状态。

参考：[LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)、[暂停与恢复](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。
