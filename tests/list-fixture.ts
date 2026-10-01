import { createTemplate } from '../src/domain/templates';

export function listFixture() {
  const project = createTemplate('simple', 'en');
  const { machine } = project;
  machine.id = 'ordered-review'; machine.name = 'Ordered review'; machine.initialState = 'work';
  machine.states = machine.states.filter(state => state.id !== 'prepare');
  const work = machine.states.find(state => state.id === 'work')!;
  work.kind = 'list'; work.name = 'Release checklist'; work.entryConditions = 'Materials are ready.';
  work.list = { items: [{ id: 'data', text: 'Verify data' }, { id: 'copy', text: 'Review copy' }, { id: 'links', text: 'Check links' }], passCondition: 'The current item has been verified against its source.' };
  work.qualityConditions = [{ id: 'verified', text: 'Evidence is available for this item.', required: true }];
  machine.transitions = [{ id: 'exit', from: 'work', to: 'done', condition: 'The full report is approved.', kind: 'normal', requiredQuality: [], onUncertain: 'Stay.' }, { id: 'again', from: 'work', to: 'work', condition: 'A new review was requested.', kind: 'fallback', requiredQuality: [], onUncertain: 'Stay.' }];
  project.layout = { work: { x: 40, y: 80 }, done: { x: 450, y: 80 } };
  return project;
}
