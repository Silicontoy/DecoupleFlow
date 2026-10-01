/** A dependency-free helper shipped with each Skill. Business work stays in the host Agent. */
export const skillRunnerSource = String.raw`import { readFile, writeFile, rename, mkdir, rm, open, readdir } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtime, requestJev } from './adapter.mjs';
const exec = promisify(execFile);
const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
export async function save(path, data) { const temp = path + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rename(temp, path); }
export async function loadInstance(folder) {
  const definition = await readFile(join(folder, 'definition.json'), 'utf8');
  const machine = JSON.parse(definition), record = await json(join(folder, 'state-record.json')), session = await json(join(folder, 'session.json'));
  runtime.assertRecord(machine, record, hash(definition));
  return { machine, record, session };
}
async function locked(folder, action) {
  const path = join(folder, '.lock'); let lock;
  try { lock = await open(path, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw new Error('实例正在更新，请稍后重试；不要重复执行业务任务。'); throw e; }
  try { return await action(); } finally { await lock.close(); await rm(path, { force: true }); }
}
async function emit(folder, record, type, detail, actor) {
  const event = { id: randomUUID(), at: new Date().toISOString(), type, stateId: record.currentState, actor, detail };
  await writeFile(join(folder, 'events.jsonl'), JSON.stringify(event) + '\n', { flag: 'a', mode: 0o600 });
}
async function archive(folder, record, session, reason) {
  if (session.archivedAt) return;
  session.archivedAt = new Date().toISOString(); session.archiveReason = reason; session.phase = record.status === 'completed' ? 'completed' : 'archived'; session.paused = false; session.stepBudget = 0;
  await save(join(folder, 'session.json'), session);
  await rm(join(dirname(folder), '.active', record.instanceId + '.json'), { force: true });
  await emit(folder, record, 'run.archived', reason, session.actor);
}
function settings(machine) { return machine.visualization || { enabled: true, autoOpen: true }; }
async function browser(url) {
  try {
    if (process.platform === 'win32') await exec('rundll32.exe', ['url.dll,FileProtocolHandler', url], { timeout: 5000 });
    else if (process.platform === 'darwin') await exec('open', [url], { timeout: 5000 });
    else if (process.env.WSL_DISTRO_NAME || /microsoft/i.test(await readFile('/proc/version', 'utf8').catch(() => ''))) {
      await exec('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process "' + url + '"'], { timeout: 5000 });
    } else await exec('xdg-open', [url], { timeout: 5000 });
    return true;
  } catch { return false; }
}
async function monitor(folder, machine, session, force = false, noOpen = false) {
  const config = session.visualization || settings(machine);
  if (!config.enabled && !force) return { visualization: 'disabled' };
  const file = join(folder, 'monitor.json'); let info;
  try { const existing = await json(file); if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(existing.origin) || !/^[a-f0-9]{64}$/.test(existing.token)) throw new Error('窗口连接信息无效'); const response = await fetch(existing.origin + '/snapshot', { headers: { 'X-DecoupleFlow-Run-Token': existing.token }, signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).record.instanceId === session.instanceId) info = existing; } catch {}
  if (!info) {
    // Each instance owns its monitor. Detached monitors expire after completion or inactivity.
    const lockPath = join(folder, '.monitor-lock'); let lock;
    try { lock = await open(lockPath, 'wx', 0o600); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (lock) {
      try {
        await rm(file, { force: true });
        const child = spawn(process.execPath, [join(skillRoot, 'scripts/monitor.mjs'), folder], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {}); child.unref();
        for (let i = 0; i < 50; i++) { try { info = await json(file); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
      } finally { await lock.close(); await rm(lockPath, { force: true }); }
    } else { for (let i = 0; i < 50; i++) { try { info = await json(file); break; } catch { await new Promise(r => setTimeout(r, 100)); } } }
    if (!info) return { visualization: 'unavailable', warning: '实时窗口未能启动，实例记录仍已保存。可执行 view 重试。' };
  }
  const url = info.origin + '/#' + info.token;
  const opened = config.autoOpen && !noOpen ? await browser(url) : false;
  return { visualization: 'ready', viewerUrl: url, browserOpened: opened, ...(!opened && config.autoOpen && !noOpen ? { warning: '系统未能打开浏览器，请打开 viewerUrl。' } : {}) };
}
export async function runCommand(args) {
  const command = args[0];
  const arg = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  if (!['start', 'resume', 'view', 'status', 'event', 'advance', 'control', 'archive', 'fork', 'list'].includes(command)) throw new Error('用法：run.mjs start --workspace <任务目录> | resume/view/status/event/advance/archive/fork --instance <实例目录> | list --workspace <任务目录>');
  if (command === 'start' || command === 'list') {
    if (!arg('--workspace') || !isAbsolute(arg('--workspace'))) throw new Error('--workspace 需要当前任务工作区的绝对路径。');
    const text = await readFile(join(skillRoot, 'references/state-machine.json'), 'utf8');
    const machine = JSON.parse(text), manifest = await json(join(skillRoot, 'decoupleflow-manifest.json'));
    if (hash(text) !== manifest.semanticHash) throw new Error('Skill 定义与清单不一致，请重新导出。');
    const base = join(arg('--workspace'), '.decoupleflow', machine.id);
    if (command === 'list') {
      const names = await readdir(base).catch(() => []), instances = [];
      for (const name of names) { try { const s = await json(join(base, name, 'session.json')); instances.push({ ...s, instance: join(base, name) }); } catch {} }
      return { instances: instances.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }
    const id = randomUUID(), folder = join(base, id), record = runtime.initialRecord(machine, hash(text), id);
    const visualization = { ...settings(machine) };
    if (arg('--visualization')) { if (!['on', 'off'].includes(arg('--visualization'))) throw new Error('--visualization 仅支持 on 或 off。'); visualization.enabled = arg('--visualization') === 'on'; }
    const session = { instanceId: id, machineId: machine.id, createdAt: new Date().toISOString(), actor: (arg('--actor') || '宿主 Agent').slice(0, 120), visualization, phase: 'running', paused: false, stepBudget: 0 };
    await mkdir(join(base, '.active'), { recursive: true }); await mkdir(folder);
    await writeFile(join(folder, 'definition.json'), text, { mode: 0o600 });
    await writeFile(join(folder, 'state-machine.md'), await readFile(join(skillRoot, 'references/state-machine.md')), { mode: 0o600 });
    await save(join(folder, 'state-record.json'), record); await save(join(folder, 'session.json'), session);
    await save(join(base, '.active', id + '.json'), { instance: folder, instanceId: id });
    await emit(folder, record, 'run.started', '宿主调用 Skill，创建新实例。', session.actor);
    await emit(folder, record, 'state.entered', runtime.getState(machine, record.currentState).name, session.actor);
    return { instance: folder, record, handoff: runtime.handoff(machine, record, ''), ...await monitor(folder, machine, session, false, args.includes('--no-open')) };
  }
  const folder = arg('--instance'); if (!folder || !isAbsolute(folder)) throw new Error('--instance 需要 start 返回的实例目录绝对路径。');
  if (['status', 'resume', 'view'].includes(command)) {
    const { machine, record, session } = await loadInstance(folder);
    if (record.status === 'completed' && !session.archivedAt) await archive(folder, record, session, '实例已完成，补全归档');
    if (command === 'resume' && (session.archivedAt || record.status === 'completed')) throw new Error('实例已归档，只能查看；新任务请使用 start 创建新实例。');
    return { instance: folder, record, session, handoff: record.status === 'completed' ? null : runtime.handoff(machine, record, ''), ...(command === 'status' ? {} : await monitor(folder, machine, session, command === 'view', args.includes('--no-open'))) };
  }
  if (command === 'fork') return locked(folder, async () => {
    const { machine, record, session } = await loadInstance(folder);
    if (record.status === 'completed' || session.archivedAt) throw new Error('已归档实例只能查看；重新运行请从入口 start。');
    const id = randomUUID(), child = join(dirname(folder), id), next = { ...record, instanceId: id };
    const childSession = { ...session, instanceId: id, createdAt: new Date().toISOString(), forkedFrom: record.instanceId, paused: false, stepBudget: 0 };
    await mkdir(child); await writeFile(join(child, 'definition.json'), await readFile(join(folder, 'definition.json'))); await writeFile(join(child, 'state-machine.md'), await readFile(join(folder, 'state-machine.md')));
    await save(join(child, 'state-record.json'), next); await save(join(child, 'session.json'), childSession); await mkdir(join(dirname(folder), '.active'), { recursive: true }); await save(join(dirname(folder), '.active', id + '.json'), { instance: child, instanceId: id });
    await emit(child, next, 'run.forked', '从 ' + record.instanceId + ' 分叉。需由宿主显式恢复此实例。', session.actor);
    return { instance: child, record: next, ...await monitor(child, machine, childSession, true, args.includes('--no-open')) };
  });
  return locked(folder, async () => {
    const { machine, record, session } = await loadInstance(folder);
    if (session.archivedAt || record.status === 'completed') { await archive(folder, record, session, '实例已完成'); if (command === 'archive') return { record, session }; throw new Error('实例已归档，不能继续写入。新任务使用 start，查看使用 view。'); }
    if (command === 'archive') { await archive(folder, record, session, '宿主结束本次实例'); return { record, session }; }
    if (command === 'control') {
      const action = arg('--action'); if (!['pause', 'continue', 'step'].includes(action)) throw new Error('未知控制动作。');
      session.paused = action !== 'continue'; session.stepBudget = action === 'step' ? 1 : 0;
      await save(join(folder, 'session.json'), session); await emit(folder, record, 'run.' + action, action === 'step' ? '允许宿主下一次提交迁移，随后保持暂停。' : action === 'pause' ? '已暂停后续状态迁移，外部业务由宿主管理。' : '允许宿主继续提交迁移。', session.actor);
      return { record, session };
    }
    if (command === 'event') {
      const event = JSON.parse(arg('--event-json') || await readFile(arg('--event'), 'utf8'));
      if (!['agent.started', 'agent.completed', 'external.waiting', 'external.completed', 'human.required', 'run.failed', 'run.timeout'].includes(event.type)) throw new Error('未知事件类型。');
      const detail = String(event.detail || '').slice(0, 4000);
      session.phase = event.type === 'external.waiting' ? 'waiting' : event.type === 'human.required' ? 'human' : event.type === 'run.failed' ? 'failed' : event.type === 'run.timeout' ? 'timeout' : 'running';
      if (event.type === 'external.waiting') record.pendingExternalTask = { detail, actor: session.actor };
      else if (event.type === 'external.completed') record.pendingExternalTask = null;
      await save(join(folder, 'state-record.json'), record); await save(join(folder, 'session.json'), session);
      await emit(folder, record, event.type, detail, session.actor); return { record, session };
    }
    if (session.paused && !session.stepBudget) return { status: 'paused', reason: '实例已暂停。保留本次结果，等待继续或单步授权后再提交；不要重做业务任务。', record };
    const context = arg('--context') ? await readFile(arg('--context'), 'utf8') : '';
    if (context.length > 100000) throw new Error('本次证据超过 100000 字符。');
    const driver = runtime.settings(machine); let result;
    await emit(folder, record, 'guard.started', driver.type === 'jev' ? 'Jev 检查本次实际证据。' : '检查宿主提交的路径与质量结论。', session.actor);
    try {
      if (driver.type === 'jev') result = runtime.interpretJev(machine, record, context, await requestJev(runtime.buildJevRequest(machine, record, context), process.env.TYPESAFE_API_KEY || ''), record.definitionHash);
      else { if (!arg('--decision')) throw new Error('自己的 Agent 模式需要 --decision <本次决策 JSON 文件>。'); result = runtime.applyDecision(machine, record, JSON.parse(await readFile(arg('--decision'), 'utf8')), record.definitionHash); }
      if (session.stepBudget) session.stepBudget--;
      session.phase = result.status === 'held' ? (runtime.getState(machine, record.currentState).kind === 'wait' ? 'waiting' : 'human') : result.status === 'completed' ? 'completed' : runtime.getState(machine, result.record.currentState).kind === 'wait' ? 'waiting' : 'running';
      await save(join(folder, 'result.json'), result); await save(join(folder, 'state-record.json'), result.record); await save(join(folder, 'session.json'), session);
      await emit(folder, result.record, 'guard.evaluated', result.reason, driver.type === 'jev' ? 'Jev' : session.actor);
      if (result.status !== 'held') {
        if (result.record.history.at(-1)?.itemId) await emit(folder, result.record, 'list.item.passed', result.reason, session.actor);
        else { await emit(folder, result.record, 'transition.taken', record.currentState + ' → ' + result.record.currentState, session.actor); await emit(folder, result.record, result.status === 'completed' ? 'run.completed' : 'state.entered', runtime.getState(machine, result.record.currentState).name, session.actor); }
      }
      if (result.status === 'completed') await archive(folder, result.record, session, '顶层结束状态已确认完成');
      return { ...result, instance: folder, handoff: result.status === 'completed' ? null : runtime.handoff(machine, result.record, '') };
    } catch (error) { await emit(folder, record, 'guard.failed', error.message, session.actor); throw error; }
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(await runCommand(process.argv.slice(2)), null, 2) + '\n'); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
`;

export const executionInstructions = `## 实例与实时展示

需要 Node.js 18.18+。运行助手只维护状态和展示实际事件；业务工作仍由宿主自主完成。

1. 每个新任务先执行下方 start。它总是创建新实例，不会复用上次已完成的记录。脚本路径相对于本 Skill 安装目录，工作区是用户当前任务的目录，不能填 Skill 目录或 DecoupleFlow 源码目录。

\`\`\`bash
node scripts/run.mjs start --workspace /absolute/task/workspace --actor "宿主 Agent 名称"
\`\`\`

2. 保存返回的 instance 绝对路径，后续命令使用该路径。定义与总 Markdown 会固定到实例目录，不要把任务状态写进 Skill 安装目录。开启可视化后，助手启动独立本地窗口，无需预先打开编辑器；若 browserOpened 为 false，先使用宿主可用的打开浏览器或预览工具打开 viewerUrl；宿主也没有此能力时再向用户提供链接并说明限制。关闭可视化可在导出前设置，或本次 start 加 --visualization off。
3. 使用返回的 handoff 读取当前目标、候选路径与 decisionFormat，执行节点工作。需要等待、人工检查或报告失败时，将实际事件写入 JSON 文件并提交：

\`\`\`bash
node scripts/run.mjs event --instance /absolute/instance --event /absolute/event.json
\`\`\`

事件示例：\`{"type":"external.waiting","detail":"等待原任务 job-42，尚未完成"}\`。支持 agent.started、agent.completed、external.waiting、external.completed、human.required、run.failed、run.timeout。只报告实际发生的事件。

4. 自己的 Agent 判断本次条件后，按 handoff.decisionFormat 写入决策文件，再使用 advance 提交。Jev 模式仅传本次证据文件，并在宿主环境配置 TYPESAFE_API_KEY，不传 --decision。没有证据或检查未通过时保持当前状态。

\`\`\`bash
node scripts/run.mjs advance --instance /absolute/instance --decision /absolute/decision.json --context /absolute/evidence.txt
\`\`\`

5. 只以返回的 record / handoff 为后续依据。助手自动写入记录并更新窗口，不要另外手工改文件。paused 时保留业务产出，等待窗口继续或单步后重提判断，不能重新执行已完成的业务；held 时补充证据。顶层结束状态需要最后一次 __finish__ 判断，完成后自动归档、释放活动实例。新请求重新 start，不复用已结束实例。
6. 用户明确继续某个未完成任务时，执行 resume --instance <原目录>；它保留原定义、状态与外部任务 ID。查看历史用 view --instance <目录>，列出历史用 list --workspace <任务目录>，主动结束未完成实例用 archive --instance <目录>。已归档记录只供查看；新任务从入口开始。fork --instance <目录> 创建当前位置的独立副本，需宿主明确使用返回目录继续。

运行窗口的暂停与单步控制的是后续状态迁移，外部任务由宿主控制。窗口展示当前状态、循环与分支、Jev 判断和实际事件；关闭窗口不取消任务。完成后本地展示进程自动释放，历史文件保留。没有 Node 或图形环境时明确告知限制，按状态机说明维护独立记录，不声称已展示。
`;
