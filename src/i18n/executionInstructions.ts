export const executionInstructionsEnglish = `## Instances and live visualization

Requires Node.js 18.18+. The helper maintains state and displays actual events. The host agent performs business work independently.

1. Run start for every new task. It always creates a fresh instance and never reuses a completed record. Script paths are relative to this Skill installation directory. The workspace must be the current user task directory, not the Skill directory or the DecoupleFlow source directory.

\`\`\`bash
node scripts/run.mjs start --workspace /absolute/task/workspace --actor "Host Agent name"
\`\`\`

2. Save the returned absolute instance path and use it in subsequent commands. The definition and complete Markdown are pinned to the instance directory. Do not write task state into the Skill installation directory. With visualization enabled, the helper starts an independent local window; the editor need not be open. If browserOpened is false, use an available host browser or preview tool to open viewerUrl. Only if that capability is unavailable, provide the link to the user and explain the limitation. Disable visualization before exporting or pass --visualization off to start.
3. Read the returned handoff for the current goal, candidate paths, and decisionFormat, then perform the node work. To report waiting, human review, or failure, write an actual event to a JSON file and submit it:

\`\`\`bash
node scripts/run.mjs event --instance /absolute/instance --event /absolute/event.json
\`\`\`

Example: \`{"type":"external.waiting","detail":"Waiting for the original task job-42; not yet complete"}\`. Supported events: agent.started, agent.completed, external.waiting, external.completed, human.required, run.failed, run.timeout. Report only events that actually occurred.

4. In agent mode, evaluate the current conditions, write a decision matching handoff.decisionFormat, and submit it with advance. In Jev mode, provide only the current evidence file and configure TYPESAFE_API_KEY in the host environment; omit --decision. Stay in the current state when evidence is missing or checks fail.

\`\`\`bash
node scripts/run.mjs advance --instance /absolute/instance --context /absolute/evidence.txt --decision /absolute/decision.json
\`\`\`

5. Use only the returned record / handoff for subsequent work. The helper writes records and updates the window automatically; do not edit files separately. When paused, preserve business results and resubmit the decision after continue or step. Do not repeat completed work. When held, obtain further evidence. The top-level end state requires a final __finish__ decision; completion automatically archives the instance and releases it from the active list. Use start for a new request.
6. When the user explicitly continues an unfinished task, use resume --instance <original-directory>. This preserves the original definition, state, and external task ID. Use view --instance <directory> for history, list --workspace <task-directory> to list instances, and archive --instance <directory> to end an unfinished instance. Archived records are read-only; new tasks start at the entry. fork --instance <directory> creates an independent copy at the current position; the host must explicitly continue using the returned directory.

Pause and step control subsequent state transitions; the host controls external work. The window displays current state, loops, branches, Jev decisions, and actual events. Closing it does not cancel the task. On completion, the local viewer process is released automatically and history files are preserved. If Node or a graphical environment is unavailable, explain the limitation and maintain an independent record using the state machine instructions. Do not claim visualization has opened.
`;
