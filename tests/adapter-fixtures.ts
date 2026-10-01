import type { Machine } from '../src/domain/types';
import { runtime, type RunRecord, type Decision } from '../src/domain/runtime';
const evidence = '原任务 job-42 已成功完成，本次结果已检查。';
export function answer(machine: Machine, record: RunRecord, id: string, overrides: Partial<Decision> = {}): Decision {
  const path = runtime.candidates(machine, record).find(c => c.id === id);
  return { transitionId: id, conditionMet: true, targetEntryMet: true, passedQuality: path?.requiredQuality ?? [], evidence, ...overrides };
}
export function jevResponse(request: ReturnType<typeof runtime.buildJevRequest>, choice: string, probability = 0.99, confidence = 0.98) {
  const criteria = Object.keys(request.questions.route.criteria!);
  return { model: 'jev-test', answers: Object.fromEntries(Object.entries(request.questions).map(([key, value]) => [key, value.type === 'choice' ? { type: 'choice', choice, confidence, probabilities: Object.fromEntries(criteria.map(id => [id, id === choice ? probability : (1 - probability) / (criteria.length - 1)])) } : { type: 'noul', noul: 0.99 }])), usage: { input_tokens: 10, output_tokens: 0 } };
}
