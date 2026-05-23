/**
 * compiler.js - AXIOGEN Code Compiler
 * Auto-detects language, compiles & executes via Piston API.
 */

// ─── Language Detection Heuristics ───────────────────────────────────────────
const LANG_PATTERNS = [
    {
        id: 'python', name: 'Python', version: '3.10.0', pistonId: 'python',
        patterns: [/\bdef\s+\w+\s*\(/, /\bimport\s+\w+/, /\bprint\s*\(/, /\bclass\s+\w+.*:/, /\belif\b/, /\bself\./, /^\s*#.*python/im, /\brange\s*\(/, /\blen\s*\(/, /\b__\w+__\b/],
        weight: 0
    },
    {
        id: 'javascript', name: 'JavaScript', version: '18.15.0', pistonId: 'javascript',
        patterns: [/\bconsole\.\w+\s*\(/, /\bconst\s+\w+\s*=/, /\blet\s+\w+\s*=/, /=>\s*[{(]/, /\bfunction\s+\w+\s*\(/, /\bdocument\./, /\bwindow\./, /\brequire\s*\(/, /\.addEventListener\s*\(/, /\basync\s+function/],
        weight: 0
    },
    {
        id: 'typescript', name: 'TypeScript', version: '5.0.3', pistonId: 'typescript',
        patterns: [/:\s*(string|number|boolean|any|void|never)\b/, /\binterface\s+\w+/, /\btype\s+\w+\s*=/, /\benum\s+\w+/, /\bimport\s+.*\bfrom\s+['"]/, /\bas\s+(string|number|any)\b/, /\<\w+\>/, /\bReadonly\</, /\bPartial\</],
        weight: 0
    },
    {
        id: 'java', name: 'Java', version: '15.0.2', pistonId: 'java',
        patterns: [/\bpublic\s+(static\s+)?class\s+/, /\bSystem\.(out|err)\.print/, /\bpublic\s+static\s+void\s+main/, /\bimport\s+java\./, /\bnew\s+\w+\s*\(/, /\bprivate\s+(static\s+)?/, /\bString\[\]\s+args/, /\bextends\s+\w+/, /\bimplements\s+\w+/],
        weight: 0
    },
    {
        id: 'c', name: 'C', version: '10.2.0', pistonId: 'c',
        patterns: [/#include\s*<stdio\.h>/, /#include\s*<stdlib\.h>/, /\bprintf\s*\(/, /\bscanf\s*\(/, /\bint\s+main\s*\(/, /\bmalloc\s*\(/, /\bfree\s*\(/, /\btypedef\s+struct/, /\bsizeof\s*\(/],
        weight: 0
    },
    {
        id: 'cpp', name: 'C++', version: '10.2.0', pistonId: 'c++',
        patterns: [/#include\s*<iostream>/, /\bstd::/, /\bcout\s*<</, /\bcin\s*>>/, /\busing\s+namespace\s+std/, /#include\s*<vector>/, /#include\s*<string>/, /\btemplate\s*</, /\bclass\s+\w+\s*\{/],
        weight: 0
    },
    {
        id: 'csharp', name: 'C#', version: '6.12.0', pistonId: 'csharp',
        patterns: [/\busing\s+System/, /\bConsole\.(Write|Read)/, /\bnamespace\s+\w+/, /\bstatic\s+void\s+Main\s*\(/, /\bstring\[\]\s+args/, /\bvar\s+\w+\s*=/, /\bpublic\s+class\s+/, /\bforeach\s*\(/, /\bawait\s+/],
        weight: 0
    },
    {
        id: 'go', name: 'Go', version: '1.16.2', pistonId: 'go',
        patterns: [/\bpackage\s+main\b/, /\bfunc\s+main\s*\(\)/, /\bfmt\.Print/, /\bimport\s+\(/, /\bfunc\s+\w+\s*\(.*\)\s*\w*\s*\{/, /\b:=\s*/, /\bgo\s+func/, /\bdefer\s+/, /\bchan\s+/],
        weight: 0
    },
    {
        id: 'rust', name: 'Rust', version: '1.68.2', pistonId: 'rust',
        patterns: [/\bfn\s+main\s*\(\)/, /\blet\s+mut\s+/, /\bprintln!\s*\(/, /\buse\s+std::/, /\bimpl\s+\w+/, /\bpub\s+fn\s+/, /\b->\s*(i32|u32|String|bool|&str)/, /\bmatch\s+\w+/, /\bOption\s*</, /\bResult\s*</],
        weight: 0
    },
    {
        id: 'ruby', name: 'Ruby', version: '3.0.1', pistonId: 'ruby',
        patterns: [/\bputs\s+/, /\bdef\s+\w+\s*$/, /\brequire\s+['"]/, /\bclass\s+\w+\s*$/, /\bend\s*$/, /\battr_(accessor|reader|writer)\b/, /\bdo\s*\|/, /\.each\s+do/, /\byield\b/],
        weight: 0
    },
    {
        id: 'php', name: 'PHP', version: '8.2.3', pistonId: 'php',
        patterns: [/<\?php/, /\$\w+\s*=/, /\becho\s+/, /\bfunction\s+\w+\s*\(.*\$/, /->/, /\barray\s*\(/, /\bforeach\s*\(\s*\$/, /\bclass\s+\w+/, /\bnew\s+\w+/],
        weight: 0
    },
    {
        id: 'swift', name: 'Swift', version: '5.3.3', pistonId: 'swift',
        patterns: [/\bimport\s+Foundation/, /\bvar\s+\w+:\s*/, /\blet\s+\w+:\s*/, /\bprint\s*\(/, /\bfunc\s+\w+\s*\(.*\)\s*->/, /\bstruct\s+\w+/, /\bguard\s+let/, /\bif\s+let\s+/],
        weight: 0
    },
    {
        id: 'kotlin', name: 'Kotlin', version: '1.8.20', pistonId: 'kotlin',
        patterns: [/\bfun\s+main\s*\(/, /\bprintln\s*\(/, /\bval\s+\w+/, /\bvar\s+\w+/, /\bwhen\s*\(/, /\bdata\s+class\s+/, /\bcompanion\s+object/, /\b:\s*\w+\s*\)/],
        weight: 0
    },
    {
        id: 'lua', name: 'Lua', version: '5.4.4', pistonId: 'lua',
        patterns: [/\blocal\s+\w+/, /\bfunction\s+\w+\s*\(/, /\bprint\s*\(/, /\bio\.\w+/, /\bthen\b/, /\belseif\b/, /\bend\s*$/, /\brepeat\b/, /\buntil\b/],
        weight: 0
    },
    {
        id: 'perl', name: 'Perl', version: '5.36.0', pistonId: 'perl',
        patterns: [/\buse\s+strict/, /\bmy\s+\$\w+/, /\bprint\s+["']/, /\bsub\s+\w+/, /\$_\b/, /\@\w+/, /%\w+\s*=/, /=~\s*\//, /\bchomp\b/],
        weight: 0
    },
    {
        id: 'r', name: 'R', version: '4.1.1', pistonId: 'r',
        patterns: [/\blibrary\s*\(/, /<-\s*/, /\bfunction\s*\(/, /\bprint\s*\(/, /\bcat\s*\(/, /\bc\s*\(/, /\bdata\.frame\s*\(/, /\bggplot\s*\(/, /\bsource\s*\(/],
        weight: 0
    },
    {
        id: 'bash', name: 'Bash', version: '5.2.0', pistonId: 'bash',
        patterns: [/^#!\/bin\/(ba)?sh/m, /\becho\s+/, /\bif\s+\[/, /\bfi\s*$/, /\bdo\s*$/, /\bdone\s*$/, /\bfor\s+\w+\s+in\b/, /\bwhile\s+/, /\$\(\s*\w+/],
        weight: 0
    },
    {
        id: 'dart', name: 'Dart', version: '2.19.6', pistonId: 'dart',
        patterns: [/\bvoid\s+main\s*\(/, /\bprint\s*\(/, /\bimport\s+'dart:/, /\bString\s+\w+/, /\bWidget\s+build/, /\bfinal\s+\w+\s*=/, /\bvar\s+\w+\s*=/],
        weight: 0
    },
    {
        id: 'scala', name: 'Scala', version: '3.2.2', pistonId: 'scala',
        patterns: [/\bobject\s+\w+/, /\bdef\s+main\s*\(/, /\bprintln\s*\(/, /\bval\s+\w+\s*:/, /\bvar\s+\w+\s*:/, /\bimport\s+scala\./, /\bcase\s+class\b/],
        weight: 0
    },
    {
        id: 'haskell', name: 'Haskell', version: '9.0.1', pistonId: 'haskell',
        patterns: [/\bmodule\s+\w+/, /\bmain\s*=\s*do/, /\bputStrLn\s+/, /\bimport\s+/, /\bwhere\s*$/, /\blet\s+\w+\s*=/, /::\s*\w+\s*->/, /\bdata\s+\w+/],
        weight: 0
    }
];

// Piston API endpoint
const PISTON_API = 'https://emkc.org/api/v2/piston';

let compilerState = {
    initialized: false,
    detectedLang: null,
    manualLang: null,
    isRunning: false,
    lineCount: 1
};

/**
 * Detect the programming language from code content.
 * Returns the best-match language object.
 */
function detectLanguage(code) {
    if (!code || !code.trim()) return null;

    // Reset weights
    LANG_PATTERNS.forEach(lang => lang.weight = 0);

    // Score each language
    LANG_PATTERNS.forEach(lang => {
        lang.patterns.forEach(pattern => {
            const matches = code.match(new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g')));
            if (matches) {
                lang.weight += matches.length;
            }
        });
    });

    // Sort by weight descending
    const sorted = [...LANG_PATTERNS].sort((a, b) => b.weight - a.weight);

    // Return the best match if it has any weight
    if (sorted[0] && sorted[0].weight > 0) {
        return sorted[0];
    }

    // Default to Python if nothing detected
    return LANG_PATTERNS.find(l => l.id === 'python');
}

/**
 * Execute code via Piston API.
 */
async function executeCode(language, version, code, stdin = '') {
    const response = await fetch(`${PISTON_API}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            language: language,
            version: version,
            files: [{ name: `main`, content: code }],
            stdin: stdin,
            compile_timeout: 15000,
            run_timeout: 15000,
            compile_memory_limit: -1,
            run_memory_limit: -1
        })
    });

    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(`Execution failed (HTTP ${response.status}): ${err}`);
    }

    return await response.json();
}

/**
 * Update line numbers in the editor gutter.
 */
function updateLineNumbers(editor) {
    const gutter = document.getElementById('compiler-line-numbers');
    if (!gutter || !editor) return;

    const lines = editor.value.split('\n').length;
    if (lines === compilerState.lineCount) return;
    compilerState.lineCount = lines;

    let html = '';
    for (let i = 1; i <= lines; i++) {
        html += `<div>${i}</div>`;
    }
    gutter.innerHTML = html;
}

/**
 * Synchronize scroll between editor and line numbers.
 */
function syncScroll(editor) {
    const gutter = document.getElementById('compiler-line-numbers');
    if (gutter) {
        gutter.scrollTop = editor.scrollTop;
    }
}

/**
 * Update the language badge display.
 */
function updateLangBadge(lang) {
    const badge = document.getElementById('compiler-lang-badge');
    const badgeName = document.getElementById('compiler-lang-name');
    const badgeIndicator = document.getElementById('compiler-detect-indicator');

    if (!badge || !badgeName) return;

    if (lang) {
        badgeName.textContent = compilerState.manualLang ? `Manual '${lang.name}'` : `Detected '${lang.name}'`;
        badge.classList.add('detected');
        if (badgeIndicator) {
            badgeIndicator.style.display = 'none';
        }
    } else {
        badgeName.textContent = 'Auto-detect';
        badge.classList.remove('detected');
        if (badgeIndicator) {
            badgeIndicator.style.display = 'block';
            badgeIndicator.textContent = 'Waiting for code...';
        }
    }
}

/**
 * Render output in the console panel.
 */
function renderOutput(result) {
    const outputEl = document.getElementById('compiler-output');
    const statsEl = document.getElementById('compiler-stats');
    if (!outputEl) return;

    const compile = result.compile;
    const run = result.run;

    let outputHtml = '';
    let hasError = false;

    // Compile errors
    if (compile && compile.stderr) {
        hasError = true;
        outputHtml += `<div class="compiler-output-section error"><div class="compiler-output-label">⚠ Compilation Error</div><pre>${escapeHtml(compile.stderr)}</pre></div>`;
    }
    if (compile && compile.stdout) {
        outputHtml += `<div class="compiler-output-section"><div class="compiler-output-label">📦 Compile Output</div><pre>${escapeHtml(compile.stdout)}</pre></div>`;
    }

    // Runtime output
    if (run) {
        if (run.stdout) {
            outputHtml += `<div class="compiler-output-section success"><div class="compiler-output-label">✅ Output</div><pre>${escapeHtml(run.stdout)}</pre></div>`;
        }
        if (run.stderr) {
            hasError = true;
            outputHtml += `<div class="compiler-output-section error"><div class="compiler-output-label">❌ Runtime Error</div><pre>${escapeHtml(run.stderr)}</pre></div>`;
        }
        if (run.code !== 0 && run.code !== undefined) {
            outputHtml += `<div class="compiler-output-section warning"><div class="compiler-output-label">⚡ Exit Code: ${run.code}</div></div>`;
        }
        if (run.signal) {
            hasError = true;
            outputHtml += `<div class="compiler-output-section error"><div class="compiler-output-label">💀 Signal: ${run.signal}</div></div>`;
        }
        if (!run.stdout && !run.stderr && run.code === 0) {
            outputHtml += `<div class="compiler-output-section success"><div class="compiler-output-label">✅ Program executed successfully (no output)</div></div>`;
        }
    }

    outputEl.innerHTML = outputHtml || '<div class="compiler-output-section"><pre>No output</pre></div>';
    outputEl.classList.toggle('has-error', hasError);

    // Stats
    if (statsEl) {
        statsEl.innerHTML = `<span class="stat-item">Language: <strong>${result.language || 'Unknown'}</strong></span><span class="stat-item">Version: <strong>${result.version || '?'}</strong></span>`;
        statsEl.style.display = 'flex';
    }
}

/**
 * Main run handler — detect, execute, render.
 */
async function handleRun() {
    const editor = document.getElementById('compiler-editor');
    const runBtn = document.getElementById('compiler-run-btn');
    const outputEl = document.getElementById('compiler-output');
    const stdinInput = document.getElementById('compiler-stdin');

    if (!editor || compilerState.isRunning) return;

    const code = editor.value.trim();
    if (!code) {
        outputEl.innerHTML = '<div class="compiler-output-section warning"><div class="compiler-output-label">⚠ Please enter some code first</div></div>';
        return;
    }

    compilerState.isRunning = true;
    runBtn.disabled = true;
    runBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Running...';
    outputEl.innerHTML = '<div class="compiler-output-loading"><div class="compiler-spinner"></div><span>Compiling & executing...</span></div>';

    const lang = compilerState.manualLang || compilerState.detectedLang || detectLanguage(code);

    try {
        const result = await executeCode(lang.pistonId, lang.version, code, stdinInput?.value || '');
        renderOutput(result);
    } catch (err) {
        outputEl.innerHTML = `<div class="compiler-output-section error"><div class="compiler-output-label">❌ Execution Failed</div><pre>${escapeHtml(err.message)}</pre></div>`;
    } finally {
        compilerState.isRunning = false;
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fas fa-play"></i> Execute';
    }
}

/**
 * Clear the editor and output.
 */
function handleClear() {
    const editor = document.getElementById('compiler-editor');
    const outputEl = document.getElementById('compiler-output');
    const stdinInput = document.getElementById('compiler-stdin');
    const statsEl = document.getElementById('compiler-stats');

    if (editor) editor.value = '';
    if (outputEl) outputEl.innerHTML = '<div class="compiler-empty-output"><i class="fas fa-terminal"></i><span>Output will appear here</span></div>';
    if (stdinInput) stdinInput.value = '';
    if (statsEl) statsEl.style.display = 'none';

    compilerState.detectedLang = null;
    compilerState.manualLang = null;
    updateLangBadge(null);
    updateLineNumbers(editor);
}

/**
 * Build the language dropdown for manual override.
 */
function buildLangDropdown() {
    const dropdown = document.getElementById('compiler-lang-dropdown');
    if (!dropdown) return;

    let html = '<option value="">Auto-detect</option>';
    LANG_PATTERNS.forEach(lang => {
        html += `<option value="${lang.id}">${lang.name}</option>`;
    });
    dropdown.innerHTML = html;

    dropdown.addEventListener('change', () => {
        if (dropdown.value) {
            compilerState.manualLang = LANG_PATTERNS.find(l => l.id === dropdown.value);
        } else {
            compilerState.manualLang = null;
            // Re-detect from current code
            const editor = document.getElementById('compiler-editor');
            if (editor && editor.value.trim()) {
                compilerState.detectedLang = detectLanguage(editor.value);
            }
        }
        updateLangBadge(compilerState.manualLang || compilerState.detectedLang);
    });
}

/**
 * Initialize the compiler UI — called when workspace is activated.
 */
export function setupCompilerUI() {
    if (compilerState.initialized) return;
    compilerState.initialized = true;

    const editor = document.getElementById('compiler-editor');
    const runBtn = document.getElementById('compiler-run-btn');
    const clearBtn = document.getElementById('compiler-clear-btn');
    const stdinToggle = document.getElementById('compiler-stdin-toggle');
    const stdinSection = document.getElementById('compiler-stdin-section');

    if (!editor || !runBtn) return;

    // Editor input handler — auto-detect language on typing
    let detectTimer;
    editor.addEventListener('input', () => {
        updateLineNumbers(editor);

        clearTimeout(detectTimer);
        detectTimer = setTimeout(() => {
            if (!compilerState.manualLang) {
                const lang = detectLanguage(editor.value);
                compilerState.detectedLang = lang;
                updateLangBadge(lang);
            }
        }, 300);
    });

    editor.addEventListener('scroll', () => syncScroll(editor));

    // Tab key support inside editor
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
            editor.dispatchEvent(new Event('input'));
        }
        // Ctrl+Enter to run
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
    });

    // Run button
    runBtn.addEventListener('click', handleRun);

    // Clear button
    if (clearBtn) clearBtn.addEventListener('click', handleClear);

    // Stdin toggle
    if (stdinToggle && stdinSection) {
        stdinToggle.addEventListener('click', () => {
            const isVisible = stdinSection.style.display === 'block';
            stdinSection.style.display = isVisible ? 'none' : 'block';
            stdinToggle.classList.toggle('active', !isVisible);
        });
    }

    // Build language dropdown
    buildLangDropdown();

    // Initial line numbers
    updateLineNumbers(editor);
}

function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}
