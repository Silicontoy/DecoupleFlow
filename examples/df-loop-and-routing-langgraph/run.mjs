import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Command } from '@langchain/langgraph';
import { createWorkflow, makeInput } from './workflow.mjs';
const graph = createWorkflow();
const config = { configurable: { thread_id: 'interactive-example' }, recursionLimit: 1000 };
const rl = createInterface({ input: stdin, output: stdout });
try {
  let result = await graph.invoke(makeInput(''), config);
  while (result.__interrupt__?.length) {
    console.log(JSON.stringify(result.__interrupt__.map(i => i.value), null, 2));
    const text = await rl.question('Resume with JSON > ');
    let resume;
    try { resume = JSON.parse(text); } catch { console.error('Please enter valid JSON.'); continue; }
    result = await graph.invoke(new Command({ resume }), config);
  }
  console.log(JSON.stringify(result, null, 2));
} finally { rl.close(); }
