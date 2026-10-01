import { translator, type Language } from '../i18n/translate';
import { compileMarkdown, hashText, type Bundle } from './compiler';
import { adapterModule } from './adapterExport';
import { portableRuntimeSource, runtime } from './runtime';
import { driverOf, semanticMachine, type Machine } from './types';
import { validateMachine } from './validate';

export type WorkflowTarget = 'langgraph' | 'dify';
export const WORKFLOW_TARGETS = {
  langgraph: { label: 'LangChain / LangGraph', summary: '导出可运行的 JavaScript StateGraph 工程。绑定已有 Agent 或工具处理节点，按条件迁移，支持等待恢复。' },
  dify: { label: 'Dify', summary: '导出可导入的单步状态迁移 DSL。每次调用检查一条迁移并返回实例记录；由宿主反复调用，保留循环与子状态机。' },
};

const langgraphModule = `import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Annotation, StateGraph, START, END, MemorySaver, interrupt } from '@langchain/langgraph';
import { runtime, requestJev } from './adapter.mjs';
const definition = readFileSync(new URL('./state-machine.json', import.meta.url), 'utf8');
export const machine = JSON.parse(definition);
export const definitionHash = JSON.parse(readFileSync(new URL('./export-manifest.json', import.meta.url), 'utf8')).definitionHash;
if (createHash('sha256').update(definition).digest('hex') !== definitionHash) throw new Error('State machine changed; export a new version before resuming.');
export const makeInput = (context = '', instanceId = 'instance-1') => ({ record: runtime.initialRecord(machine, definitionHash, instanceId), context });
const Frame = Annotation.Root({ record: Annotation(), context: Annotation(), result: Annotation(), pendingDecision: Annotation() });

// handlers[stateId] returns the latest factual context. It may call an existing
// Agent, LangChain Runnable or business tool. The generated graph does not infer
// tool bindings from natural-language instructions.
export function createWorkflow({ handlers = {}, decide, checkpointer = new MemorySaver() } = {}) {
  const graph = new StateGraph(Frame);
  const work = id => 'work-' + id;
  const judge = id => 'judge-' + id;
  const workOrJudge = frame => frame.record.phase === 'exiting' || runtime.listProgress(machine, frame.record)?.currentItem === null ? judge(frame.record.currentState) : work(frame.record.currentState);
  const nextNode = frame => frame.record.status === 'completed' ? END : frame.result?.status === 'held' ? 'await-evidence' : workOrJudge(frame);
  graph.addNode('validate-instance', frame => { runtime.assertRecord(machine, frame.record, definitionHash); return {}; });
  graph.addEdge(START, 'validate-instance');
  graph.addConditionalEdges('validate-instance', frame => frame.record.status === 'completed' ? END : workOrJudge(frame), [...machine.states.flatMap(s => [work(s.id), judge(s.id)]), END]);
  for (const state of machine.states) {
    graph.addNode(work(state.id), async frame => {
      runtime.assertRecord(machine, frame.record, definitionHash);
      if (frame.record.currentState !== state.id) throw new Error('State/node mismatch');
      if (!['task', 'wait', 'list'].includes(state.kind)) return {};
      const listProgress = runtime.listProgress(machine, frame.record);
      if (listProgress && !listProgress.currentItem) return {};
      const input = { state, record: frame.record, context: frame.context, listProgress, item: listProgress?.currentItem ?? null };
      const response = handlers[state.id]
        ? await handlers[state.id](input)
        : interrupt({ type: state.kind === 'wait' ? 'external-result' : 'work', ...input, resume: { context: 'Provide actual results; a submitted job is not a completed job.' } });
      const context = typeof response === 'string' ? response : response?.context;
      if (typeof context !== 'string' || !context.trim()) throw new Error('The node handler must return factual context.');
      return { context, pendingDecision: null };
    });
    graph.addNode(judge(state.id), async frame => {
      runtime.assertRecord(machine, frame.record, definitionHash);
      let result;
      if (runtime.settings(machine).type === 'jev') {
        const payload = runtime.buildJevRequest(machine, frame.record, frame.context || '');
        const raw = await requestJev(payload, process.env.TYPESAFE_API_KEY || '');
        result = runtime.interpretJev(machine, frame.record, frame.context, raw, definitionHash);
      } else {
        const input = runtime.handoff(machine, frame.record, frame.context || '');
        const response = frame.pendingDecision || (decide ? await decide(input) : interrupt({ type: 'agent-decision', ...input }));
        result = runtime.applyDecision(machine, frame.record, response?.decision || response, definitionHash);
      }
      return { record: result.record, result, pendingDecision: null };
    });
    graph.addEdge(work(state.id), judge(state.id));
    const active = { ...runtime.initialRecord(machine, definitionHash), currentState: state.id };
    const paths = [...runtime.candidates(machine, active), ...(state.kind === 'subflow' ? runtime.candidates(machine, { ...active, phase: 'exiting' }) : []), ...(state.kind === 'list' ? machine.transitions.filter(t => t.from === state.id) : [])];
    const destinations = [...new Set(paths.map(p => 'control' in p && p.control === 'finish' ? END : 'control' in p && p.control === 'return' ? judge(p.to) : work(p.to))), ...(state.kind === 'list' ? [judge(state.id)] : []), 'await-evidence'];
    graph.addConditionalEdges(judge(state.id), nextNode, destinations);
  }
  // Separate work and decision nodes: resuming a failed check does not repeat a
  // business tool call. Make business handlers idempotent for process crashes.
  graph.addNode('await-evidence', frame => {
    const response = interrupt({ type: 'more-evidence', reason: frame.result.reason, ...runtime.handoff(machine, frame.record, frame.context || ''), resume: { context: 'Updated evidence', decision: null } });
    return { context: typeof response?.context === 'string' ? response.context : frame.context, pendingDecision: response?.decision || null };
  });
  graph.addConditionalEdges('await-evidence', frame => judge(frame.record.currentState), machine.states.map(s => judge(s.id)));
  return graph.compile({ checkpointer });
}
`;

const runModule = `import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Command } from '@langchain/langgraph';
import { createWorkflow, makeInput } from './workflow.mjs';
const graph = createWorkflow();
const config = { configurable: { thread_id: 'interactive-example' }, recursionLimit: 1000 };
const rl = createInterface({ input: stdin, output: stdout });
try {
  let result = await graph.invoke(makeInput(''), config);
  while (result.__interrupt__?.length) {
    console.log(JSON.stringify(result.__interrupt__.map(i => i.value), null, 2));
    const text = await rl.question('Resume with JSON > ');
    let resume;
    try { resume = JSON.parse(text); } catch { console.error('Please enter valid JSON.'); continue; }
    result = await graph.invoke(new Command({ resume }), config);
  }
  console.log(JSON.stringify(result, null, 2));
} finally { rl.close(); }
`;

type DifyNode = { id: string; data: Record<string, unknown>; [key: string]: unknown };
export function difyDsl(machine: Machine, hash: string, language: Language = 'zh') {
  const tr = translator(language);
  const useJev = driverOf(machine).type === 'jev';
  const source = portableRuntimeSource(language) + `\nconst machine = ${JSON.stringify(machine)};\nconst definitionHash = ${JSON.stringify(hash)};\n`;
  const load = `const record = record_json && record_json.trim() ? JSON.parse(record_json) : runtime.initialRecord(machine, definitionHash);\nruntime.assertRecord(machine, record, definitionHash);\n`;
  const nodes: DifyNode[] = [];
  const edges: Record<string, unknown>[] = [];
  const node = (id: string, title: string, type: string, data: Record<string, unknown>) => {
    const position = { x: 60 + nodes.length * 340, y: 120 };
    nodes.push({ id, type: 'custom', width: 270, height: 110, position, positionAbsolute: position, selected: false, sourcePosition: 'right', targetPosition: 'left', data: { title, type, desc: '', selected: false, ...data } });
  };
  const variables = (fields: [string, string, string][]) => fields.map(([variable, id, key]) => ({ variable, value_selector: [id, key], value_type: 'string' }));
  node('df-start', tr("实例与执行证据"), 'start', { variables: [{ variable: 'record_json', label: tr("实例记录 JSON（首次留空）"), type: 'paragraph', required: false, max_length: 200000, options: [] }, { variable: 'context', label: tr("本次实际执行证据"), type: 'paragraph', required: true, max_length: 100000, options: [] }, ...(!useJev ? [{ variable: 'decision_json', label: tr("Agent 决策 JSON（留空返回交接包）"), type: 'paragraph', required: false, max_length: 20000, options: [] }] : [])] });
  if (useJev) {
    node('df-request', tr("准备 Jev 结构化问题"), 'code', { code_language: 'javascript', code: source + `\nfunction main({record_json, context}) {\n${load}return { request_body: JSON.stringify(runtime.buildJevRequest(machine, record, context)), record_json: JSON.stringify(record) };\n}`, variables: variables([['record_json', 'df-start', 'record_json'], ['context', 'df-start', 'context']]), outputs: { request_body: { type: 'string', children: null }, record_json: { type: 'string', children: null } } });
    node('df-jev', 'Jev · TypeSafe', 'http-request', { method: 'post', url: 'https://api.typesafe.ai/v1/systemone', authorization: { type: 'no-auth' }, headers: 'Authorization:Bearer {{#env.TYPESAFE_API_KEY#}}\nContent-Type:application/json', params: '', body: { type: 'raw-text', data: [{ id: 'df-body', type: 'text', key: '', value: '{{#df-request.request_body#}}' }] }, timeout: { connect: 10, read: 30, write: 30 }, retry_config: { retry_enabled: false, max_retries: 0, retry_interval: 1000 }, ssl_verify: true });
  }
  const evaluate = useJev ? `if (Number(status_code) !== 200) throw new Error('Jev HTTP request failed; keep original record.');\nconst result = runtime.interpretJev(machine, record, context, JSON.parse(response_body), definitionHash);` : `const decision = decision_json && decision_json.trim() ? JSON.parse(decision_json) : { transitionId: null, conditionMet: false, targetEntryMet: false, passedQuality: [], evidence: '' };\nconst result = runtime.applyDecision(machine, record, decision, definitionHash);`;
  const advanceInputs: [string, string, string][] = [['record_json', useJev ? 'df-request' : 'df-start', 'record_json'], ['context', 'df-start', 'context']];
  if (useJev) advanceInputs.push(['response_body', 'df-jev', 'body'], ['status_code', 'df-jev', 'status_code']);
  else advanceInputs.push(['decision_json', 'df-start', 'decision_json']);
  node('df-advance', tr("检查条件与迁移状态"), 'code', { desc: tr("完整状态机嵌入本节点。每次调用最多一次迁移；held 时保留输入记录。"), code_language: 'javascript', code: source + `\nfunction main({record_json, context, decision_json, response_body, status_code}) {\n${load}${evaluate}\nreturn { record_json: JSON.stringify(result.record), result_json: JSON.stringify(result), current_state: result.record.currentState, status: result.status, handoff_json: JSON.stringify(runtime.handoff(machine, result.record, context)) };\n}`, variables: variables(advanceInputs).map(v => v.variable === 'status_code' ? { ...v, value_type: 'number' } : v), outputs: Object.fromEntries(['record_json', 'result_json', 'current_state', 'status', 'handoff_json'].map(key => [key, { type: 'string', children: null }])) });
  node('df-end', tr("返回下一状态与记录"), 'end', { outputs: ['record_json', 'result_json', 'current_state', 'status', 'handoff_json'].map(variable => ({ variable, value_type: 'string', value_selector: ['df-advance', variable] })) });
  for (let i = 1; i < nodes.length; i++) edges.push({ id: `${nodes[i - 1].id}-to-${nodes[i].id}`, type: 'custom', source: nodes[i - 1].id, sourceHandle: 'source', target: nodes[i].id, targetHandle: 'target', zIndex: 0, data: { sourceType: nodes[i - 1].data.type, targetType: nodes[i].data.type, isInIteration: false, isInLoop: false } });
  return {
    version: '0.3.1', kind: 'app', dependencies: [], app: { name: `${machine.name} · DecoupleFlow`, description: tr("单步状态迁移工作流。接收执行证据，检查条件并返回下一状态；宿主据此执行下一节点并再次调用。"), icon: '🔀', icon_background: '#E8F3EC', mode: 'workflow', use_icon_as_answer_icon: false },
    workflow: { conversation_variables: [], environment_variables: useJev ? [{ id: 'dfe00e00-0000-4000-8000-000000000001', name: 'TYPESAFE_API_KEY', value_type: 'secret', value: '', description: tr("在 Dify 内配置 TypeSafe API Key。导出包不含密钥。") }] : [], features: { file_upload: { enabled: false, allowed_file_extensions: [], allowed_file_types: [], allowed_file_upload_methods: [], number_limits: 1, image: { enabled: false, number_limits: 1, transfer_methods: [] } }, opening_statement: '', retriever_resource: { enabled: false }, sensitive_word_avoidance: { enabled: false }, speech_to_text: { enabled: false }, suggested_questions: [], suggested_questions_after_answer: { enabled: false }, text_to_speech: { enabled: false, language: '', voice: '' } }, graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.75 } } },
  };
}

export async function buildWorkflowBundle(input: Machine, target: WorkflowTarget, language: Language = 'zh'): Promise<Bundle> {
  const tr = translator(language);
  const machine = semanticMachine(input);
  const errors = validateMachine(machine, language).filter(d => d.level === 'error');
  if (errors.length) throw new Error(errors[0].message);
  const json = JSON.stringify(machine, null, 2) + '\n';
  const semanticHash = await hashText(json);
  const driver = driverOf(machine);
  const files: Record<string, string> = {};
  const notes = tr("\n## 推进方式\n\n当前选择：{0}\n\n业务动作、工具权限、外部任务结果由宿主负责。导出保留全部状态、条件、质量、策略、循环与子流程；自然语言说明不会被自动伪造为可执行工具。没有匹配、质量未通过或判断不确定时保持当前状态。\n", { "0": driver.type === 'jev' ? tr("Jev（{0}），最低置信度 {1}，条件与路径概率 {2}。配置 TYPESAFE_API_KEY 后才能实际调用 TypeSafe。", { "0": driver.model, "1": driver.minConfidence, "2": driver.minProbability }) : tr("自己的 Agent，根据 handoff 中的路径、质量要求与实际证据返回 decision。") });
  if (target === 'langgraph') {
    files['workflow.mjs'] = langgraphModule;
    files['adapter.mjs'] = adapterModule(language);
    files['run.mjs'] = runModule;
    files['package.json'] = JSON.stringify({ name: `df-${machine.id}-langgraph`, private: true, type: 'module', engines: { node: '>=20' }, scripts: { start: 'node run.mjs' }, dependencies: { '@langchain/langgraph': '1.4.18' } }, null, 2) + '\n';
    files['README.md'] = tr("# {0} · LangChain / LangGraph\n\n这是独立的 LangGraph JavaScript StateGraph 工程，不依赖 DecoupleFlow 服务。\n\n```bash\nnpm install\nnpm start\n```\n\n交互示例在工作/等待节点暂停，输入 {\"context\":\"实际执行结果\"} 恢复；Agent 决策暂停时输入 decisionFormat 格式的 JSON。Jev 模式由 Adapter 直接检查下一条路径。\n\n## 接入已有 Agent\n\n从 workflow.mjs 导入 createWorkflow 和 makeInput。通过 handlers[stateId] 绑定节点：函数接收 {state, record, context}，调用你的 Agent / LangChain Runnable / 工具，并返回最新证据字符串。工作与等待节点未绑定时使用 interrupt 暂停。自己的 Agent 模式可以传入 decide(handoff) 返回结构化决策；未绑定时暂停等待宿主决策。\n\n使用 graph.invoke(makeInput(context, instanceId), {configurable:{thread_id: instanceId}, recursionLimit:1000}) 启动。使用同一个 thread_id 与 Command({resume: ...}) 恢复。示例使用内存检查点；重启后恢复请传入宿主已有的持久化 checkpointer。业务处理器需自行保障外部动作幂等。\n\n分支按迁移 ID 区分，相同目标的不同条件不会合并。图中拆分工作与判断节点，质量未通过时只补充判断证据，不重复执行业务节点。子流程内部结束后回到父节点判断阶段。\n{1}\n参考：[LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)、[暂停与恢复](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。\n", { "0": machine.name, "1": notes });
  } else {
    const dsl = difyDsl(machine, semanticHash, language);
    // JSON is a YAML-compatible representation accepted by Dify's YAML loader.
    files['workflow.yml'] = JSON.stringify(dsl, null, 2) + '\n';
    files['README.md'] = tr("# {0} · Dify 单步状态迁移工作流\n\n在 Dify 工作室选择「导入 DSL 文件」，上传 workflow.yml。DSL 使用 0.3.1 基础格式；按官方源码与节点结构生成，较新版本可通过导入迁移读取。\n\n## 使用\n\n1. {1}\n2. record_json 首次留空，从定义入口创建实例；context 填写本次真实执行证据。{2}\n3. 读取 status：advanced 表示迁移成功，held 表示保持原状态，completed 表示实例结束。保存返回的 record_json，下一次原样传入；同一实例按顺序调用，避免并发覆盖。\n4. 宿主根据 current_state 执行下一节点业务，再提交新证据。循环返回同样经过显式调用；等待外部执行时由宿主保管 job ID 并查询原任务。\n\n## 这一条接入路线的边界\n\n这是可导入的「单步迁移」强校验工作流。完整状态机嵌入 Code 节点，保持自由回路、子状态机和多条件选路。它没有把任意回边强行改成 Dify 的层级 Loop，也不会自动绑定业务 LLM 或工具。需要在 Dify 画布继续增加业务节点，或由自己的服务/Agent 按状态反复调用工作流 API。\n\n每个节点的配置和策略保存在 state-machine.json、完整 Mermaid 总图在 state-machine.md。代码、状态记录与交接包大小受目标 Dify 部署限制；长实例请归档并在宿主中管理上下文。导入、配置完成后请在自己的 Dify 实例中运行验收。\n{3}\n参考：[Dify 导入 / 导出](https://docs.dify.ai/en/cloud/use-dify/workspace/app-management)、[Code 节点](https://docs.dify.ai/en/cloud/use-dify/nodes/code)。\n", { "0": machine.name, "1": driver.type === 'jev' ? tr("在工作流环境变量中填写 secret 类型的 TYPESAFE_API_KEY；密钥只在 Dify 中配置。") : tr("自己的 Agent 按 handoff 的 decisionFormat 返回结构化决策。"), "2": driver.type === 'agent' ? tr("decision_json 首次可留空，获得 handoff_json；有决策时填写 decision_json。") : '', "3": notes });
  }
  files['state-machine.json'] = json;
  if (machine.states.some(state => state.kind === 'list')) files['README.md'] += '\n' + tr("## 列表状态") + '\n\n' + tr("按列表顺序处理，每项都重新检查统一通过条件和本状态的必要质量项；未通过或不确定时停留在当前项。全部事项通过后才检查出口条件。暂停与恢复保留当前项，重新进入本状态从第一项开始。") + '\n\n' + (target === 'langgraph' ? tr("列表处理器每次接收 item 与 listProgress，只处理当前一项；最后一项通过后进入出口判断，不重复调用业务处理器。") : tr("从 handoff_json 的 listProgress 读取当前项；每次调用只确认该项，通过后再次获取交接包。全部事项通过后，才会返回候选出口。")) + '\n';
  files['state-machine.md'] = compileMarkdown(machine, language);
  files['state-record.template.json'] = JSON.stringify(runtime.initialRecord(machine, semanticHash), null, 2) + '\n';
  files['export-manifest.json'] = JSON.stringify({ generator: 'DecoupleFlow', version: '0.4.0', language, target, driver, definitionHash: semanticHash, contract: target === 'dify' ? 'one-transition-per-invocation' : 'langgraph-stategraph', nodes: machine.states.length, transitions: machine.transitions.length, requiresBusinessBindings: true }, null, 2) + '\n';
  return { skillName: `df-${machine.id}-${target}`, files, semanticHash, language };
}
