import type { Language } from '../i18n/translate';
import { newState, type Project, type State, type Transition } from './types';

export const DEMO_IDS = ['bugfix', 'research', 'release'] as const;
export type DemoId = typeof DEMO_IDS[number];
export const DEMO_TEMPLATES = [
  { id: 'bugfix' as const, name: '修复 Bug 并验证', description: '复现失败 → 修复 → 逐项回归；测试通过才交付', count: '5 个状态' },
  { id: 'research' as const, name: '带来源的选型简报', description: '阅读三份资料 → 对比选型；每条结论可追溯', count: '5 个状态' },
  { id: 'release' as const, name: '发布前逐项验收', description: '逐项检查 → 等待 CI → 人工批准；关闭后可继续', count: '5 个状态' },
];

/** Useful, small examples: host-owned work, explicit evidence, and observable exits. */
export function createDemo(id: DemoId, language: Language = 'en'): Project {
  const t = (en: string, zh: string) => language === 'en' ? en : zh;
  const state = (kind: State['kind'], id: string, name: string, description: string, extra: Partial<State> = {}): State => ({
    ...newState(kind, id, name), description,
    strategies: { during: t('Use the host agent and record concise evidence in the task workspace.', '使用宿主 Agent 完成工作，在任务目录保存简要证据。'), onFailure: t('Record the concrete gap; do not mark it as passed.', '记录具体缺口，不将失败标记为通过。'), onUncertain: t('Keep this state and ask for the missing information.', '保留当前状态，补充缺失信息。') }, ...extra,
  });
  const quality = (id: string, text: string) => ({ id, text, required: true });
  const edge = (id: string, from: string, to: string, condition: string, requiredQuality: string[] = [], kind: Transition['kind'] = 'normal'): Transition => ({ id, from, to, condition, requiredQuality, kind, onUncertain: t('Hold this state until the evidence supports this path.', '证据能够支持这条路径之前，保留当前状态。') });
  let name: string, purpose: string, initialState: string, states: State[], transitions: Transition[];
  let layout: Project['layout'];
  if (id === 'bugfix') {
    name = t('Fix a bug, prove it', '修复 Bug 并验证');
    purpose = t('Fix a cart total that ignores quantity. Deliver a focused patch and a regression report, with actual before/after test results.', '修复购物车合计忽略数量的问题，交付最小改动和回归报告，并保留修复前后的真实测试结果。');
    initialState = 'reproduce';
    states = [
      state('task', 'reproduce', t('Reproduce the bug', '复现问题'), t('Read sample/bug-report.md. Run sample/cart.test.mjs with node --test and save the failing output in artifacts/before.tap.', '阅读 sample/bug-report.md，使用 node --test 执行 sample/cart.test.mjs，将失败输出保存到 artifacts/before.tap。'), {
        toolGuidance: t('Run tests in the task workspace. Preserve the failing assertion and its input.', '在任务目录执行测试，保留失败断言及输入。'),
        qualityConditions: [quality('reproduced', t('The supplied quantity example fails with the observed and expected totals recorded.', '数量示例确实失败，已记录实际合计与预期合计。'))],
      }),
      state('task', 'fix', t('Make a focused fix', '最小修复'), t('Fix sample/cart.mjs. Preserve the exported function, input shape, and test assertions.', '修复 sample/cart.mjs，保留导出函数、输入格式及测试断言。'), {
        configuration: t('Change only the calculation. Do not weaken, skip, or delete tests.', '只修改计算逻辑，不削弱、跳过或删除测试。'),
        qualityConditions: [quality('focused-diff', t('The patch addresses quantity without unrelated changes.', '改动针对数量计算，没有无关修改。'))],
      }),
      state('decision', 'verify', t('Check the test result', '检查测试结果'), t('Run the original reproduction again. Select the path using the actual exit code and output.', '再次执行原始复现测试，依据实际退出码和输出选择路径。'), {
        qualityConditions: [quality('test-passed', t('The original failing case now passes without changing its assertion.', '原始失败用例已通过，且断言未被修改。'))],
      }),
      state('list', 'regression', t('Run the regressions', '逐项回归'), t('Check the three cases in order. Save a separate test result for each; the exit opens only after all pass.', '按顺序检查三个用例，分别保留测试结果；全部通过后才检查出口。'), {
        list: { items: [
          { id: 'empty', text: t('Empty cart returns zero', '空购物车返回 0') },
          { id: 'single', text: t('One product includes its quantity', '单商品按数量计价') },
          { id: 'multiple', text: t('Multiple products add up correctly', '多商品正确合计') },
        ], passCondition: t('The current named test actually ran, passed, and has saved output.', '当前指定用例确实执行、通过，并已保存输出。') },
        qualityConditions: [quality('case-evidence', t('The saved output identifies this case and its passing assertion.', '输出能对应当前用例，且断言通过。'))],
      }),
      state('end', 'done', t('Hand off the fix', '交付修复'), t('Deliver the patch and artifacts/fix-report.md with the cause, change, and regression results.', '交付修改后的代码及 artifacts/fix-report.md，说明原因、改动与回归结果。')),
    ];
    transitions = [
      edge('reproduced', 'reproduce', 'fix', t('The bug is reproducible.', '问题已稳定复现。'), ['reproduced']),
      edge('patch-ready', 'fix', 'verify', t('A focused patch is ready to test.', '最小修复已准备好，可以测试。'), ['focused-diff']),
      edge('test-failed', 'verify', 'fix', t('The original test still fails.', '原始测试仍失败。'), [], 'fallback'),
      edge('test-passed', 'verify', 'regression', t('The original test passes.', '原始测试通过。'), ['test-passed']),
      edge('regressions-passed', 'regression', 'done', t('Every regression passed and the fix report is written.', '所有回归用例通过，修复报告已完成。')),
    ];
    layout = { reproduce: { x: 20, y: 60 }, fix: { x: 360, y: 60 }, verify: { x: 740, y: 60 }, regression: { x: 740, y: 400 }, done: { x: 360, y: 400 } };
  } else if (id === 'research') {
    name = t('A brief with sources', '带来源的选型简报');
    purpose = t('Compare three fictional note tools for one person who needs offline access and Markdown export. Every claim must point to the supplied source; missing facts remain unknown.', '为需要离线使用、Markdown 导出的个人用户，对比三个虚构笔记工具。每条结论指向给定来源，未提供的信息保留为未知。');
    initialState = 'scope';
    states = [
      state('task', 'scope', t('Set the decision criteria', '明确选型标准'), t('Read sample/brief.md. Record the intended user, the two required features, and the supplied source scope.', '阅读 sample/brief.md，记录目标用户、两项必要能力，以及本次资料范围。'), {
        qualityConditions: [quality('criteria-clear', t('Single-user use, offline access, and Markdown export are recorded.', '已记录个人使用、离线能力、Markdown 导出要求。'))],
      }),
      state('list', 'sources', t('Read all three sources', '逐份核查资料'), t('Read the supplied files and extract facts into artifacts/source-notes.md. Treat them as fictional demo data, not real vendor claims.', '阅读给定文件，将事实摘录至 artifacts/source-notes.md；这些是虚构示例资料，不是真实厂商承诺。'), {
        list: { items: [
          { id: 'local', text: t('Read sample/sources/local.md', '阅读 sample/sources/local.md') },
          { id: 'team', text: t('Read sample/sources/team.md', '阅读 sample/sources/team.md') },
          { id: 'cloud', text: t('Read sample/sources/cloud.md', '阅读 sample/sources/cloud.md') },
        ], passCondition: t('The file was read; extracted facts cite it, and missing fields are marked unknown.', '文件已实际阅读；摘录事实附来源，缺失字段明确记为未知。') },
        qualityConditions: [quality('source-checked', t('Facts and unknowns are distinguishable, with a source file reference.', '事实与未知项可区分，并附来源文件引用。'))],
      }),
      state('task', 'draft', t('Write the comparison', '编写对比简报'), t('Write artifacts/comparison.md: a three-row comparison, a recommendation for the stated criteria, and unresolved questions. Link each factual row to its source.', '编写 artifacts/comparison.md：三项对比、针对既定标准的建议、待确认问题；每行事实链接到对应来源。')),
      state('decision', 'review', t('Check every claim', '核查每条结论'), t('Trace the recommendation to the sources. Team Notes does not specify offline support; do not invent an answer.', '将建议逐条对应到资料。Team Notes 未说明离线能力，不能补造答案。'), {
        qualityConditions: [quality('traceable', t('Every factual row links to the source that supports it.', '每行事实都有支持它的来源链接。')), quality('unknowns-marked', t('Unspecified capabilities remain explicitly unknown.', '未说明的能力仍明确标记为未知。')), quality('answers-brief', t('The recommendation addresses the stated user and both required features.', '建议回应目标用户及两项必要能力。'))],
      }),
      state('end', 'done', t('Deliver the brief', '交付选型简报'), t('Deliver comparison.md and source-notes.md with citations and open questions.', '交付 comparison.md 与 source-notes.md，保留引用和待确认问题。')),
    ];
    transitions = [
      edge('scoped', 'scope', 'sources', t('The question and criteria are clear.', '问题与标准已明确。'), ['criteria-clear']),
      edge('sources-read', 'sources', 'draft', t('All three sources were checked and notes saved.', '三份资料均已核查，摘录已保存。')),
      edge('draft-ready', 'draft', 'review', t('A comparison draft exists.', '已有可核查的对比稿。')),
      edge('needs-revision', 'review', 'draft', t('A claim lacks support, a citation is missing, or an unknown was presented as fact.', '结论缺乏支持、缺少引用，或把未知写成了事实。'), [], 'fallback'),
      edge('approved', 'review', 'done', t('The brief is supported and answers the question.', '简报有据可查，并回应选型问题。'), ['traceable', 'unknowns-marked', 'answers-brief']),
    ];
    layout = { scope: { x: 20, y: 60 }, sources: { x: 360, y: 60 }, draft: { x: 760, y: 60 }, review: { x: 760, y: 400 }, done: { x: 360, y: 400 } };
  } else {
    name = t('Release readiness', '发布前逐项验收');
    purpose = t('Check a release candidate, wait for its existing CI job, and request approval for that exact candidate. Finish with a release-ready record; publishing remains a separate user action.', '检查候选版本，等待原 CI 任务，并请求对该版本的明确批准。最终交付可发布记录，实际发布由用户另行操作。');
    initialState = 'checklist';
    states = [
      state('list', 'checklist', t('Check the release candidate', '逐项检查候选版本'), t('Read sample/release.json. Check the four items in order and write artifacts/checklist.md for this candidate.', '阅读 sample/release.json，按顺序完成四项检查，将该候选版本的结果写入 artifacts/checklist.md。'), {
        list: { items: [
          { id: 'version', text: t('Version and release notes agree', '版本与更新说明一致') },
          { id: 'license', text: t('License file is present', '许可证文件存在') },
          { id: 'tests', text: t('Test result belongs to this candidate', '测试结果属于当前候选版本') },
          { id: 'docs', text: t('Install instructions are complete', '安装说明完整') },
        ], passCondition: t('This item has an explicit passing result and evidence for the current candidate.', '当前事项有明确通过结果，并附当前候选版本的证据。') },
        qualityConditions: [quality('candidate-evidence', t('The evidence identifies the candidate and the checked item.', '证据能对应候选版本与当前检查项。'))],
      }),
      state('wait', 'ci', t('Wait for the existing CI job', '等待原 CI 任务'), t('Use jobId and candidateId from sample/release.json. Wait for an actual completion event for that same job and candidate.', '沿用 sample/release.json 中的 jobId、candidateId；等待同一任务、同一候选版本的实际完成事件。'), {
        toolGuidance: t('Query the original job or receive its callback. The demo uses sample/ci-result.json; a real project must use its actual CI result.', '查询原任务或接收回调；示例使用 sample/ci-result.json，实际项目须使用真实 CI 结果。'),
        configuration: t('Do not submit another build on resume. Pending or timeout without a result means hold.', '恢复时不再次提交构建；pending 或没有结果的超时都保持等待。'),
        qualityConditions: [quality('matching-ci', t('CI succeeded for the saved jobId and candidateId.', '保存的 jobId、candidateId 对应的 CI 明确成功。'))],
      }),
      state('wait', 'approval', t('Wait for explicit approval', '等待明确批准'), t('Ask the reviewer to approve the exact candidate. Silence, old approvals, and the agent\'s own opinion are not approval.', '请评审者明确批准当前候选版本。沉默、旧版本的批准、Agent 自己的判断都不算批准。'), {
        toolGuidance: t('Use a human reply or approved host event. The offline demo reads the clearly labeled fixture sample/approval.json.', '使用人工回复或获批的宿主事件；离线演练读取已明确标记为示例的 sample/approval.json。'),
        qualityConditions: [quality('explicit-approval', t('A reviewer explicitly approved this candidate after CI succeeded.', 'CI 成功后，评审者明确批准了当前候选版本。'))],
      }),
      state('task', 'revise', t('Revise the candidate', '修订候选版本'), t('Address the failed checks or review comments. A changed candidate needs a new ID, new CI evidence, and fresh approval; repeat the checklist.', '根据失败检查或评审意见修订。修改后的版本须有新的候选 ID、CI 证据和批准，并重新完成清单。')),
      state('end', 'ready', t('Ready to release', '可发布，等待用户操作'), t('Write artifacts/release-ready.md with checklist evidence, CI job, candidate, and reviewer approval. Do not publish, push tags, or deploy.', '编写 artifacts/release-ready.md，列出清单证据、CI 任务、候选版本与批准记录；不自动发布、推送标签或部署。')),
    ];
    transitions = [
      edge('checks-complete', 'checklist', 'ci', t('All four checks passed and the candidate/job IDs are saved.', '四项检查通过，候选版本与任务 ID 已保存。')),
      edge('ci-passed', 'ci', 'approval', t('The original CI job completed successfully for this candidate.', '原 CI 任务已为当前候选版本成功完成。'), ['matching-ci']),
      edge('ci-failed', 'ci', 'revise', t('CI explicitly failed for this candidate.', '当前候选版本的 CI 明确失败。'), [], 'fallback'),
      edge('approved', 'approval', 'ready', t('The reviewer explicitly approves this exact candidate.', '评审者明确批准当前候选版本。'), ['explicit-approval']),
      edge('changes-requested', 'approval', 'revise', t('The reviewer requests changes.', '评审者要求修改。'), [], 'fallback'),
      edge('candidate-updated', 'revise', 'checklist', t('A revised candidate and its new job ID are ready to check.', '修订后的候选版本及新任务 ID 已准备好，可以重新检查。')),
    ];
    layout = { checklist: { x: 20, y: 60 }, ci: { x: 420, y: 60 }, approval: { x: 820, y: 60 }, ready: { x: 820, y: 400 }, revise: { x: 420, y: 400 } };
  }
  return { format: 'decoupleflow-project', schemaVersion: 1, machine: { schemaVersion: 1, id: `demo-${id}`, name, version: '1.0.0', purpose, initialState, states, transitions, visualization: { enabled: true, autoOpen: true } }, layout };
}
