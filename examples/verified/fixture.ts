import { newState, type Machine } from '../../src/domain/types';

// The same small, inspectable definition is exported to every adapter.
export function verificationMachine(): Machine {
  return {
    schemaVersion: 1, id: 'adapter-verification', name: 'Release checklist', version: '1.0.0',
    purpose: 'Verify three release artifacts in order, with one shared quality gate.', initialState: 'review',
    states: [
      { ...newState('list', 'review', 'Review release'), description: 'Check each artifact once, then approve the report.',
        list: { items: [{ id: 'license', text: 'Check the MIT license' }, { id: 'tests', text: 'Check the test report' }, { id: 'docs', text: 'Check the README' }], passCondition: 'The current artifact exists and its content has been checked.' },
        qualityConditions: [{ id: 'evidence', text: 'The evidence identifies the checked artifact and its result.', required: true }] },
      { ...newState('end', 'done', 'Ready'), description: 'All three artifacts were checked and the release report is approved.' },
    ],
    transitions: [{ id: 'approved', from: 'review', to: 'done', condition: 'All three artifacts passed and the release report is approved.', requiredQuality: ['evidence'], kind: 'normal', onUncertain: 'Wait for the report.' }],
  };
}
