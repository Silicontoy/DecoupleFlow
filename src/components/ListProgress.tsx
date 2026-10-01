import { useI18n } from '../i18n';
import { runtime, type RunRecord } from '../domain/runtime';
import type { Machine } from '../domain/types';

export function ListProgress({ machine, record }: { machine: Machine; record: RunRecord }) {
  const { t: tr } = useI18n();
  const progress = runtime.listProgress(machine, record);
  if (!progress) return null;
  return <section className="list-progress" aria-label={tr("列表进度")}>
    <div className="list-progress-heading"><strong>{tr("列表进度")}</strong><span>{tr("已通过 {0}/{1} 项", { "0": progress.completed, "1": progress.total })}</span></div>
    <progress max={Math.max(1, progress.total)} value={progress.completed} aria-label={tr("列表进度")} />
    <ol>{progress.items.map((item, index) => <li key={item.id} className={index < progress.completed ? 'passed' : index === progress.completed ? 'current' : ''} aria-current={index === progress.completed ? 'step' : undefined}><span>{index < progress.completed ? '✓' : index + 1}</span><div>{item.text}</div></li>)}</ol>
    {!progress.currentItem && progress.total > 0 && <p>{tr("全部事项已通过，等待出口条件。")}</p>}
    <p className="shared-condition"><strong>{tr("统一通过条件")}</strong><br />{progress.passCondition}</p>
  </section>;
}
