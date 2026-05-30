/**
 * agents.js — Axiora Code Forge: Specialized AI Agent Definitions
 *
 * Each agent is a discrete stage in a multi-pass pipeline:
 *   analyzer → coreEngine → enhancer + minimizer + testGenerator (parallel) → crossValidator → auditor
 *
 * Usage:
 *   import { AGENTS, runAgent, PIPELINE_ORDER } from './agents.js';
 *   const result = await runAgent('analyzer', { originalCode, userPrompt });
 */

// ─── Shared utilities ────────────────────────────────────────────────────────

/**
 * Safely parse a JSON response from an agent.
 * Strips markdown fences if the model added them despite instructions.
 * @param {string} raw - Raw string from the model
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function parseAgentJson(raw) {
  try {
    const cleaned = raw.replace(/```(?:json)?[\s\S]*?```/g, (m) =>
      m.replace(/```(?:json)?/g, '').replace(/```/g, '')
    ).trim();
    return { ok: true, data: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e.message}`, raw };
  }
}

/**
 * Extract a named section from a structured agent response.
 * @param {string} text - Full agent output
 * @param {string} tag  - Section tag, e.g. "FIXED CODE"
 * @returns {string}
 */
export function extractSection(text, tag) {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)(?=\\n\\[|$)`, 'i');
  const match = text.match(re);
  return match ? match[1].trim() : '';
}

// ─── Agent registry ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentContext
 * @property {string}  [originalCode]  - The user's original source code
 * @property {string}  [userPrompt]    - The user's intent / instructions
 * @property {object}  [analysisJson]  - Parsed output from the analyzer agent
 * @property {string}  [fixedCode]     - Code produced by coreEngine
 * @property {string}  [optimizedCode] - Code produced by minimizer
 * @property {string}  [enhancedCode]  - Code produced by enhancer
 * @property {string}  [testCode]      - Tests produced by testGenerator
 * @property {string}  [finalCode]     - Code selected as the forge result
 */

/**
 * @typedef {Object} Agent
 * @property {string}                         id          - Unique agent identifier
 * @property {string}                         label       - Human-readable display name
 * @property {string}                         description - What this agent does
 * @property {'json'|'sections'|'code'}       outputType  - Expected response shape
 * @property {string[]}                       requires    - AgentContext keys required before running
 * @property {string}                         systemPrompt
 * @property {(ctx: AgentContext) => string}  buildPrompt
 */

export const AGENTS = {

  // ── Stage 1: Deep diagnostics ─────────────────────────────────────────────
  analyzer: {
    id: 'analyzer',
    label: 'Diagnostic Analyzer',
    description: 'Performs static analysis: detects logic errors, security flaws, and performance regressions.',
    outputType: 'json',
    requires: ['originalCode'],

    systemPrompt: `\
You are the Axiora Diagnostic Analyzer — a senior static-analysis engine.

TASK
Perform an exhaustive, multi-dimensional analysis of the provided source code.

OUTPUT
 Schema:
{
  "language": string,                  // detected programming language
  "framework": string | null,          // detected framework or runtime, if identifiable
  "summary": string,                   // 2–4 sentence executive summary
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "logic" | "security" | "performance" | "style" | "maintainability",
      "line": number | null,           // approximate line number, null if unknown
      "description": string,
      "recommendation": string
    }
  ],
  "complexityScore": number,           // 1–100 (higher = more complex / harder to maintain)
  "securityScore": number,             // 1–100 (higher = more secure)
  "performanceScore": number,          // 1–100 (higher = better performance)
  "maintainabilityScore": number,      // 1–100 (higher = easier to maintain)
  "hasCriticalIssues": boolean,
  "suggestedApproach": string          // brief strategy for the repair pipeline
}`,

    buildPrompt: (ctx) =>
      `Analyze the following code thoroughly.\n\n` +
      `USER INTENT: ${ctx.userPrompt || 'No additional context provided.'}\n\n` +
      `SOURCE CODE:\n\`\`\`\n${ctx.originalCode}\n\`\`\``,
  },

  // ── Stage 2: Core repair ──────────────────────────────────────────────────
  coreEngine: {
    id: 'coreEngine',
    label: 'Core Logic Engine',
    description: 'Repairs all identified issues while preserving the original intent and API surface.',
    outputType: 'sections',
    requires: ['originalCode', 'analysisJson'],

    systemPrompt: `\
You are the Axiogen Core Logic Engine — a surgical code-repair specialist.

TASK
Using the diagnostic report, rewrite the source code to resolve every issue (critical → low priority order)
while preserving the original functionality, API surface, and variable naming conventions.

OUTPUT FORMAT (use exactly these headers, nothing else):
[DIAGNOSTIC REPORT]
<A concise written summary of what was found and what was changed. Include the severity of each fix.>

[FIXED CODE]
<The complete, corrected source code. Raw code only — no markdown fences.>`,

    buildPrompt: (ctx) =>
      `Repair the code based on the diagnostic analysis below.\n\n` +
      `DIAGNOSTIC ANALYSIS:\n${JSON.stringify(ctx.analysisJson, null, 2)}\n\n` +
      `ORIGINAL SOURCE:\n\`\`\`\n${ctx.originalCode}\n\`\`\``,
  },

  // ── Stage 3a: Feature enhancement ────────────────────────────────────────
  enhancer: {
    id: 'enhancer',
    label: 'Feature Enhancer',
    description: 'Elevates the fixed code with modern patterns, improved readability, and best-practice idioms.',
    outputType: 'code',
    requires: ['fixedCode'],

    systemPrompt: `\
You are the Axiora Feature Enhancer — a modernization specialist.

TASK
Take the repaired code and apply the following improvements:
1. Adopt modern language idioms and syntax (e.g. optional chaining, nullish coalescing, async/await, destructuring).
2. Improve naming clarity: variables, functions, and types should read like documentation.
3. Replace any magic numbers or string literals with named constants.
4. Split overly long functions into smaller, single-responsibility units.
5. Ensure the code conforms to current community best practices for its language/framework.

OUTPUT
Raw enhanced code only. No markdown fences. No preamble or commentary.`,

    buildPrompt: (ctx) =>
      `Enhance the following repaired code.\n\n` +
      `USER INTENT: ${ctx.userPrompt || 'None provided.'}\n\n` +
      `FIXED CODE:\n${ctx.fixedCode}`,
  },

  // ── Stage 3b: Performance optimization ───────────────────────────────────
  minimizer: {
    id: 'minimizer',
    label: 'Code Minimizer',
    description: 'Optimizes for runtime performance and bundle footprint without sacrificing readability.',
    outputType: 'code',
    requires: ['fixedCode'],

    systemPrompt: `\
You are the Axiogen Code Minimizer — a performance and efficiency specialist.

TASK
Optimize the fixed code for production deployment:
1. Eliminate dead code, redundant branches, and unnecessary allocations.
2. Replace O(n²) or worse algorithms with efficient alternatives where applicable.
3. Cache repeated lookups; prefer lazy evaluation for expensive computations.
4. Remove unused imports and dependencies.
5. Prefer early returns and guard clauses to reduce nesting depth.
6. Ensure the footprint reduction does NOT compromise readability or correctness.

OUTPUT
Raw optimized code only. No markdown fences. No preamble or commentary.`,

    buildPrompt: (ctx) =>
      `Optimize the following fixed code for production.\n\n` +
      `FIXED CODE:\n${ctx.fixedCode}`,
  },

  // ── Stage 3c: Test generation ─────────────────────────────────────────────
  testGenerator: {
    id: 'testGenerator',
    label: 'Test Architect',
    description: 'Generates comprehensive unit tests covering happy paths, edge cases, and regression scenarios.',
    outputType: 'code',
    requires: ['fixedCode'],

    systemPrompt: `\
You are the Axiora Test Architect — a quality-assurance specialist.

TASK
Write a comprehensive test suite for the provided code:
1. Cover all exported functions and public class methods.
2. Include happy-path tests, edge cases, and failure/error scenarios.
3. Specifically add regression tests for each issue identified in the original analysis.
4. Use descriptive test names that read as specifications (e.g. "returns null when input is empty").
5. Use the most idiomatic testing library for the detected language
   (Jest for JS/TS, pytest for Python, JUnit for Java, etc.).
6. Mock external dependencies (network, filesystem, databases) appropriately.
7. Aim for ≥ 80% branch coverage.

OUTPUT
Raw test code only. No markdown fences. No preamble or commentary.`,

    buildPrompt: (ctx) =>
      `Write a comprehensive test suite for the following code.\n\n` +
      (ctx.analysisJson
        ? `KNOWN ISSUES FROM ANALYSIS (use as regression test targets):\n` +
          JSON.stringify(ctx.analysisJson.issues ?? [], null, 2) + '\n\n'
        : '') +
      `IMPLEMENTATION TO TEST:\n${ctx.fixedCode}`,
  },

  // ── Stage 4: Cross-validation ─────────────────────────────────────────────
  crossValidator: {
    id: 'crossValidator',
    label: 'Cross-Validator',
    description: 'Compares original and forged output for logic integrity, regressions, and semantic drift.',
    outputType: 'json',
    requires: ['originalCode', 'finalCode', 'userPrompt'],

    systemPrompt: `\
You are the Axiogen Cross-Validator — a verification and regression specialist.

TASK
Perform a high-fidelity comparison between the original source and the forged output.
Evaluate:
1. Functional equivalence — does the forged code do what the original intended?
2. Regression risk — were any working behaviours accidentally broken?
3. Security delta — did the forge introduce or remove any security concerns?
4. Performance delta — are there measurable performance changes (better or worse)?
5. API compatibility — is the public API surface preserved?

OUTPUT
 Schema:
{
  "confidenceScore": number,           // 1–100: confidence the forge is correct
  "semanticEquivalence": boolean,      // true if original intent is preserved
  "regressions": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "description": string
    }
  ],
  "improvements": [string],            // list of confirmed improvements
  "warnings": [string],                // non-blocking concerns
  "validationChecks": [
    {
      "check": string,
      "passed": boolean,
      "notes": string
    }
  ],
  "status": "approved" | "needs-review" | "rejected",
  "recommendation": string             // final sentence for the audit report
}`,

    buildPrompt: (ctx) =>
      `Validate the forged implementation against the original source.\n\n` +
      `USER INTENT: ${ctx.userPrompt}\n\n` +
      `ORIGINAL SOURCE:\n\`\`\`\n${ctx.originalCode}\n\`\`\`\n\n` +
      `FORGED RESULT:\n\`\`\`\n${ctx.finalCode}\n\`\`\``,
  },

  // ── Stage 5: Final audit ──────────────────────────────────────────────────
  auditor: {
    id: 'auditor',
    label: 'Final Auditor',
    description: 'Synthesizes the full pipeline into a production-ready deliverable with a comprehensive audit trail.',
    outputType: 'sections',
    requires: ['userPrompt', 'fixedCode', 'optimizedCode', 'testCode'],

    systemPrompt: `\
You are the Axiogen Final Auditor — the last gate before production shipment.

TASK
Synthesize the entire forge pipeline into a final, production-ready deliverable.
Select the best version of the code (fixed, enhanced, or optimized) based on the pipeline context.
Write a complete audit report.

CRITICAL RULES
- The [FINAL CODE] block must contain ONLY the implementation. Never include test code here.
- Be specific and technical in every section. Vague statements fail the audit.
- If any critical regressions were flagged by the cross-validator, note them prominently.

OUTPUT FORMAT (use exactly these headers in exactly this order):
[FINAL CODE]
<The complete, production-ready implementation. Raw code only — no markdown fences.>

[TECHNICAL AUDIT REPORT]
<A thorough technical narrative covering: what was broken, what was fixed, what was improved,
and why the final version is ready for production. Minimum 150 words.>

[SYNTHESIS DECISIONS]
<Explain which agent outputs were selected and why. If the enhanced version was chosen over
the optimized version, say so and give the rationale. List any trade-offs accepted.>

[REGRESSION FLAGS]
<List every regression or concern raised during the pipeline, with severity and resolution status.
If none were found, write "No regressions detected.">

[TEST COVERAGE SUMMARY]
<Summarize the test suite: how many tests, which categories (unit/integration/regression),
estimated branch coverage, and any known gaps.>`,

    buildPrompt: (ctx) =>
      `Conduct the final audit for the Axiora forge pipeline.\n\n` +
      `ORIGINAL USER INTENT: ${ctx.userPrompt}\n\n` +
      `ANALYSIS SUMMARY:\n${JSON.stringify(ctx.analysisJson ?? {}, null, 2)}\n\n` +
      `FIXED CODE:\n${ctx.fixedCode}\n\n` +
      `OPTIMIZED CODE:\n${ctx.optimizedCode}\n\n` +
      `ENHANCED CODE:\n${ctx.enhancedCode ?? '(not available)'}\n\n` +
      `TEST SUITE:\n${ctx.testCode}\n\n` +
      `CROSS-VALIDATION REPORT:\n${JSON.stringify(ctx.validationJson ?? {}, null, 2)}`,
  },
};

// ─── Pipeline metadata ────────────────────────────────────────────────────────

/**
 * Linear execution order.
 * Stages 3a/3b/3c (enhancer, minimizer, testGenerator) can run in parallel.
 */
export const PIPELINE_ORDER = [
  'analyzer',
  'coreEngine',
  ['enhancer', 'minimizer', 'testGenerator'],  // parallel stage
  'crossValidator',
  'auditor',
];

/**
 * Return the flat list of all agent IDs in dependency order.
 * @returns {string[]}
 */
export function getPipelineIds() {
  return PIPELINE_ORDER.flatMap((stage) =>
    Array.isArray(stage) ? stage : [stage]
  );
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Execute a single agent against the Anthropic API.
 *
 * @param {string}       agentId - Key from AGENTS
 * @param {AgentContext} ctx     - Pipeline context object
 * @param {object}       [opts]
 * @param {string}       [opts.model='claude-sonnet-4-20250514']
 * @param {number}       [opts.maxTokens=4096]
 * @param {AbortSignal}  [opts.signal] - Optional abort signal
 * @returns {Promise<{ raw: string, parsed: any }>}
 */
export async function runAgent(agentId, ctx, opts = {}) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: "${agentId}"`);

  // Validate required context keys
  const missing = agent.requires.filter((key) => !ctx[key]);
  if (missing.length) {
    throw new Error(
      `Agent "${agentId}" is missing required context: ${missing.join(', ')}`
    );
  }

  const model      = opts.model      ?? 'claude-sonnet-4-20250514';
  const maxTokens  = opts.maxTokens  ?? 4096;
  const userPrompt = agent.buildPrompt(ctx);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: agent.systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const raw  = data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  let parsed;
  if (agent.outputType === 'json') {
    const result = parseAgentJson(raw);
    if (!result.ok) console.warn(`[${agentId}] JSON parse warning:`, result.error);
    parsed = result.ok ? result.data : { _raw: raw, _parseError: result.error };
  } else if (agent.outputType === 'sections') {
    parsed = raw; // Caller uses extractSection()
  } else {
    parsed = raw; // 'code' — raw string
  }

  return { raw, parsed };
}

/**
 * Run the full Axiora forge pipeline sequentially,
 * with the parallel stage (enhancer/minimizer/testGenerator) executed concurrently.
 *
 * @param {string} originalCode
 * @param {string} userPrompt
 * @param {object} [callbacks] - Optional progress callbacks
 * @param {(agentId: string, status: 'start'|'done'|'error', data?: any) => void} [callbacks.onStage]
 * @returns {Promise<AgentContext>} - Final enriched context
 */
export async function runPipeline(originalCode, userPrompt, callbacks = {}) {
  const { onStage } = callbacks;
  const notify = (id, status, data) => onStage?.(id, status, data);

  let ctx = { originalCode, userPrompt };

  // Stage 1: Analyzer
  notify('analyzer', 'start');
  const { parsed: analysisJson } = await runAgent('analyzer', ctx);
  ctx = { ...ctx, analysisJson };
  notify('analyzer', 'done', analysisJson);

  // Stage 2: Core Engine
  notify('coreEngine', 'start');
  const { raw: coreRaw } = await runAgent('coreEngine', ctx);
  const fixedCode        = extractSection(coreRaw, 'FIXED CODE');
  const diagnosticReport = extractSection(coreRaw, 'DIAGNOSTIC REPORT');
  ctx = { ...ctx, fixedCode, diagnosticReport };
  notify('coreEngine', 'done', { fixedCode, diagnosticReport });

  // Stage 3: Parallel branch
  ['enhancer', 'minimizer', 'testGenerator'].forEach((id) => notify(id, 'start'));
  const [enhancerResult, minimizerResult, testResult] = await Promise.all([
    runAgent('enhancer',      ctx),
    runAgent('minimizer',     ctx),
    runAgent('testGenerator', ctx),
  ]);
  ctx = {
    ...ctx,
    enhancedCode:  enhancerResult.parsed,
    optimizedCode: minimizerResult.parsed,
    testCode:      testResult.parsed,
    finalCode:     minimizerResult.parsed,  // crossValidator uses this; auditor may override
  };
  notify('enhancer',      'done', ctx.enhancedCode);
  notify('minimizer',     'done', ctx.optimizedCode);
  notify('testGenerator', 'done', ctx.testCode);

  // Stage 4: Cross-validator
  notify('crossValidator', 'start');
  const { parsed: validationJson } = await runAgent('crossValidator', ctx);
  ctx = { ...ctx, validationJson };
  notify('crossValidator', 'done', validationJson);

  // Stage 5: Final Auditor
  notify('auditor', 'start');
  const { raw: auditRaw } = await runAgent('auditor', ctx);
  ctx = {
    ...ctx,
    auditFinalCode:       extractSection(auditRaw, 'FINAL CODE'),
    auditReport:          extractSection(auditRaw, 'TECHNICAL AUDIT REPORT'),
    synthesisDecisions:   extractSection(auditRaw, 'SYNTHESIS DECISIONS'),
    regressionFlags:      extractSection(auditRaw, 'REGRESSION FLAGS'),
    testCoverageSummary:  extractSection(auditRaw, 'TEST COVERAGE SUMMARY'),
  };
  notify('auditor', 'done', ctx);

  return ctx;
}
