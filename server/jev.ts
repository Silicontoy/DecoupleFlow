import { z } from 'zod';
import { hashText } from '../src/domain/compiler';
import { MachineSchema, semanticMachine } from '../src/domain/types';
import { runtime, type RunRecord } from '../src/domain/runtime';
import { requestJev } from '../src/domain/jev';
import { validateMachine } from '../src/domain/validate';
import { InstallError } from './installer';

export type JevEnvironment = { apiKey?: string; fetcher?: typeof fetch };
const inputSchema = z.object({ machine: MachineSchema, record: z.object({}).passthrough(), context: z.string().trim().min(1).max(100000), apiKey: z.string().max(4096).optional() });
export async function decideWithJev(input: unknown, env: JevEnvironment = {}) {
  const { machine, record, context, apiKey } = inputSchema.parse(input);
  if (machine.driver?.type !== 'jev') throw new InstallError('当前状态机选择的是用户 Agent，请先切换到 Jev Adapter。');
  const errors = validateMachine(machine).filter(d => d.level === 'error');
  if (errors.length) throw new InstallError(errors[0].message);
  const definitionHash = await hashText(JSON.stringify(semanticMachine(machine), null, 2) + '\n');
  try {
    runtime.assertRecord(machine, record as RunRecord, definitionHash);
    if ((record as RunRecord).status === 'completed') throw new Error('实例已经结束。');
    const payload = runtime.buildJevRequest(machine, record as RunRecord, context);
    const key = apiKey?.trim() || env.apiKey || process.env.TYPESAFE_API_KEY || '';
    const response = await requestJev(payload, key, env.fetcher);
    return runtime.interpretJev(machine, record as RunRecord, context, response, definitionHash);
  } catch (error) { throw new InstallError(error instanceof Error ? error.message : 'Jev 判断未完成，当前位置未改变。', 422); }
}
