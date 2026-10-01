# Examples

| Example | Start here |
|---|---|
| Three practical demos: bugfix, research, release readiness | [Inputs, importable projects, Skills, and local walkthroughs](demos/) · [中文](demos/README.zh-CN.md) |
| Codex executes, exits, then resumes | [Minimal harness](codex-resume/) |
| Codex / Jev / LangGraph / Dify verification | [Recorded results and runnable checks](verified/) |
| External analysis and review | [Markdown](analysis-review.md), [project JSON](analysis-review.decoupleflow.json), [portable Skill](df-analysis-review/) |
| Loops and multiple routes | [Markdown](loop-and-routing.md), [project JSON](loop-and-routing.decoupleflow.json) |
| LangChain / LangGraph integration | [Generated project](df-loop-and-routing-langgraph/) |
| Dify integration | [Generated DSL package](df-loop-and-routing-dify/) |
| Jev decisions | [Project JSON](jev-loop-and-routing.decoupleflow.json), [Dify DSL](jev-loop-and-routing-dify.yml) |
| External wait | [Wait example](wait20s.md), [project JSON](wait20s.decoupleflow.json) |

Run `npm run example` at the repository root to regenerate the portable reference bundles. The verification scripts generate their own current bundles inside `verified/.work/` and keep runtime results separate from the checked-in, dated observations. Jev and a deployed Dify instance require your configuration; the local examples do not bundle keys.
