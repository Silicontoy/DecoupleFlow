import { expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createTemplate } from '../src/domain/templates';
import { connectionPorts, retainConnectionPorts } from '../src/editor/connections';
import { importProject } from '../src/domain/types';
import { buildSkillBundle } from '../src/domain/compiler';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

it('migrates legacy ports once and retains them across dragging and saved project reloads', async () => {
  const project = createTemplate('simple'); const before = await buildSkillBundle(project.machine);
  const edge = project.machine.transitions[0];
  project.layout[edge.to].y = project.layout[edge.from].y + 250;
  retainConnectionPorts(project);
  expect(connectionPorts(project, edge)).toEqual({ sourceHandle: 'out-bottom', targetHandle: 'in-top' });
  for (const y of [0, 169, 171, -100, 400]) {
    project.layout[edge.to].y = project.layout[edge.from].y + y;
    retainConnectionPorts(project);
    expect(connectionPorts(project, edge)).toEqual({ sourceHandle: 'out-bottom', targetHandle: 'in-top' });
  }
  expect(importProject(JSON.parse(JSON.stringify(project))).connections).toEqual(project.connections);
  expect((await buildSkillBundle(project.machine)).semanticHash).toBe(before.semanticHash);
});

it('honors explicit top/bottom ports and removes layouts for deleted transitions', () => {
  const project = createTemplate('simple'); const edge = project.machine.transitions[0];
  project.connections = { [edge.id]: { sourceHandle: 'out-bottom', targetHandle: 'in' } };
  retainConnectionPorts(project);
  expect(connectionPorts(project, edge)).toEqual({ sourceHandle: 'out-bottom', targetHandle: 'in' });
  project.machine.transitions = project.machine.transitions.filter(t => t.id !== edge.id);
  retainConnectionPorts(project);
  expect(project.connections[edge.id]).toBeUndefined();
});
