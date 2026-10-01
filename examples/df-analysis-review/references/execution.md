## 实例与实时展示

需要 Node.js 18.18+。运行助手只维护状态和展示实际事件；业务工作仍由宿主自主完成。

1. 每个新任务先执行下方 start。它总是创建新实例，不会复用上次已完成的记录。脚本路径相对于本 Skill 安装目录，工作区是用户当前任务的目录，不能填 Skill 目录或 DecoupleFlow 源码目录。

```bash
node scripts/run.mjs start --workspace /absolute/task/workspace --actor "宿主 Agent 名称"
```

2. 保存返回的 instance 绝对路径，后续命令使用该路径。定义与总 Markdown 会固定到实例目录，不要把任务状态写进 Skill 安装目录。开启可视化后，助手启动独立本地窗口，无需预先打开编辑器；若 browserOpened 为 false，先使用宿主可用的打开浏览器或预览工具打开 viewerUrl；宿主也没有此能力时再向用户提供链接并说明限制。关闭可视化可在导出前设置，或本次 start 加 --visualization off。
3. 使用返回的 handoff 读取当前目标、候选路径与 decisionFormat，执行节点工作。需要等待、人工检查或报告失败时，将实际事件写入 JSON 文件并提交：

```bash
node scripts/run.mjs event --instance /absolute/instance --event /absolute/event.json
```

事件示例：`{"type":"external.waiting","detail":"等待原任务 job-42，尚未完成"}`。支持 agent.started、agent.completed、external.waiting、external.completed、human.required、run.failed、run.timeout。只报告实际发生的事件。

4. 自己的 Agent 判断本次条件后，按 handoff.decisionFormat 写入决策文件，再使用 advance 提交。Jev 模式仅传本次证据文件，并在宿主环境配置 TYPESAFE_API_KEY，不传 --decision。没有证据或检查未通过时保持当前状态。

```bash
node scripts/run.mjs advance --instance /absolute/instance --decision /absolute/decision.json --context /absolute/evidence.txt
```

5. 只以返回的 record / handoff 为后续依据。助手自动写入记录并更新窗口，不要另外手工改文件。paused 时保留业务产出，等待窗口继续或单步后重提判断，不能重新执行已完成的业务；held 时补充证据。顶层结束状态需要最后一次 __finish__ 判断，完成后自动归档、释放活动实例。新请求重新 start，不复用已结束实例。
6. 用户明确继续某个未完成任务时，执行 resume --instance <原目录>；它保留原定义、状态与外部任务 ID。查看历史用 view --instance <目录>，列出历史用 list --workspace <任务目录>，主动结束未完成实例用 archive --instance <目录>。已归档记录只供查看；新任务从入口开始。fork --instance <目录> 创建当前位置的独立副本，需宿主明确使用返回目录继续。

运行窗口的暂停与单步控制的是后续状态迁移，外部任务由宿主控制。窗口展示当前状态、循环与分支、Jev 判断和实际事件；关闭窗口不取消任务。完成后本地展示进程自动释放，历史文件保留。没有 Node 或图形环境时明确告知限制，按状态机说明维护独立记录，不声称已展示。
