import { z } from 'zod';

export const STATE_KINDS = ['task', 'list', 'decision', 'loop', 'wait', 'end', 'subflow'] as const;
export const KIND_LABELS = { task: '工作状态', list: '列表', decision: '条件判断', loop: '循环', wait: '等待状态', end: '结束状态', subflow: '子状态机' } as const;
export const LOOP_ROLE_LABELS = { continue: '继续循环', exit: '退出循环' } as const;
export const DEFAULT_ROUTING_POLICY = '每次从任一入路到达后，结合当前上下文检查各出路的条件、必要质量项与目标进入条件，沿明确满足条件的路径迁移。没有匹配、证据不足或多个条件冲突时保留当前状态，核实后再选择。';
export const Identifier = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '标识只能包含小写字母、数字与单个短横线');
const prose = z.string().max(20000);
export const QualitySchema = z.object({ id: Identifier, text: z.string().max(2000), required: z.boolean() });
export const ListSchema = z.object({
  items: z.array(z.object({ id: Identifier, text: z.string().max(4000) })).max(100),
  passCondition: z.string().max(4000),
});
export const StateSchema = z.object({
  id: Identifier,
  name: z.string().max(120),
  kind: z.enum(STATE_KINDS),
  description: prose,
  entryConditions: prose,
  routingPolicy: prose.optional(),
  list: ListSchema.optional(),
  qualityConditions: z.array(QualitySchema).max(50),
  toolGuidance: prose,
  configuration: prose,
  strategies: z.object({ during: prose, onFailure: prose, onUncertain: prose }),
  parentId: Identifier.nullable(),
  initialState: z.union([Identifier, z.literal('')]),
  outcome: z.enum(['success', 'failure', 'stopped']),
});
export const TransitionSchema = z.object({
  id: Identifier, from: Identifier, to: Identifier,
  condition: z.string().max(4000),
  requiredQuality: z.array(Identifier).max(50),
  onUncertain: z.string().max(2000),
  kind: z.enum(['normal', 'fallback']),
  loopRole: z.enum(['continue', 'exit']).optional(),
});
// Retain legacy v0.2 planning data when opening and saving old project files.
// It is not used to generate the state-machine diagram or Markdown description.
const DurationSchema = z.object({ value: z.number().finite().min(0).max(36500), unit: z.enum(['s', 'm', 'h', 'd']) });
const PlanTaskSchema = z.object({
  duration: DurationSchema.optional(),
  included: z.boolean().optional(),
  // Undefined follows the state graph; an empty array explicitly means no predecessors.
  dependsOn: z.array(Identifier).max(250).optional(),
});
const PlanningSchema = z.object({
  startAt: z.string().max(19).refine(value => value === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value), '开始时间格式不正确'),
  defaultDuration: DurationSchema,
  includeFallback: z.boolean(),
  tasks: z.record(Identifier, PlanTaskSchema),
});
export const DriverSchema = z.object({
  type: z.enum(['agent', 'jev']),
  model: z.string().trim().min(1).max(100),
  minConfidence: z.number().finite().min(0.5).max(1),
  minProbability: z.number().finite().min(0.5).max(1),
});
export type Driver = z.infer<typeof DriverSchema>;
export const DEFAULT_DRIVER: Driver = { type: 'agent', model: 'jev-latest', minConfidence: 0.8, minProbability: 0.85 };
export const VisualizationSchema = z.object({ enabled: z.boolean(), autoOpen: z.boolean() });
export type Visualization = z.infer<typeof VisualizationSchema>;
export const visualizationOf = (machine: Machine): Visualization => machine.visualization ?? { enabled: true, autoOpen: true };
export const MachineSchema = z.object({
  schemaVersion: z.literal(1), id: Identifier,
  name: z.string().max(120), version: z.string().max(40),
  purpose: prose, initialState: z.union([Identifier, z.literal('')]),
  states: z.array(StateSchema).max(250),
  transitions: z.array(TransitionSchema).max(1000),
  planning: PlanningSchema.optional(),
  driver: DriverSchema.optional(),
  visualization: VisualizationSchema.optional(),
});
export const PositionSchema = z.object({
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
  collapsed: z.boolean().optional(),
});
export const ProjectSchema = z.object({
  format: z.literal('decoupleflow-project'), schemaVersion: z.literal(1),
  machine: MachineSchema,
  layout: z.record(Identifier, PositionSchema),
  connections: z.record(Identifier, z.object({ sourceHandle: z.enum(['out', 'out-bottom']), targetHandle: z.enum(['in', 'in-top']) })).optional(),
});
export const DraftProjectSchema = ProjectSchema.extend({ machine: MachineSchema.extend({ id: z.string().max(64) }) });
export type State = z.infer<typeof StateSchema>;
export type StateKind = State['kind'];
export const isBranchState = (state: Pick<State, 'kind'>) => state.kind === 'decision' || state.kind === 'loop';
export const routingPolicyOf = (state: State) => state.routingPolicy?.trim() || DEFAULT_ROUTING_POLICY;
export type Quality = z.infer<typeof QualitySchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Machine = z.infer<typeof MachineSchema>;
export const driverOf = (machine: Machine): Driver => machine.driver ?? DEFAULT_DRIVER;
export type Project = z.infer<typeof ProjectSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type Diagnostic = { level: 'error' | 'warning'; code: string; message: string; stateId?: string; transitionId?: string };
export type Target = 'generic' | 'codex' | 'claude' | 'copilot';
export const TARGETS: Record<Target, { label: string; directory: string; personalDirectory: string; invocation: string }> = {
  generic: { label: '通用 Agent Skill', directory: '', personalDirectory: '', invocation: '请使用此状态机 Skill 处理任务。' },
  codex: { label: 'Codex', directory: '.agents/skills', personalDirectory: '.agents/skills', invocation: '$SKILL_NAME' },
  claude: { label: 'Claude Code', directory: '.claude/skills', personalDirectory: '.claude/skills', invocation: '/SKILL_NAME' },
  copilot: { label: 'GitHub Copilot', directory: '.github/skills', personalDirectory: '.copilot/skills', invocation: '请使用 SKILL_NAME 技能处理这个任务。' },
};

export function newId(prefix = 'state') { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }
export function newState(kind: StateKind, id = newId(), name: string = KIND_LABELS[kind]): State {
  return { id, name, kind, description: '', entryConditions: '', ...(kind === 'list' ? { list: { items: [], passCondition: '' } } : {}), qualityConditions: [], toolGuidance: '', configuration: '', strategies: { during: '', onFailure: '', onUncertain: '无法判断时保留当前状态，补充信息后再次检查。' }, parentId: null, initialState: '', outcome: 'success' };
}
export function clone<T>(value: T): T { return structuredClone(value); }
export function semanticMachine(machine: Machine): Machine {
  const copy = MachineSchema.parse(machine);
  copy.states.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  copy.transitions.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (copy.planning) copy.planning.tasks = Object.fromEntries(Object.entries(copy.planning.tasks).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([id, task]) => [id, { ...task, ...(task.dependsOn ? { dependsOn: [...new Set(task.dependsOn)].sort() } : {}) }]));
  return copy;
}

export function importProject(value: unknown): Project {
  const packaged = DraftProjectSchema.safeParse(value);
  if (packaged.success) return packaged.data;
  const machine = MachineSchema.parse(value);
  const layout = Object.fromEntries(machine.states.map((state, i) => [state.id, { x: (i % 3) * 340 + 50, y: Math.floor(i / 3) * 200 + 70 }]));
  return { format: 'decoupleflow-project', schemaVersion: 1, machine, layout };
}
