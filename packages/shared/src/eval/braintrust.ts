// ─── Braintrust eval shim (Phase 14 Track D) ───
//
// Optional LLM-as-judge + regression harness. Activates only when both
// env vars are set:
//   BRAINTRUST_API_KEY, BRAINTRUST_PROJECT
//
// When unset, every function is a no-op. When set, dynamic-imports the
// `braintrust` package (optional peer dep) and logs experiment runs
// to Braintrust Cloud or self-hosted.
//
// Used by:
//   - `grade_output` tool (future) for LLM-as-judge scoring of agent
//     outputs (e.g., "score this YC draft 0–1 on clarity").
//   - `tests/eval/*.eval.ts` (future) for prompt regression suites
//     run in CI via the `eval-drift.yml` workflow.
//
// Reference: https://www.braintrust.dev/docs/guides/logging

let project: BraintrustProjectLike | null = null;
let tried = false;

interface BraintrustLogEntry {
  input: unknown;
  output: unknown;
  expected?: unknown;
  scores?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

interface BraintrustProjectLike {
  log(entry: BraintrustLogEntry): void;
  flush(): Promise<void>;
}

async function getProject(): Promise<BraintrustProjectLike | null> {
  if (project || tried) return project;
  tried = true;

  const apiKey = process.env['BRAINTRUST_API_KEY'];
  const name = process.env['BRAINTRUST_PROJECT'];
  if (!apiKey || !name) return null;

  try {
    const mod = (await import('braintrust' as string).catch(() => null)) as
      | {
          initLogger?: (opts: {
            apiKey: string;
            projectName: string;
          }) => BraintrustProjectLike;
        }
      | null;
    const init = mod?.initLogger;
    if (!init) return null;
    project = init({ apiKey, projectName: name });
    return project;
  } catch {
    return null;
  }
}

/**
 * Log a single agent output to Braintrust. `scores` is the rubric
 * breakdown (e.g. {clarity: 0.82, specificity: 0.71}); Braintrust
 * aggregates across runs for drift detection.
 */
export async function logEvalEntry(entry: BraintrustLogEntry): Promise<void> {
  const p = await getProject();
  if (!p) return;
  try {
    p.log(entry);
  } catch {
    /* never fatal */
  }
}

/**
 * Flush pending eval events. Call on graceful shutdown + at the end
 * of a CI eval run.
 */
export async function flushBraintrust(): Promise<void> {
  const p = await getProject();
  if (!p) return;
  try {
    await p.flush();
  } catch {
    /* ignore */
  }
}

/**
 * LLM-as-judge primitive. Given a rubric + input + output, delegates
 * scoring to a provided judge callback (typically another LLM call
 * through the orchestrator's HELM-governed path) and logs the result
 * to Braintrust.
 *
 * The caller owns the judge call so we don't tangle the observability
 * shim with LLM provider selection.
 */
export async function gradeOutput(params: {
  name: string;
  input: string;
  output: string;
  expected?: string;
  rubric: string[];
  judge: (
    rubric: string[],
    input: string,
    output: string,
  ) => Promise<Record<string, number>>;
  metadata?: Record<string, unknown>;
}): Promise<Record<string, number>> {
  const scores = await params.judge(params.rubric, params.input, params.output);
  await logEvalEntry({
    input: params.input,
    output: params.output,
    expected: params.expected,
    scores,
    metadata: { ...params.metadata, name: params.name, rubric: params.rubric },
  });
  return scores;
}
