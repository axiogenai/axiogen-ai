/**
 * forge.js - Code Forge Pipeline Orchestrator
 * Manages the 3-phase multi-agent fusion process with maximum parallelism.
 */

import { AGENTS } from './agents.js';

const PHASE_MODELS = {
    phase1: 'google/gemini-2.0-flash-001',
    phase2: 'google/gemini-2.0-flash-001',
    phase3: 'google/gemini-2.0-flash-001'
};

let forgeState = { isRunning: false, results: null, activeTab: 'final' };

export function setupTestingUI() {
    const runBtn = document.getElementById('run-pipeline-btn');
    const resetBtn = document.getElementById('forge-reset-btn');
    if (!runBtn || runBtn.dataset.init) return;
    runBtn.dataset.init = "true";

    runBtn.onclick = runForgePipeline;
    if (resetBtn) resetBtn.onclick = resetForge;

    document.querySelectorAll('.forge-tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            forgeState.activeTab = e.target.getAttribute('data-tab');
            document.querySelectorAll('.forge-tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderForgeResults();
        };
    });
}

async function runForgePipeline() {
    const code = document.getElementById('testing-code-input').value.trim();
    const userPrompt = document.getElementById('testing-prompt-input').value.trim();
    if (!code || forgeState.isRunning) return;

    forgeState.isRunning = true;
    const runBtn = document.getElementById('run-pipeline-btn');
    runBtn.disabled = true;
    runBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Forging...';

    document.getElementById('forge-empty-state').style.display = 'none';
    document.getElementById('forge-results-content').style.display = 'block';
    const stagesList = document.getElementById('stages-list');
    stagesList.innerHTML = '';
    document.getElementById('forge-final-output').style.display = 'none';

    const context = { originalCode: code, userPrompt, stages: {} };
    const startTime = Date.now();

    try {
        // PHASE 1: START ANALYSIS & CORE REWRITE IN PARALLEL
        const p1Div = renderPhaseCard(1, 'Full Diagnostic & Bug Fix', 'Analyzing structure and neutralizing bugs...');
        
        const analyzerPromise = callAgent('analyzer', context, PHASE_MODELS.phase1);
        const coreEnginePromise = callAgent('coreEngine', context, PHASE_MODELS.phase1);

        // Core Engine is the critical path for Phase 2
        const coreResult = await coreEnginePromise;
        const langMatch = coreResult.match(/Language:\s*(\w+)/i);
        const reportMatch = coreResult.match(/\[DIAGNOSTIC REPORT\]\s*([\s\S]*?)\s*\[FIXED CODE\]/i);
        const codeMatch = coreResult.match(/\[FIXED CODE\]\s*([\s\S]*)/i);

        context.fixedCode = (codeMatch ? codeMatch[1].trim() : coreResult).replace(/^```[a-z]*\n/i, '').replace(/\n```$/g, '');
        context.analysis = {
            language: langMatch ? langMatch[1] : 'Detected',
            diagnosticReport: reportMatch ? reportMatch[1].trim() : 'No issues found.'
        };
        updatePhaseCard(p1Div, 1, `Fixed core logic for ${context.analysis.language}.`);

        // PHASE 2: START ENHANCER, MINIMIZER, AND TEST GENERATOR IN PARALLEL
        const p2Div = renderPhaseCard(2, 'Parallel Refinement', 'Enhancing, Optimizing, and Testing...');
        
        const enhancerPromise = callAgent('enhancer', context, PHASE_MODELS.phase2);
        const minimizerPromise = callAgent('minimizer', context, PHASE_MODELS.phase2);
        const testGeneratorPromise = callAgent('testGenerator', context, PHASE_MODELS.phase2);

        // Wait for Phase 2 results
        const [enhResult, minResult, testResult] = await Promise.all([
            enhancerPromise,
            minimizerPromise,
            testGeneratorPromise
        ]);

        context.enhancedCode = enhResult.trim().replace(/^```[a-z]*\n/i, '').replace(/\n```$/g, '');
        context.optimizedCode = minResult.trim().replace(/^```[a-z]*\n/i, '').replace(/\n```$/g, '');
        context.testCode = testResult.trim().replace(/^```[a-z]*\n/i, '').replace(/\n```$/g, '');
        context.stages.enhancement = { code: context.enhancedCode };
        context.stages.optimization = { code: context.optimizedCode };
        context.stages.tests = { code: context.testCode };
        updatePhaseCard(p2Div, 2, 'Purity standards and tests finalized.');

        // Ensure Analysis is finished before Phase 3 (it should be by now)
        const analysisStr = await analyzerPromise;
        context.analysisJson = safeParseJSON(analysisStr);
        context.stages.analysis = context.analysisJson;

        // PHASE 3: FINAL AUDIT & VALIDATION
        const p3Div = renderPhaseCard(3, 'Final Audit & Synthesis', 'Validating and synthesizing final report...');
        
        // Final code is usually the optimized code from Phase 2
        context.finalCode = context.optimizedCode;

        const [validationStr, auditResult] = await Promise.all([
            callAgent('crossValidator', context, PHASE_MODELS.phase3),
            callAgent('auditor', context, PHASE_MODELS.phase3)
        ]);

        context.validation = safeParseJSON(validationStr);
        context.finalReport = auditResult;

        const finalCodeMatch = auditResult.match(/\[FINAL CODE\]\s*([\s\S]*?)\s*\[TECHNICAL AUDIT REPORT\]/i);
        if (finalCodeMatch) {
            context.finalCode = finalCodeMatch[1].trim().replace(/^```[a-z]*\n/i, '').replace(/\n```$/g, '');
        }

        updatePhaseCard(p3Div, 3, 'Master synthesis complete.');

        forgeState.results = { ...context, elapsed: ((Date.now() - startTime) / 1000).toFixed(1) + 's' };
        document.getElementById('forge-final-output').style.display = 'block';
        document.getElementById('elapsed-time').textContent = forgeState.results.elapsed;
        document.getElementById('confidence-score').textContent = (context.validation?.confidenceScore || 99) + '%';
        renderForgeResults();

    } catch (err) {
        stagesList.innerHTML += `<div class="error-banner" style="background:rgba(239,68,68,0.1); color:#ef4444; padding:1rem; border-radius:0.5rem; margin-top:1rem;">⚠️ Forge Failed: ${err.message}</div>`;
        console.error(err);
    } finally {
        forgeState.isRunning = false;
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fas fa-play"></i> Run Pipeline';
    }
}

async function callAgent(agentKey, context, modelOverride) {
    const agent = AGENTS[agentKey];
    const apiKey = localStorage.getItem('axiora_api_key') || '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';

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://axiora.ai',
                'X-Title': 'Axiora Code Forge'
            },
            body: JSON.stringify({
                model: modelOverride || 'google/gemini-2.0-flash-001',
                max_tokens: 8192,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: agent.buildPrompt(context) }
                ]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
            throw new Error('AI returned an empty response.');
        }
        return data.choices[0].message.content;
    } catch (err) {
        throw err;
    }
}

function renderPhaseCard(id, name, desc) {
    const div = document.createElement('div');
    div.className = 'stage-card running';
    div.innerHTML = `<div class="stage-header"><div class="stage-indicator"><i class="fas fa-circle-notch fa-spin"></i></div><div class="stage-info"><div class="stage-name">Phase ${id}: ${name}</div><div class="stage-desc">${desc}</div></div></div>`;
    document.getElementById('stages-list').appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return div;
}

function updatePhaseCard(div, id, summary) {
    const icons = { 1: '🔍', 2: '⚒️', 3: '📋' };
    const colors = { 1: '#00ffff', 2: '#3b82f6', 3: '#a78bfa' };
    div.className = 'stage-card done';
    div.style.borderLeft = `3px solid ${colors[id]}`;
    div.innerHTML = `<div class="stage-header"><div class="stage-indicator">${icons[id]}</div><div class="stage-info"><div class="stage-name">Phase ${id} Complete</div><div class="stage-desc">${summary}</div></div></div>`;
}

function renderForgeResults() {
    const viewer = document.getElementById('forge-output-viewer');
    const res = forgeState.results;
    if (!res) return;

    if (forgeState.activeTab === 'final') {
        viewer.innerHTML = `<pre class="code-block"><code>${escapeHtml(res.finalCode)}</code></pre>`;
    } else if (forgeState.activeTab === 'compare') {
        viewer.innerHTML = `<div style="display:flex;gap:1rem;"><div style="flex:1;"><div class="pane-header">Original</div><pre class="code-block" style="background:rgba(239,68,68,0.05)"><code>${escapeHtml(res.originalCode)}</code></pre></div><div style="flex:1;"><div class="pane-header">Forged</div><pre class="code-block" style="background:rgba(16,185,129,0.05)"><code>${escapeHtml(res.finalCode)}</code></pre></div></div>`;
    } else if (forgeState.activeTab === 'tests') {
        viewer.innerHTML = `<pre class="code-block"><code>${escapeHtml(res.testCode)}</code></pre>`;
    } else {
        viewer.innerHTML = `<div class="report-view">${parseForgeReport(res.finalReport)}</div>`;
    }
}

function parseForgeReport(text) {
    const sections = [
        { key: 'SYNTHESIS DECISIONS', class: 'synthesis' },
        { key: 'REGRESSION FLAGS', class: 'regression' },
        { key: 'TECHNICAL AUDIT REPORT', class: 'audit' },
        { key: 'TEST COVERAGE SUMMARY', class: 'coverage' }
    ];
    let html = '';
    sections.forEach(section => {
        const regex = new RegExp(`\\s*\\[${section.key}\\]\\s*([\\s\\S]*?)(?=\\[|$)`, 'i');
        const match = text.match(regex);
        if (match && match[1].trim()) {
            html += `<div class="report-section ${section.class}"><div class="report-section-header">${section.key}</div><div class="report-section-content">${parseMarkdown(match[1].trim())}</div></div>`;
        }
    });
    return html || `<div class="report-section"><div class="report-section-content">${parseMarkdown(text)}</div></div>`;
}

function resetForge() {
    document.getElementById('testing-code-input').value = '';
    document.getElementById('testing-prompt-input').value = '';
    document.getElementById('forge-results-content').style.display = 'none';
    document.getElementById('forge-empty-state').style.display = 'flex';
    forgeState.results = null;
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function safeParseJSON(str) { try { return JSON.parse(str.replace(/```json\n?|\n?```/g, '').trim()); } catch (e) { return { error: 'Parse failed', raw: str }; } }
function parseMarkdown(text) { return (typeof marked !== 'undefined') ? marked.parse(text) : text.replace(/\n/g, '<br>'); }
