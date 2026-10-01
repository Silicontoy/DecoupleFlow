import type { Language } from '../i18n/translate';
import { useEffect, useReducer, useState } from 'react';
import { z } from 'zod';
import { DraftProjectSchema, clone, newId, type Project } from '../domain/types';
import { createTemplate, type TemplateId } from '../domain/templates';
import { retainConnectionPorts } from './connections';

const STORAGE_KEY = 'decoupleflow.workspace.v1';
// A partially edited machine identifier is a valid draft, even before it can be exported.
const WorkspaceSchema = z.object({ version: z.literal(1), active: z.string(), documents: z.array(z.object({ key: z.string(), project: DraftProjectSchema })).min(1).max(100) });
type Workspace = z.infer<typeof WorkspaceSchema>;
type Model = { workspace: Workspace; past: Project[]; future: Project[]; historyKey: string; historyTime: number; recovery: boolean };
type Action =
  | { type: 'edit'; update: (project: Project) => void; key?: string; time: number; silent?: boolean }
  | { type: 'add'; project: Project }
  | { type: 'switch'; key: string }
  | { type: 'delete'; key: string; language: Language }
  | { type: 'undo' | 'redo' | 'checkpoint' };

function initialModel(language: Language): Model {
  let recovery = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = WorkspaceSchema.safeParse(JSON.parse(raw));
      if (parsed.success && parsed.data.documents.some(d => d.key === parsed.data.active)) {
        parsed.data.documents.forEach(d => retainConnectionPorts(d.project));
        return { workspace: parsed.data, past: [], future: [], historyKey: '', historyTime: 0, recovery };
      }
      localStorage.setItem(`${STORAGE_KEY}.recovery`, raw);
      recovery = true;
    }
  } catch { recovery = true; }
  return { workspace: { version: 1, active: 'welcome', documents: [{ key: 'welcome', project: retainConnectionPorts(createTemplate('analysis', language)) }] }, past: [], future: [], historyKey: '', historyTime: 0, recovery };
}
function reducer(model: Model, action: Action): Model {
  const { workspace } = model;
  const current = workspace.documents.find(d => d.key === workspace.active)!;
  const replace = (project: Project) => ({ ...workspace, documents: workspace.documents.map(d => d.key === workspace.active ? { ...d, project } : d) });
  if (action.type === 'edit') {
    const project = retainConnectionPorts(clone(current.project)); action.update(project); retainConnectionPorts(project);
    if (JSON.stringify(project) === JSON.stringify(current.project)) return model;
    const coalesce = action.key && action.key === model.historyKey && action.time - model.historyTime < 1200;
    return { ...model, workspace: replace(project), past: action.silent || coalesce ? model.past : [...model.past.slice(-59), current.project], future: [], historyKey: action.key ?? '', historyTime: action.time };
  }
  if (action.type === 'checkpoint') return { ...model, past: [...model.past.slice(-59), clone(current.project)], future: [], historyKey: '', historyTime: 0 };
  if (action.type === 'undo' && model.past.length) return { ...model, workspace: replace(model.past.at(-1)!), past: model.past.slice(0, -1), future: [current.project, ...model.future], historyKey: '', historyTime: 0 };
  if (action.type === 'redo' && model.future.length) return { ...model, workspace: replace(model.future[0]), past: [...model.past, current.project], future: model.future.slice(1), historyKey: '', historyTime: 0 };
  if (action.type === 'switch' && workspace.documents.some(d => d.key === action.key)) return { ...model, workspace: { ...workspace, active: action.key }, past: [], future: [], historyKey: '', historyTime: 0 };
  if (action.type === 'add') {
    const key = newId('doc'); const project = retainConnectionPorts(clone(action.project));
    if (workspace.documents.some(d => d.project.machine.id === project.machine.id)) project.machine.id = `${project.machine.id.slice(0, 48)}-${key.slice(-8)}`;
    return { ...model, workspace: { ...workspace, active: key, documents: [...workspace.documents, { key, project }] }, past: [], future: [], historyKey: '', historyTime: 0 };
  }
  if (action.type === 'delete') {
    const documents = workspace.documents.filter(d => d.key !== action.key);
    if (!documents.length) documents.push({ key: newId('doc'), project: createTemplate('blank', action.language) });
    return { ...model, workspace: { ...workspace, documents, active: action.key === workspace.active ? documents[0].key : workspace.active }, past: [], future: [], historyKey: '', historyTime: 0 };
  }
  return model;
}

export function useWorkspace(language: Language) {
  const [model, dispatch] = useReducer(reducer, language, initialModel);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  useEffect(() => {
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model.workspace)); setSaveStatus('saved'); }
      catch { setSaveStatus('error'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [model.workspace]);
  useEffect(() => {
    const persist = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model.workspace)); } catch { /* Visible save status already explains export fallback. */ } };
    window.addEventListener('pagehide', persist);
    return () => window.removeEventListener('pagehide', persist);
  }, [model.workspace]);
  return {
    ...model.workspace, project: model.workspace.documents.find(d => d.key === model.workspace.active)!.project,
    saveStatus, recovery: model.recovery, canUndo: model.past.length > 0, canRedo: model.future.length > 0,
    edit: (update: (project: Project) => void, key?: string, silent = false) => dispatch({ type: 'edit', update, key, time: Date.now(), silent }),
    checkpoint: () => dispatch({ type: 'checkpoint' }), undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    add: (project: Project) => dispatch({ type: 'add', project }),
    create: (id: TemplateId) => dispatch({ type: 'add', project: createTemplate(id, language) }),
    switchTo: (key: string) => dispatch({ type: 'switch', key }), remove: (key: string) => dispatch({ type: 'delete', key, language }),
  };
}
