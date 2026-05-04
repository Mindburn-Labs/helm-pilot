# Pilot vs General-Purpose Autonomy

Status: approved positioning artifact.

Linear: MIN-241, MIN-258, MIN-284

Pilot is founder-ops first. Coding agents and broad enterprise agent platforms are useful references, but they are not the same category.

## Position

Pilot is a self-hostable founder operating system for discovery, decision, build, launch, and application workflows. It runs behind HELM, keeps every autonomous action inside the trust boundary, and produces approval and receipt trails for work that affects money, public surface, accounts, or external systems.

## Contrast

| Surface | Pilot | General-purpose coding or CX agents |
| --- | --- | --- |
| Primary user | Founder/operator | Engineer, marketer, or enterprise platform owner |
| Workflow | YC intel, product factory, launch, cofounder, content, finance, applications, SEO | Code tasks or broad customer-experience orchestration |
| Deployment | Self-hostable single-founder stack | Usually vendor-hosted cloud |
| Governance | HELM verdicts, approvals, evidence packs | Product-specific audit trail |
| Autonomy boundary | Single-process orchestrator + pg-boss + helm-client | Vendor runtime |

## Messaging

- Use "founder operating system" when the workflow spans market discovery, build, and launch.
- Use "operator" for role-specific workers inside Pilot.
- Avoid adopting "coworker" as a product primitive until a persistent-agent abstraction exists above jobs, tasks, and operators.
- When comparing to Devin, anchor on founder workflows and HELM-governed evidence, not coding throughput.

## Source Notes

- OpenAI exposes computer use through the Responses API; Pilot prototypes it only through `packages/helm-client.evaluateOperatorComputerUse`.
- Cognition's Devin 2.x is coding-agent pressure, especially around interactive planning. Pilot's response is mid-flight approvals plus auditable resume.
- Adobe CX Enterprise Coworker validates persistent-agent language in enterprise CX, but does not force a Pilot data-model change yet.

Primary sources:

- https://platform.openai.com/docs/guides/tools-computer-use
- https://cognition.ai/blog/devin-2
- https://cognition.ai/blog/introducing-devin-2-2
- https://news.adobe.com/news/2026/04/adobe-unveils-cx-enterprise-coworker
