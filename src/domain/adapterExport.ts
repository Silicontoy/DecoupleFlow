import { localizeStaticTemplate } from '../i18n/portable';
import type { Language } from '../i18n/translate';
import { portableRuntimeSource } from './runtime';
import { portableJevSource } from './jev';

export function adapterModule(language: Language = 'zh') { return portableRuntimeSource(language) + '\nexport { runtime };\n' + localizeStaticTemplate(portableJevSource(), language); }

export const skillAdapterCli = `import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runtime, requestJev } from './adapter.mjs';
const args = process.argv.slice(2);
const arg = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
try {
  const definition = await readFile(new URL('../references/state-machine.json', import.meta.url), 'utf8');
  const machine = JSON.parse(definition);
  const hash = createHash('sha256').update(definition).digest('hex');
  if (!arg('--record') || !arg('--context')) throw new Error('用法：node scripts/decide.mjs --record /path/record.json --context /path/evidence.txt');
  const record = JSON.parse(await readFile(arg('--record'), 'utf8'));
  const context = await readFile(arg('--context'), 'utf8');
  runtime.assertRecord(machine, record, hash);
  if (runtime.settings(machine).type !== 'jev') throw new Error('当前定义未选择 Jev。');
  const response = await requestJev(runtime.buildJevRequest(machine, record, context), process.env.TYPESAFE_API_KEY || '');
  const result = runtime.interpretJev(machine, record, context, response, hash);
  process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
} catch (error) { process.stderr.write(error.message + '\\n'); process.exitCode = 1; }
`;

export const adapterInstructions = `## Jev 推进方式

本定义选择 Jev，由 DecoupleFlow 提供官方 Adapter。宿主 Agent 完成节点工作、收集实际证据，再调用 Adapter 判断迁移。

1. 在宿主进程环境变量配置 TYPESAFE_API_KEY；需要 Node.js 18.18+。密钥不写入 Skill、实例记录或提示词。
2. 把本次事实、外部任务状态和结果引用写入实例目录中的 evidence.txt。不要把预期结果或上轮结论当作本轮事实。
3. 执行（脚本路径相对于 Skill 目录，实例文件使用绝对路径）：

\`\`\`bash
node scripts/decide.mjs --record /path/to/instance/state-record.json --context /path/to/instance/evidence.txt
\`\`\`

4. 脚本将当前节点、候选路径、证据与最近迁移发送到 TypeSafe。stdout 返回 status、reason、record 和条件概率；只有 advanced/completed 才用返回的 record 更新实例。held、网络异常或接口错误时保持原记录，按节点策略补充证据或等待。
5. 返回结果只决定状态迁移。工具连接、外部执行、挂起恢复与实例文件写入由宿主管理；Adapter 不执行节点业务动作。

通过概率与置信度门槛、路径质量引用、子状态机进入/返回及循环判断都由脚本检查。可在 DecoupleFlow 切回自己的 Agent，再重新导出定义。不要在 Jev 不可用时静默更换决策方式。
`;
