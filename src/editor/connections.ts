import type { Project, Transition } from '../domain/types';

export function connectionPorts(project: Project, transition: Transition) {
  const saved = project.connections?.[transition.id];
  if (saved) return saved;
  const from = project.layout[transition.from], to = project.layout[transition.to];
  const downward = (to?.y ?? 100) - (from?.y ?? 100) > 170;
  return { sourceHandle: downward ? 'out-bottom' as const : 'out' as const, targetHandle: downward ? 'in-top' as const : 'in' as const };
}

// Choose legacy ports once, before any dragging, then save them with the layout.
// Port placement never affects the semantic definition or an active run's hash.
export function retainConnectionPorts(project: Project): Project {
  project.connections = Object.fromEntries(project.machine.transitions.map(t => [t.id, connectionPorts(project, t)]));
  return project;
}
