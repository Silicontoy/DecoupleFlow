import { readFileSync } from 'node:fs';
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
