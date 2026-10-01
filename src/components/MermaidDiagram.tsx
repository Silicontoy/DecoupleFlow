import { useI18n } from '../i18n';
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Loader2 } from 'lucide-react';

let counter = 0;
let renderer: Promise<typeof import('mermaid')['default']> | undefined;
function getRenderer() {
  renderer ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxEdges: 1600, maxTextSize: 6000000, theme: 'base', fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif', themeVariables: { primaryColor: '#e4f4ee', primaryTextColor: '#315b50', primaryBorderColor: '#6bb39e', lineColor: '#73978a', fontSize: '13px', secondaryColor: '#f2f7f5', tertiaryColor: '#ffffff' }, state: { useMaxWidth: false } });
    return mermaid;
  }).catch(error => { renderer = undefined; throw error; });
  return renderer;
}
export function MermaidDiagram({ source }: { source: string }) {
  const { t: tr } = useI18n();
  const target = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setStatus('loading'); setError('');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await getRenderer();
          if (!active) return;
          await document.fonts.ready;
          const result = await mermaid.render(`df-state-diagram-${++counter}`, source, target.current ?? undefined);
          if (active && target.current) { target.current.innerHTML = result.svg; setStatus('ready'); }
        } catch (error) { if (active) { setError((error as Error).message); setStatus('error'); } }
      })();
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [source]);
  return <div className={`mermaid-diagram ${status}`} data-testid="state-diagram" aria-label={tr("完整状态机图")} aria-busy={status === 'loading'}>
    {status === 'loading' && <div className="diagram-status"><Loader2 size={16} className="spin" />{tr("生成状态机总览…")}</div>}
    {status === 'error' && <div className="diagram-status error"><AlertCircle size={16} /><span>{tr("图形预览失败，仍可查看 Markdown 源码。")}{error.slice(0, 180)}</span></div>}
    <div ref={target} className="mermaid-svg" hidden={status === 'error'} />
  </div>;
}
function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: ReactNode }>(child) && child.props.className === 'language-mermaid') {
    const source = String(child.props.children ?? '');
    if (/^stateDiagram-v2\s/.test(source.trimStart())) return <MermaidDiagram source={source} />;
  }
  return <pre>{children}</pre>;
}
const components = { pre: MarkdownPre };
export function MarkdownDocument({ children }: { children: string }) { return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>; }
