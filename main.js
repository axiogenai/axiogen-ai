/**
 * main.js - Core UI and Chat logic for AXIOGEN
 */

import { setupTestingUI } from './forge.js';
import { setupCompilerUI } from './compiler.js';
import { speak, stopSpeaking, isSpeaking, loadVoices, changeVoice, getAvailableVoices, getSelectedVoice, cleanTextForSpeech } from './voice.js';
import { setupNeura, resetNeura } from './neura.js';
import { setupNsfw, resetNsfw } from './nsfw.js';

let savedHistory = [];
try {
    const raw = localStorage.getItem('AXIOGEN_history');
    if (raw) savedHistory = JSON.parse(raw);
} catch (e) { }

// Key Rotation Pool
let API_KEYS = [];
let currentKeyIndex = 0;

const state = {
    apiKey: '',
    history: savedHistory,
    currentMessages: [],
    currentChatId: null,
    isStreaming: false,
    selectedModel: localStorage.getItem('AXIOGEN_selected_model') || 'meta-llama/llama-3.2-3b-instruct:free',
    expertModel: localStorage.getItem('AXIOGEN_expert_model') || 'google/gemini-2.0-flash-001',
    currentWorkspace: null,
    tutorActivated: false,
    abortController: null,
    mainStreamReader: null,
    mainStreamDecoder: new TextDecoder(),
    attachments: []
};
window.state = state;

function updateApiKeyPool() {
    API_KEYS = [];

    // 1. Load keys from environment VITE_OPENROUTER_KEYS (highest priority pool)
    const envKeys = import.meta.env.VITE_OPENROUTER_KEYS || '';
    if (envKeys.trim()) {
        API_KEYS = envKeys.split(',').map(k => k.trim()).filter(Boolean);
    }

    // 2. If no env pool, fallback to single env VITE_OPENROUTER_API_KEY
    if (API_KEYS.length === 0 && import.meta.env.VITE_OPENROUTER_API_KEY) {
        API_KEYS.push(import.meta.env.VITE_OPENROUTER_API_KEY.trim());
    }

    // 3. Fallback to localStorage user entered key ONLY if no env keys are configured
    if (API_KEYS.length === 0) {
        const localKeys = localStorage.getItem('AXIOGEN_api_key') || '';
        if (localKeys.trim()) {
            API_KEYS = localKeys.split(',').map(k => k.trim()).filter(Boolean);
        }
    }

    // Reset index if out of bounds after pool refresh
    if (currentKeyIndex >= API_KEYS.length) currentKeyIndex = 0;

    // Sync current state apiKey
    if (API_KEYS.length > 0) {
        state.apiKey = API_KEYS[currentKeyIndex];
    } else {
        state.apiKey = '';
    }
}
window.updateApiKeyPool = updateApiKeyPool;
updateApiKeyPool();

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ========== ATTACHMENTS UI ==========
window.renderAttachments = function () {
    const bar = document.getElementById('attachments-bar');
    if (!bar) return;
    if (state.attachments && state.attachments.length > 0) {
        bar.style.display = 'flex';
        bar.innerHTML = state.attachments.map((att, i) => `
            <div class="attachment-pill">
                <i class="fas fa-file-alt"></i> ${att.name}
                <button onclick="window.removeAttachment(${i})">&times;</button>
            </div>
        `).join('');
    } else {
        bar.style.display = 'none';
        bar.innerHTML = '';
    }
};

window.removeAttachment = function (i) {
    if (state.attachments) {
        state.attachments.splice(i, 1);
        window.renderAttachments();

        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        if (chatInput && sendBtn) {
            sendBtn.disabled = !chatInput.value.trim() && state.attachments.length === 0;
        }
    }
};

// DOM Elements
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const chatDisplay = document.getElementById('chat-display');
const historyList = document.getElementById('history-list');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const apiKeyInput = document.getElementById('api-key-input');
const saveSettingsBtn = document.getElementById('save-settings');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebar = document.getElementById('sidebar');

const stopBtn = document.getElementById('stop-btn');
const expertModelInput = document.getElementById('expert-model-input');

function init() {
    try {
        const isMobileDevice = screen.width < 1024 && navigator.maxTouchPoints > 0;
        if (window.innerWidth <= 767 || isMobileDevice) {
            if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
                sidebar?.classList.add('collapsed');
            }
        }
        setupTestingUI();
        setupNeura(state);
        setupNsfw(state);
        renderHistory();

        loadVoices().then(() => {
            populateVoiceList();
        });
        window.speechSynthesis.addEventListener('voiceschanged', () => {
            populateVoiceList();
        });

        const voiceSelect = document.getElementById('neura-voice-select');
        if (voiceSelect) {
            voiceSelect.addEventListener('change', () => {
                if (voiceSelect.value) {
                    changeVoice(voiceSelect.value);
                }
            });
        }

        console.log("AXIOGEN Core Initialized");
    } catch (e) {
        console.error("Initialization Error:", e);
    }

    document.addEventListener('click', () => {
        document.querySelectorAll('.msg-more-dropdown.open').forEach(d => d.classList.remove('open'));
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (typeof window.axiogenSignOut === 'function') {
                window.axiogenSignOut();
            } else {
                localStorage.clear();
                window.location.reload();
            }
        });
    }

    if (expertModelInput) expertModelInput.value = state.expertModel;
    if (apiKeyInput) apiKeyInput.value = state.apiKey;

    const dropdown = document.getElementById('model-dropdown');
    const dropdownOptions = document.getElementById('dropdown-options');
    const selectedModelText = document.getElementById('selected-model-text');

    if (selectedModelText && state.selectedModel) {
        const activeOption = document.querySelector(`.option[data-value="${state.selectedModel}"]`);
        if (activeOption) {
            selectedModelText.textContent = activeOption.getAttribute('data-name') || activeOption.textContent.trim();
        }
    }

    if (dropdown) {
        dropdown.onclick = (e) => {
            dropdownOptions.classList.toggle('active');
            e.stopPropagation();
        };
    }

    document.querySelectorAll('.option').forEach(option => {
        option.onclick = (e) => {
            state.selectedModel = option.getAttribute('data-value');
            if (selectedModelText) {
                selectedModelText.textContent = option.getAttribute('data-name') || option.textContent.trim();
            }
            dropdownOptions.classList.remove('active');
            e.stopPropagation();
        };
    });

    if (chatInput) {
        chatInput.addEventListener('input', () => {
            const hasAttachments = state.attachments && state.attachments.length > 0;
            const hasContent = chatInput.value.trim().length > 0 || hasAttachments;

            const voiceBtn = document.getElementById('voice-input-btn');
            const sendBtn = document.getElementById('send-btn');

            if (voiceBtn) voiceBtn.style.display = (hasContent || state.isStreaming) ? 'none' : 'flex';
            if (sendBtn) {
                sendBtn.style.display = (hasContent && !state.isStreaming) ? 'flex' : 'none';
                sendBtn.disabled = !hasContent;
            }
        });
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const hasAttachments = state.attachments && state.attachments.length > 0;
                if (chatInput.value.trim() || hasAttachments) sendMessage();
            }
        });
    }

    sendBtn?.addEventListener('click', sendMessage);

    // Voice Input Logic
    const voiceInputBtn = document.getElementById('voice-input-btn');
    let recognition = null;
    let isListening = false;

    if (voiceInputBtn && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            voiceInputBtn.style.color = '#ff4444';
            voiceInputBtn.style.animation = 'pulse 1s infinite';
            voiceInputBtn.title = 'Listening... Click to stop';
        };

        recognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            chatInput.value = transcript;
            chatInput.dispatchEvent(new Event('input'));
        };

        recognition.onend = () => {
            isListening = false;
            voiceInputBtn.style.color = '';
            voiceInputBtn.style.animation = '';
            voiceInputBtn.title = 'Voice Input';
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            isListening = false;
            voiceInputBtn.style.color = '';
            voiceInputBtn.style.animation = '';
            voiceInputBtn.title = 'Voice Input';
        };

        voiceInputBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });
    } else if (voiceInputBtn) {
        voiceInputBtn.addEventListener('click', () => {
            voiceInputBtn.style.color = '#ff4444';
            voiceInputBtn.title = 'Voice not supported in this browser';
            setTimeout(() => {
                voiceInputBtn.style.color = '';
                voiceInputBtn.title = 'Voice Input';
            }, 2000);
        });
    }

    // ─── Enhance Prompt Button ─────────────────────────────────────
    const enhanceBtn = document.getElementById('enhance-prompt-btn');
    const ENHANCE_EXCLUDED = ['testing', 'sheets', 'axiogencode', 'docs'];

    window.updateEnhanceBtnVisibility = function () {
        if (!enhanceBtn) return;
        const hasText = chatInput?.value.trim().length > 0;
        const excluded = ENHANCE_EXCLUDED.includes(state.currentWorkspace);
        enhanceBtn.classList.toggle('enhance-hidden', excluded);
        enhanceBtn.classList.toggle('has-text', hasText && !excluded);
    };
    const updateEnhanceBtnVisibility = window.updateEnhanceBtnVisibility;
    updateEnhanceBtnVisibility();
    chatInput?.addEventListener('input', updateEnhanceBtnVisibility);

    if (enhanceBtn) {
        enhanceBtn.addEventListener('click', async () => {
            const rawPrompt = chatInput?.value.trim();
            if (!rawPrompt || enhanceBtn.classList.contains('enhancing')) return;

            enhanceBtn.classList.add('enhancing');

            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEYS[currentKeyIndex] || state.apiKey}`,
                        'HTTP-Referer': 'https://axiogen.ai',
                        'X-Title': 'AXIOGEN Prompt Enhancer'
                    },
                    body: JSON.stringify({
                        model: 'google/gemini-2.5-flash',
                        max_tokens: 180,
                        messages: [
                            {
                                role: 'system',
                                content: `You are an elite AI prompt engineer. Your job is to rewrite a user's rough prompt into a precise, detailed, and well-structured version that will get a much better response from an AI assistant.
 
Rules:
- Preserve the user's original intent completely — never change what they are asking for.
- Make the prompt more specific, clear, and actionable.
- Add helpful context, constraints, or desired output format if missing.
- Keep it concise — max 3–4 sentences.
- Output ONLY the enhanced prompt text. No explanations, no preamble.`
                            },
                            {
                                role: 'user',
                                content: `Enhance this prompt: ${rawPrompt}`
                            }
                        ]
                    })
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const enhanced = data?.choices?.[0]?.message?.content?.trim();

                if (enhanced) {
                    chatInput.value = enhanced;
                    chatInput.dispatchEvent(new Event('input'));
                    enhanceBtn.style.boxShadow = '0 0 24px rgba(0,255,255,0.6)';
                    setTimeout(() => { enhanceBtn.style.boxShadow = ''; }, 700);
                }
            } catch (err) {
                console.warn('Prompt enhancement failed:', err.message);
                enhanceBtn.style.color = '#ef4444';
                setTimeout(() => { enhanceBtn.style.color = ''; }, 1000);
            } finally {
                enhanceBtn.classList.remove('enhancing');
                enhanceBtn.querySelector('i').className = 'fas fa-wand-magic-sparkles';
                updateEnhanceBtnVisibility();
            }
        });
    }

    // File Upload Logic
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');

    uploadBtn?.addEventListener('click', () => {
        if (!window.AXIOGEN_SESSION) {
            const authOverlay = document.getElementById('inline-auth-overlay');
            if (authOverlay) authOverlay.classList.add('active');
            return;
        }
        fileInput.click();
    });

    fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        if (fileExtension === 'pdf') {
            uploadBtn.style.color = '#00ffff';
            uploadBtn.title = 'Extracting PDF...';

            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
                }

                state.attachments.push({ name: fileName, extension: fileExtension, content: fullText.trim() });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));
            } catch (err) {
                console.error('PDF extraction failed:', err);
                state.attachments.push({ name: fileName, extension: fileExtension, content: 'PDF extraction failed. Try a text-based file.' });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));
            }

            uploadBtn.style.color = '';
            uploadBtn.title = 'Upload File';
        } else if (fileExtension === 'docx' || fileExtension === 'doc') {
            uploadBtn.style.color = '#00ffff';
            uploadBtn.title = 'Extracting DOCX...';

            try {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                const docText = result.value;

                state.attachments.push({ name: fileName, extension: fileExtension, content: docText.trim() });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));
            } catch (err) {
                console.error('DOCX extraction failed:', err);
                state.attachments.push({ name: fileName, extension: fileExtension, content: 'DOCX extraction failed. Try a text-based file.' });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));
            }

            uploadBtn.style.color = '';
            uploadBtn.title = 'Upload File';
        } else if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(fileExtension)) {
            uploadBtn.style.color = '#00ffff';
            uploadBtn.title = 'Extracting Spreadsheet...';

            try {
                const arrayBuffer = await file.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                let fullText = '';

                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const csv = XLSX.utils.sheet_to_csv(sheet);
                    if (csv.trim()) {
                        fullText += `--- Sheet: ${sheetName} ---\n${csv}\n\n`;
                    }
                });

                state.attachments.push({ name: fileName, extension: fileExtension, content: fullText.trim() || '(Empty Spreadsheet)' });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));
            } catch (err) {
                console.error('Spreadsheet extraction failed:', err);
                state.attachments.push({ name: fileName, extension: fileExtension, content: 'Spreadsheet extraction failed. Try a text-based file.' });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));
            }

            uploadBtn.style.color = '';
            uploadBtn.title = 'Upload File';
        } else {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                state.attachments.push({ name: fileName, extension: fileExtension, content: content });
                window.renderAttachments();
                chatInput.dispatchEvent(new Event('input'));

                uploadBtn.style.color = 'var(--primary)';
                setTimeout(() => uploadBtn.style.color = '', 2000);
            };
            reader.readAsText(file);
        }

        fileInput.value = '';
    });

    const historySearch = document.getElementById('history-search');
    historySearch?.addEventListener('input', () => {
        renderHistory(historySearch.value.trim().toLowerCase());
    });

    stopBtn?.addEventListener('click', () => {
        if (state.abortController) state.abortController.abort();
    });
    settingsBtn?.addEventListener('click', () => settingsModal.classList.add('active'));
    saveSettingsBtn?.addEventListener('click', saveSettings);
    document.getElementById('clear-history-btn')?.addEventListener('click', () => {
        if (confirm('Delete all chat history permanently?')) {
            state.history = [];
            localStorage.removeItem('AXIOGEN_history');
            renderHistory();
            startNewChat();
        }
    });
    newChatBtn?.addEventListener('click', startNewChat);

    const tutorToggleBtn = document.getElementById('tutor-toggle-btn');
    const tutorStatusIcon = document.getElementById('tutor-status-icon');
    const tutorStatusText = document.getElementById('tutor-status-text');

    const updateTutorUI = () => {
        if (state.tutorActivated) {
            tutorToggleBtn.style.borderColor = '#10b981';
            tutorToggleBtn.style.background = 'rgba(16, 185, 129, 0.1)';
            tutorStatusIcon.style.color = '#10b981';
            tutorStatusText.style.color = '#10b981';
            tutorStatusText.textContent = 'Expert Tutor: On';
        } else {
            tutorToggleBtn.style.borderColor = 'rgba(255,255,255,0.1)';
            tutorToggleBtn.style.background = 'transparent';
            tutorStatusIcon.style.color = '#888';
            tutorStatusText.style.color = '#fff';
            tutorStatusText.textContent = 'Expert Tutor: Off';
        }
    };
    updateTutorUI();

    tutorToggleBtn?.addEventListener('click', () => {
        state.tutorActivated = !state.tutorActivated;
        localStorage.setItem('AXIOGEN_tutor_active', state.tutorActivated);
        updateTutorUI();
    });

    const sidebarBackdrop = document.getElementById('sidebar-backdrop');

    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
    }

    document.getElementById('sidebar-close-btn')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-open-btn')?.addEventListener('click', toggleSidebar);
    sidebarBackdrop?.addEventListener('click', () => {
        sidebar.classList.add('collapsed');
    });

    const sidebarSearchBtn = document.getElementById('sidebar-search-btn');
    if (sidebarSearchBtn) {
        sidebarSearchBtn.addEventListener('click', () => {
            openSearchModal();
        });
    }

    const searchInput = document.getElementById('search-chats-input');
    const searchClose = document.getElementById('search-modal-close');
    const searchModal = document.getElementById('search-modal');

    searchInput?.addEventListener('input', (e) => {
        renderSearchHistory(e.target.value);
    });

    searchClose?.addEventListener('click', closeSearchModal);

    searchModal?.addEventListener('click', (e) => {
        if (e.target === searchModal) {
            closeSearchModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSearchModal();
        }
    });

    const sidebarObserver = new MutationObserver(() => {
        const isCollapsed = sidebar.classList.contains('collapsed');
        const expandContainer = document.getElementById('sidebar-expand-container');
        if (expandContainer) {
            expandContainer.classList.toggle('active', isCollapsed);
        }
        if (sidebarBackdrop) {
            sidebarBackdrop.classList.toggle('active', !isCollapsed && window.innerWidth <= 767);
        }
    });

    if (sidebar) {
        sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        const isCollapsed = sidebar.classList.contains('collapsed');
        const expandContainer = document.getElementById('sidebar-expand-container');
        if (expandContainer) {
            expandContainer.classList.toggle('active', isCollapsed);
        }

        window.addEventListener('resize', () => {
            const currentCollapsed = sidebar.classList.contains('collapsed');
            if (sidebarBackdrop) {
                sidebarBackdrop.classList.toggle('active', !currentCollapsed && window.innerWidth <= 767);
            }
        });
    }

    document.querySelectorAll('.workspace-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const workspace = e.currentTarget.getAttribute('data-workspace');
            if (!window.AXIOGEN_SESSION && workspace !== 'neura') {
                const authOverlay = document.getElementById('inline-auth-overlay');
                if (authOverlay) authOverlay.classList.add('active');
                return;
            }

            resetNeura();
            resetNsfw();
            sidebar?.classList.remove('hover-expanded');
            sidebar?.classList.add('collapsed');

            console.log('Switching to workspace:', workspace);
            if (workspace === 'testing') {
                toggleTestingWorkspace(e.currentTarget);
                return;
            }
            if (workspace === 'trading') {
                toggleTradingWorkspace(e.currentTarget);
                return;
            }
            if (workspace === 'axiogencode') {
                toggleAxiogenCodeWorkspace(e.currentTarget);
                return;
            }
            if (['sheets', 'docs'].includes(workspace)) {
                toggleProgressWorkspace(workspace, e.currentTarget);
                return;
            }
            switchToWorkspace(workspace, e.currentTarget);
        });
    });

    // --- Orbital Atom Animation ---
    const cx = 150, cy = 150, rx = 110, ry = 42;
    const angles = [0, Math.PI / 3, 2 * Math.PI / 3];
    const speeds = [0.008, 0.007, 0.009];
    const phases = [0, Math.PI * 0.66, Math.PI * 1.33];
    let t = 0;

    const runAnimation = () => {
        const electrons = ['e1', 'e2', 'e3'].map(id => document.getElementById(id));
        const halos = ['h1', 'h2', 'h3'].map(id => document.getElementById(id));

        if (!electrons[0]) return;

        t += 1;
        electrons.forEach((el, i) => {
            const theta = phases[i] + t * speeds[i];
            const x = cx + rx * Math.cos(theta) * Math.cos(angles[i]) - ry * Math.sin(theta) * Math.sin(angles[i]);
            const y = cy + rx * Math.cos(theta) * Math.sin(angles[i]) + ry * Math.sin(theta) * Math.cos(angles[i]);
            el.setAttribute('cx', x);
            el.setAttribute('cy', y);
            if (halos[i]) {
                halos[i].setAttribute('cx', x);
                halos[i].setAttribute('cy', y);
            }
        });
        requestAnimationFrame(runAnimation);
    };
    runAnimation();
    chatInput?.dispatchEvent(new Event('input'));
}

function switchToWorkspace(workspace, btn) {
    if (workspace === 'nsfw') {
        const user = window.AXIOGEN_USER;
        const nsfwAuthorizedEmails = ['aditaypatil07@gmail.com', 'axiogen01@gmail.com'];
        if (!user || !nsfwAuthorizedEmails.includes(user.email)) {
            console.warn('Unauthorized access attempt to NSFW workspace.');
            if (btn) btn.classList.remove('workspace-active');
            return;
        }
    }

    resetNeura();
    resetNsfw();
    if (window.clearDocsAgentSelection) window.clearDocsAgentSelection();
    if (window.clearSheetsAgentSelection) window.clearSheetsAgentSelection();

    document.querySelectorAll('.workspace-btn').forEach(b => b.classList.remove('workspace-active'));
    hideAllWorkspaces();

    if (workspace === 'examination' || workspace === 'deepresearch') {
        state.currentWorkspace = workspace;
    } else if (workspace === null) {
        state.currentWorkspace = null;
    } else {
        state.currentWorkspace = (state.currentWorkspace === workspace) ? null : workspace;
    }

    localStorage.setItem('AXIOGEN_active_workspace', state.currentWorkspace || '');

    const tutorHeaderControls = document.getElementById('tutor-header-controls');
    const chatInputArea = document.querySelector('.chat-input-area');

    if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';

    if (state.currentWorkspace) {
        if (btn) btn.classList.add('workspace-active');

        chatDisplay.style.display = 'flex';
        if (chatInputArea) chatInputArea.style.display = 'block';

        if (state.currentWorkspace === 'examination') {
            if (tutorHeaderControls) tutorHeaderControls.style.display = 'flex';
            startNewChat(false);

            const ws = document.getElementById('welcome-screen');
            if (ws) ws.style.display = 'none';

            setTimeout(() => addMessageToUI('ai', 'Welcome student! How can I help you today?'), 50);
        } else if (state.currentWorkspace === 'neura') {
            document.getElementById('neura-container').style.display = 'block';
            chatDisplay.style.display = 'none';
            if (chatInputArea) chatInputArea.style.display = 'none';
            resetNeura();
        } else if (state.currentWorkspace === 'nsfw') {
            document.getElementById('nsfw-container').style.display = 'block';
            chatDisplay.style.display = 'none';
            if (chatInputArea) chatInputArea.style.display = 'none';
            resetNsfw();
        } else if (state.currentWorkspace === 'deepresearch') {
            if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';
            startNewChat(false);

            const ws = document.getElementById('welcome-screen');
            if (ws) ws.style.display = 'none';

            state.selectedModel = 'meta-llama/llama-3.3-70b-instruct:free';
            const selectedModelText = document.getElementById('selected-model-text');
            if (selectedModelText) selectedModelText.textContent = 'Meta Llama 3.3 70B';

            const deepResearchPrompt = `You are AXIOGEN Deep Research — an advanced research intelligence embedded in the AXIOGEN Intelligent Platform.

Your sole purpose is to conduct deep, exhaustive, and highly accurate research on any topic the user provides. You think like a PhD researcher, investigative journalist, strategy consultant, and critical analyst — all at once.

When a user gives you a topic, automatically conduct full deep research without asking unnecessary questions. Begin immediately.

---

RESEARCH OUTPUT FORMAT:

**🔍 TOPIC OVERVIEW**
Summarize what this topic is, why it matters, and what the key finding is — in 10 to 12 sentences. Write this for someone who may only read this section.

**📜 BACKGROUND & HISTORY**
Cover the origins, evolution, and major turning points of this topic. Explain the context that led to the current state in 5-6 lines.

**🧠 CORE CONCEPTS**
Define all key terms, frameworks, and ideas a reader needs to understand this topic fully. Use simple language. Include analogies where helpful in 10 to 12 sentences.

**📡 CURRENT STATE**
What is happening right now? Include the latest data, trends, breakthroughs, and expert consensus. Be specific — name dates, numbers, and sources.

**👥 KEY PLAYERS**
List the most important individuals, organizations, companies, or governments involved. Explain what role each plays and why they matter.

**⚖️ MULTIPLE PERSPECTIVES**
Present at least 3 to 4 distinct viewpoints on this topic — proponents, critics, skeptics, and neutral experts. Steelman each side fairly.

**📊 DATA & EVIDENCE**
Present the strongest data, studies, statistics, and reports available. Label the strength of evidence — robust, emerging, contested, or anecdotal. Flag conflicts between studies.

**⚠️ CHALLENGES & RISKS**
What are the biggest obstacles, controversies, ethical concerns, and unintended consequences? Include the strongest criticisms even if you disagree with them.

**🚀 OPPORTUNITIES & IMPLICATIONS**
What does this mean for the future? Who benefits? What could change? Cover short-term (1–2 years) and long-term (3–10 years) implications.

**🔮 FUTURE SCENARIOS**
Optimistic: best-case outcome and what makes it possible.
Base Case: most likely path based on current trends.
Pessimistic: what happens if key risks go unresolved.

**✅ KEY TAKEAWAYS**
Bullet-point the most important things to know. Keep it sharp and actionable. No fluff.

**📚 FURTHER READING**
Suggest authoritative sources, reports, experts, and search terms for the user to explore further.

---

RULES YOU MUST ALWAYS FOLLOW:

- Use **Markdown Tables** when explaining lists, comparisons, or technical data for clarity.
- Never fabricate statistics, citations, or quotes. If unsure, say so clearly.
- Always distinguish between confirmed fact, expert opinion, and speculation.
- Be specific — name real people, organizations, dates, and numbers.
- Cover angles the user did not think to ask about.
- Never pad with filler — every sentence must add value.
- Write in a clear, professional, and intellectually honest tone.
- If evidence is weak or missing, say so — do not pretend certainty.
- If a topic is controversial, present all sides fairly before drawing conclusions.
- Default output length: 1500 to 4000 words depending on topic complexity.
- Use markdown formatting — headers, bullets, bold for key terms.

---

If the user's message is vague, extract the most reasonable interpretation and begin research immediately. Do not stall. Do not ask more than one clarifying question if truly needed.

You are AXIOGEN. You research better than anyone.`;
            state.currentMessages.push({ role: 'system', content: deepResearchPrompt });
            setTimeout(() => addMessageToUI('ai', '<div style="color: #00ffff; font-family: \'Space Grotesk\', sans-serif; letter-spacing: 1px;"><i class="fas fa-search" style="margin-right: 8px;"></i> AXIOGEN is ready to dive deep to RESEARCH</strong></div>'), 50);
        } else {
            if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';
            chatDisplay.style.display = 'flex';
            if (chatInputArea) chatInputArea.style.display = 'block';

            if (!state.currentMessages.length) {
                startNewChat(false);
            }
        }
    } else {
        if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';
        chatDisplay.style.display = 'flex';
        if (chatInputArea) chatInputArea.style.display = 'block';
        startNewChat(true);
    }
    window.updateEnhanceBtnVisibility?.();
    syncTutorHeaderVisibility();
}

function syncTutorHeaderVisibility() {
    const tutorHeaderControls = document.getElementById('tutor-header-controls');
    if (tutorHeaderControls) {
        if (state.currentWorkspace === 'examination') {
            tutorHeaderControls.style.display = 'flex';
        } else {
            tutorHeaderControls.style.display = 'none';
        }
    }
}

function hideAllWorkspaces() {
    ['testing-container', 'trading-container', 'sheets-container', 'axiogencode-container', 'neura-container', 'nsfw-container', 'docs-container'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function toggleTradingWorkspace(btn) {
    const tradingContainer = document.getElementById('trading-container');
    const chatInputArea = document.querySelector('.chat-input-area');

    if (state.currentWorkspace === 'trading') {
        hideAllWorkspaces();
        tradingContainer.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'none';
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }
    } else {
        state.currentWorkspace = 'trading';
        hideAllWorkspaces();
        tradingContainer.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'none';
        document.querySelectorAll('.workspace-btn').forEach(b => b.classList.remove('workspace-active'));
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }

        const tutorHeaderControls = document.getElementById('tutor-header-controls');
        if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';
    }
    window.updateEnhanceBtnVisibility?.();
    syncTutorHeaderVisibility();
}

function toggleTestingWorkspace(btn) {
    const testingContainer = document.getElementById('testing-container');
    const chatInputArea = document.querySelector('.chat-input-area');

    if (state.currentWorkspace === 'testing') {
        hideAllWorkspaces();
        testingContainer.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'none';
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }
        setupTestingUI();
    } else {
        state.currentWorkspace = 'testing';
        hideAllWorkspaces();
        testingContainer.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'none';
        document.querySelectorAll('.workspace-btn').forEach(b => b.classList.remove('workspace-active'));
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }

        const tutorHeaderControls = document.getElementById('tutor-header-controls');
        if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';

        setupTestingUI();
    }
    window.updateEnhanceBtnVisibility?.();
    syncTutorHeaderVisibility();
}

function toggleAxiogenCodeWorkspace(btn) {
    const container = document.getElementById('axiogencode-container');
    const chatInputArea = document.querySelector('.chat-input-area');

    if (state.currentWorkspace === 'axiogencode') {
        hideAllWorkspaces();
        container.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'none';
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }
        setupCompilerUI();
    } else {
        state.currentWorkspace = 'axiogencode';
        hideAllWorkspaces();
        container.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'none';
        document.querySelectorAll('.workspace-btn').forEach(b => b.classList.remove('workspace-active'));
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }

        const tutorHeaderControls = document.getElementById('tutor-header-controls');
        if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';

        setupCompilerUI();
    }
    window.updateEnhanceBtnVisibility?.();
    syncTutorHeaderVisibility();
}

function toggleProgressWorkspace(workspace, btn) {
    const oldWorkspace = state.currentWorkspace;
    if (window.clearDocsAgentSelection) window.clearDocsAgentSelection(true);
    if (window.clearSheetsAgentSelection) window.clearSheetsAgentSelection(true);
    const containerId = `${workspace}-container`;
    const container = document.getElementById(containerId);
    const chatInputArea = document.querySelector('.chat-input-area');

    if (state.currentWorkspace === workspace) {
        if (window.clearDocsAgentSelection) window.clearDocsAgentSelection(true);
        if (window.clearSheetsAgentSelection) window.clearSheetsAgentSelection(true);
        hideAllWorkspaces();
        if (container) container.style.display = 'flex';
        chatDisplay.style.display = 'none';
        chatInputArea.style.display = 'block';

        if (workspace === 'docs') {
            document.body.classList.add('docs-mode');
            const docsMain = container.querySelector('.docs-main-container');
            if (docsMain) docsMain.style.display = 'flex';
        } else if (workspace === 'sheets') {
            document.body.classList.add('sheets-mode');
            const sheetsMain = container.querySelector('.sheets-main-container');
            if (sheetsMain) sheetsMain.style.display = 'flex';
        }
    } else {
        state.currentWorkspace = workspace;
        hideAllWorkspaces();
        if (container) container.style.display = 'flex';

        if (workspace === 'docs') {
            chatInputArea.style.display = 'block';
            document.body.classList.add('docs-mode');
            document.body.classList.remove('sheets-mode');

            let isDocsChat = false;
            if (state.currentMessages && state.currentMessages.length > 0 && state.currentMessages[0].role === 'system') {
                const sysContent = state.currentMessages[0].content || '';
                const isDeepResearch = sysContent.includes('AXIOGEN Deep Research');
                const activeChat = state.history.find(c => c.id === state.currentChatId);

                if (!isDeepResearch) {
                    if (activeChat && activeChat.workspace === 'docs') {
                        isDocsChat = true;
                    } else if (!activeChat && oldWorkspace === 'docs') {
                        isDocsChat = true;
                    }
                }
            }

            if (isDocsChat || window.isDocsAgentSelected?.()) {
                chatDisplay.style.display = 'flex';
                if (container) container.style.display = 'none';
            } else {
                chatDisplay.style.display = 'none';
                if (container) {
                    container.style.display = 'flex';
                    const docsMain = container.querySelector('.docs-main-container');
                    if (docsMain) docsMain.style.display = 'flex';
                }
            }
        } else if (workspace === 'sheets') {
            chatInputArea.style.display = 'block';
            document.body.classList.add('sheets-mode');
            document.body.classList.remove('docs-mode');

            let isSheetsChat = false;
            if (state.currentMessages && state.currentMessages.length > 0 && state.currentMessages[0].role === 'system') {
                const sysContent = state.currentMessages[0].content || '';
                const isDeepResearch = sysContent.includes('AXIOGEN Deep Research');
                const activeChat = state.history.find(c => c.id === state.currentChatId);

                if (!isDeepResearch) {
                    if (activeChat && activeChat.workspace === 'sheets') {
                        isSheetsChat = true;
                    } else if (!activeChat && oldWorkspace === 'sheets') {
                        isSheetsChat = true;
                    }
                }
            }

            if (isSheetsChat || window.isSheetsAgentSelected?.()) {
                chatDisplay.style.display = 'flex';
                if (container) container.style.display = 'none';
            } else {
                chatDisplay.style.display = 'none';
                if (container) {
                    container.style.display = 'flex';
                    const sheetsMain = container.querySelector('.sheets-main-container');
                    if (sheetsMain) sheetsMain.style.display = 'flex';
                }
            }
        } else {
            document.body.classList.remove('docs-mode');
            document.body.classList.remove('sheets-mode');
            chatDisplay.style.display = 'none';
            chatInputArea.style.display = 'none';
        }
        document.querySelectorAll('.workspace-btn').forEach(b => b.classList.remove('workspace-active'));
        btn.classList.add('workspace-active');
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }

        const tutorHeaderControls = document.getElementById('tutor-header-controls');
        if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';
    }
    window.updateEnhanceBtnVisibility?.();
    syncTutorHeaderVisibility();
}

function getTrivialResponse(text) {
    const cleaned = text.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const greetings = ['hi', 'hello', 'hey', 'yo', 'hola', 'greetings', 'gday'];
    if (greetings.includes(cleaned)) {
        return "Hello! I am AXIOGEN. How can I assist you today?";
    }

    if (['good morning', 'good afternoon', 'good evening'].includes(cleaned)) {
        return `Good ${cleaned.split(' ')[1]}! How can I help you today?`;
    }

    const statusChecks = [
        'how are you', 'how are you doing', 'how is it going', 'hows it going',
        'how do you do', 'whats up', 'what up', 'sup'
    ];
    if (statusChecks.includes(cleaned)) {
        return "I'm performing at peak efficiency and ready to assist you. How can I help you today?";
    }

    const identityQuestions = [
        'who are you', 'what are you', 'what is your name', 'whats your name',
        'your name', 'who created you', 'who made you'
    ];
    if (identityQuestions.includes(cleaned)) {
        return "I am AXIOGEN, an advanced intelligence running on the AXIOGEN Intelligent Platform. I specialize in deep research, code generation, and complex analysis.";
    }

    const thanks = [
        'thank you', 'thanks', 'thank you so much', 'thanks a lot', 'thanks so much',
        'appreciate it', 'much appreciated'
    ];
    if (thanks.includes(cleaned)) {
        return "You're very welcome! Let me know if you need help with anything else.";
    }

    const farewells = [
        'bye', 'goodbye', 'see you', 'see you later', 'see ya', 'talk to you later',
        'bye bye'
    ];
    if (farewells.includes(cleaned)) {
        return "Goodbye! Have a productive day, and feel free to start a session whenever you need help.";
    }

    return null;
}

async function sendMessage() {
    let rawInput = chatInput.value.trim();
    if (!rawInput && (!state.attachments || state.attachments.length === 0)) return;
    if (state.isStreaming) return;
    if (!state.apiKey) return settingsModal.classList.add('active');

    const ws = document.getElementById('welcome-screen');
    if (ws) ws.style.display = 'none';

    let payloadContent = rawInput;
    let hasAttachments = state.attachments && state.attachments.length > 0;

    if (hasAttachments) {
        let attachText = state.attachments.map(att => `[FILE: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\`\n`).join('\n');
        payloadContent = payloadContent ? `${attachText}\n\n${payloadContent}` : attachText;
    }

    addMessageToUI('user', payloadContent);

    if (hasAttachments) {
        state.attachments = [];
        if (window.renderAttachments) window.renderAttachments();
    }

    state.currentMessages.push({ role: 'user', content: payloadContent });
    localStorage.setItem('AXIOGEN_current_session', JSON.stringify(state.currentMessages));

    chatInput.value = '';
    chatInput.dispatchEvent(new Event('input'));

    const trivialReply = getTrivialResponse(payloadContent);
    if (trivialReply) {
        state.isStreaming = true;
        if (stopBtn) stopBtn.style.display = 'flex';

        const voiceBtn = document.getElementById('voice-input-btn');
        const sendBtn = document.getElementById('send-btn');
        if (voiceBtn) voiceBtn.style.display = 'none';
        if (sendBtn) sendBtn.style.display = 'none';

        const aiContentDiv = addMessageToUI('ai', '');
        let currentText = '';
        let i = 0;

        const streamInterval = setInterval(() => {
            if (i < trivialReply.length) {
                currentText += trivialReply[i];
                aiContentDiv.innerHTML = (typeof marked !== 'undefined') ? marked.parse(currentText) : currentText;
                i++;
                chatDisplay.scrollTop = chatDisplay.scrollHeight;
            } else {
                clearInterval(streamInterval);
                state.isStreaming = false;
                if (stopBtn) stopBtn.style.display = 'none';

                state.currentMessages.push({ role: 'assistant', content: trivialReply });
                localStorage.setItem('AXIOGEN_current_session', JSON.stringify(state.currentMessages));
                saveHistory();
                renderHistory();

                if (trivialReply.length > 5) {
                    const wrapper = aiContentDiv.closest('.message-wrapper');
                    if (wrapper) {
                        addActionBarToWrapper(wrapper, 'ai', trivialReply, aiContentDiv);
                    }
                }

                chatInput.dispatchEvent(new Event('input'));
            }
        }, 15);

        return;
    }

    await streamResponse();
}

async function streamResponse() {
    state.isStreaming = true;
    if (stopBtn) stopBtn.style.display = 'flex';

    const voiceBtn = document.getElementById('voice-input-btn');
    const sendBtn = document.getElementById('send-btn');
    if (voiceBtn) voiceBtn.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'none';

    const aiContentDiv = addMessageToUI('ai', '');
    let fullText = '';

    // Create the user-facing abort controller (for the Stop button)
    state.abortController = new AbortController();

    // ─── FIXED: rotateKey reads directly from API_KEYS array ────────────────
    const rotateKey = () => {
        if (API_KEYS.length <= 1) return;
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        state.apiKey = API_KEYS[currentKeyIndex];
        console.log(`AXIOGEN Key Rotation: Switched to Key Index ${currentKeyIndex}`);
    };
    window.rotateAxiogenKey = rotateKey;

    // ─── FIXED: always reads API_KEYS[currentKeyIndex] at call time ──────────
    const makeFetchRequest = async (modelName, maxTokens, signal) => {
        return fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEYS[currentKeyIndex] || state.apiKey}`,
                'Content-Type': 'application/json'
            },
            signal,
            body: JSON.stringify({
                model: modelName,
                messages: state.currentMessages,
                max_tokens: maxTokens,
                stream: true
            })
        });
    };

    try {
        let response;
        let attempts = 0;
        const maxAttempts = Math.max(API_KEYS.length, 1);

        // ─── FIXED rotation loop ─────────────────────────────────────────────
        while (attempts < maxAttempts) {
            // Per-attempt timeout controller, merged with the user's stop signal
            const timeoutController = new AbortController();
            const tId = setTimeout(() => {
                console.warn('[AXIOGEN] Request timed out (8s), rotating key...');
                timeoutController.abort();
            }, 8000);

            // Propagate user Stop → timeout controller so fetch is cancelled
            const userAbortHandler = () => timeoutController.abort();
            state.abortController.signal.addEventListener('abort', userAbortHandler, { once: true });

            try {
                response = await makeFetchRequest(state.selectedModel, 2048, timeoutController.signal);
                clearTimeout(tId);
                state.abortController.signal.removeEventListener('abort', userAbortHandler);

                // If the user pressed Stop, honour it immediately
                if (state.abortController.signal.aborted) {
                    throw new DOMException('Aborted by user', 'AbortError');
                }

                // ── FIXED: clone ONCE here for safe body inspection ──────────
                let statusText = '';
                if (response.status === 402 || response.status === 400) {
                    statusText = await response.clone().text();
                }

                const isExhausted =
                    response.status === 429 ||
                    response.status === 402 ||
                    (response.status === 400 && statusText.includes('afford'));

                if (isExhausted && API_KEYS.length > 1 && attempts < maxAttempts - 1) {
                    console.warn(`[AXIOGEN] Key ${currentKeyIndex} exhausted (${response.status}), rotating...`);
                    rotateKey();
                    attempts++;
                    continue; // retry with next key
                }

                // Either success or no more keys — exit loop
                break;

            } catch (err) {
                clearTimeout(tId);
                state.abortController.signal.removeEventListener('abort', userAbortHandler);

                // User pressed Stop — propagate as a real abort
                if (state.abortController.signal.aborted) {
                    throw new DOMException('Aborted by user', 'AbortError');
                }

                // Timeout abort → rotate if we have more keys
                if (err.name === 'AbortError' && API_KEYS.length > 1 && attempts < maxAttempts - 1) {
                    rotateKey();
                    attempts++;
                    continue;
                }

                throw err; // unrecoverable error
            }
        }

        // ─── Global 429 fallback (all keys exhausted) ────────────────────────
        if (response.status === 429) {
            console.warn('All keys rate limited. Routing through AXIOGEN-FLASH...');
            aiContentDiv.innerHTML = '<div style="font-size: 0.75rem; color: #a78bfa; opacity: 0.8; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 6px;"><i class="fas fa-microchip fa-spin"></i> Primary limit reached. Routing through AXIOGEN-FLASH...</div>';

            const fallbackController = new AbortController();
            state.abortController.signal.addEventListener('abort', () => fallbackController.abort(), { once: true });
            response = await makeFetchRequest('google/gemini-2.0-flash-001', 1024, fallbackController.signal);
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error?.message || `HTTP ${response.status}`;

            if (response.status === 429) {
                aiContentDiv.innerHTML = `
                    <div class="error-card" style="background: rgba(248, 113, 113, 0.05); border: 1px solid rgba(248, 113, 113, 0.2); padding: 1rem; border-radius: 12px; color: #fca5a5;">
                        <div style="font-weight: 600; margin-bottom: 0.5rem;"><i class="fas fa-exclamation-triangle"></i> Rate Limit Exceeded</div>
                        <div style="font-size: 0.85rem; opacity: 0.8; line-height: 1.4;">
                            You have reached the daily request limit for free models on OpenRouter.
                            To continue, you can wait for the limit to reset or add credits to your OpenRouter account to unlock higher tiers.
                        </div>
                    </div>`;
                throw new Error("RATE_LIMIT_HANDLED");
            }
            throw new Error(errMsg);
        }

        if (!response.body) throw new Error('ReadableStream not supported or empty body');

        state.mainStreamReader = response.body.getReader();
        let renderBuffer = '';
        let displayBuffer = '';
        let isRendering = true;

        const renderLoop = () => {
            if (!isRendering && renderBuffer.length === 0) return;

            if (renderBuffer.length > 0) {
                const chunkSize = Math.max(1, Math.ceil(renderBuffer.length / 5));
                displayBuffer += renderBuffer.substring(0, chunkSize);
                renderBuffer = renderBuffer.substring(chunkSize);

                aiContentDiv.innerHTML = (state.tutorActivated) ?
                    '<div class="interpreting-loader"><i class="fas fa-brain fa-spin"></i> AXIOGEN is interpreting expert insights...</div>' :
                    ((typeof marked !== 'undefined') ? marked.parse(displayBuffer) : displayBuffer);
                chatDisplay.scrollTop = chatDisplay.scrollHeight;
            }

            if (isRendering || renderBuffer.length > 0) {
                requestAnimationFrame(renderLoop);
            }
        };
        requestAnimationFrame(renderLoop);

        while (true) {
            const { done, value } = await state.mainStreamReader.read();
            if (done) break;
            const chunk = state.mainStreamDecoder.decode(value);
            const lines = chunk.split(/\r?\n/);
            for (const line of lines) {
                if (line.trim().startsWith('data: ')) {
                    const data = line.trim().slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const token = JSON.parse(data).choices[0]?.delta?.content || '';
                        fullText += token;
                        renderBuffer += token;
                    } catch (e) { }
                }
            }
        }
        isRendering = false;

        state.currentMessages.push({ role: 'assistant', content: fullText });
        localStorage.setItem('AXIOGEN_current_session', JSON.stringify(state.currentMessages));
        saveHistory();

        state.isStreaming = false;
        state.abortController = null;
        if (stopBtn) stopBtn.style.display = 'none';
        if (sendBtn) sendBtn.disabled = false;

        if (state.tutorActivated && fullText.length > 0) {
            aiContentDiv.innerHTML = '<div class="interpreting-loader"><i class="fas fa-brain fa-spin"></i> AXIOGEN is synthesizing pedagogical insights...</div>';
            handleExplanation(fullText, aiContentDiv, aiContentDiv.closest('.message-wrapper'), fullText);
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            aiContentDiv.innerHTML += ' <br><br><em>[Generation Interrupted]</em>';
        } else if (e.message === 'RATE_LIMIT_HANDLED') {
            // Already displayed the error card
        } else if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
            aiContentDiv.innerHTML = `<div style="color: #fca5a5; padding: 1rem; background: rgba(252,165,165,0.08); border: 1px solid rgba(252,165,165,0.2); border-radius: 12px;"><i class="fas fa-wifi" style="margin-right: 8px;"></i>Network connection lost. Please check your internet and try again.</div>`;
        } else {
            aiContentDiv.innerHTML = `<div style="color: #fca5a5; padding: 1rem; background: rgba(252,165,165,0.08); border: 1px solid rgba(252,165,165,0.2); border-radius: 12px;"><i class="fas fa-exclamation-circle" style="margin-right: 8px;"></i>${e.message}</div>`;
        }
    } finally {
        state.isStreaming = false;
        state.abortController = null;
        if (stopBtn) stopBtn.style.display = 'none';

        const hasContent = chatInput.value.trim().length > 0;
        const voiceBtnFinal = document.getElementById('voice-input-btn');
        const sendBtnFinal = document.getElementById('send-btn');

        if (voiceBtnFinal) voiceBtnFinal.style.display = hasContent ? 'none' : 'flex';
        if (sendBtnFinal) sendBtnFinal.style.display = hasContent ? 'flex' : 'none';

        addCopyButtons(aiContentDiv);

        if (fullText.length > 5 && !state.tutorActivated) {
            const wrapper = aiContentDiv.closest('.message-wrapper');
            if (wrapper && !wrapper.querySelector('.message-actions')) {
                addActionBarToWrapper(wrapper, 'ai', fullText, aiContentDiv);
            }
        }
    }
}


function addCopyButtons(container) {
    if (!container) return;
    const codeBlocks = container.querySelectorAll('pre');
    codeBlocks.forEach(block => {
        if (block.querySelector('.copy-code-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'copy-code-btn';
        btn.innerHTML = '<i class="far fa-copy"></i>';
        btn.title = 'Copy code';

        btn.onclick = (e) => {
            e.stopPropagation();
            const code = block.querySelector('code')?.innerText || block.innerText;
            navigator.clipboard.writeText(code).then(() => {
                btn.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i>';
                setTimeout(() => {
                    btn.innerHTML = '<i class="far fa-copy"></i>';
                }, 2000);
            });
        };

        block.style.position = 'relative';
        block.appendChild(btn);
    });
}

function addMessageToUI(role, content) {
    const ws = document.getElementById('welcome-screen');
    if (ws) ws.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${role}-message`;
    if (state.currentWorkspace) {
        wrapper.dataset.workspace = state.currentWorkspace;
    }
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'user') {
        let userHTML = content;
        userHTML = userHTML.replace(/\[FILE: (.*?)\]\n```[\s\S]*?```\n*/g, '<div class="attachment-pill" style="display: inline-flex; pointer-events: none;"><i class="fas fa-file-alt"></i> $1</div>');
        if (userHTML.includes('attachment-pill')) {
            userHTML = userHTML.replace(/(<div class="attachment-pill"[\s\S]*?<\/div>)+/g, '<div class="attachments-container" style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-bottom: 8px;">$&</div>');
        }
        userHTML = userHTML.replace(/\n/g, '<br>');
        contentDiv.innerHTML = `<div style="text-align: right; word-break: break-word;">${userHTML}</div>`;
    } else {
        contentDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(content) : content;
    }

    const hasUserMessage = state.currentMessages.some(m => m.role === 'user');
    if (role === 'ai' && state.tutorActivated && !state._loadingHistory && hasUserMessage && content.length > 0) {
        handleExplanation(content, contentDiv);
    }

    wrapper.appendChild(contentDiv);

    if (role === 'ai' && content.length > 5) {
        addActionBarToWrapper(wrapper, role, content, contentDiv);
    }

    chatDisplay.appendChild(wrapper);
    chatDisplay.scrollTop = chatDisplay.scrollHeight;

    if (role === 'ai') {
        addCopyButtons(contentDiv);
    }

    return contentDiv;
}

function addActionBarToWrapper(wrapper, role, content, contentDiv) {
    if (wrapper.querySelector('.message-actions')) return;

    const wsName = wrapper.dataset.workspace || state.currentWorkspace;
    const isSheetsMode = document.body.classList.contains('sheets-mode');
    const isDocsMode = document.body.classList.contains('docs-mode');
    const showDownload = ['sheets', 'docs'].includes(wsName) || isSheetsMode || isDocsMode;

    console.log('[AXIOGEN Debug] addActionBarToWrapper:', {
        wsName, isSheetsMode, isDocsMode, showDownload,
        currentWorkspace: state.currentWorkspace,
        wrapperDataset: { ...wrapper.dataset }
    });

    const actionBar = document.createElement('div');
    actionBar.className = 'message-actions';
    actionBar.innerHTML = `
        <button class="msg-action-btn like-btn" title="Good response">
            <i class="far fa-thumbs-up"></i>
        </button>
        <button class="msg-action-btn dislike-btn" title="Bad response">
            <i class="far fa-thumbs-down"></i>
        </button>
        <button class="msg-action-btn copy-msg-btn" title="Copy">
            <i class="far fa-copy"></i>
        </button>
        ${showDownload ? `
        <button class="msg-action-btn download-msg-btn" title="Download Report">
            <i class="fas fa-download"></i>
        </button>
        ` : ''}
        <button class="msg-action-btn retry-btn" title="Retry">
            <i class="fas fa-redo-alt"></i>
        </button>
        <div class="msg-more-menu-wrap">
            <button class="msg-action-btn more-menu-btn" title="More">
                <i class="fas fa-ellipsis-h"></i>
            </button>
            <div class="msg-more-dropdown">
                <button class="msg-dropdown-item branch-btn">
                    <i class="fas fa-code-branch"></i> Branch in new chat
                </button>
                <button class="msg-dropdown-item read-aloud-btn">
                    <i class="fas fa-volume-up"></i> Read aloud
                </button>
            </div>
        </div>
    `;

    const likeBtn = actionBar.querySelector('.like-btn');
    const dislikeBtn = actionBar.querySelector('.dislike-btn');
    likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = likeBtn.classList.toggle('active');
        if (isActive) dislikeBtn.classList.remove('active');
        console.log('Feedback: Like toggled');
    });
    dislikeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = dislikeBtn.classList.toggle('active');
        if (isActive) likeBtn.classList.remove('active');
        console.log('Feedback: Dislike toggled');
    });

    const copyBtn = actionBar.querySelector('.copy-msg-btn');
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const textToCopy = contentDiv.innerText || contentDiv.textContent;
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyBtn.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i>';
            setTimeout(() => { copyBtn.innerHTML = '<i class="far fa-copy"></i>'; }, 2000);
            console.log('Action: Message copied');
        });
    });

    if (showDownload) {
        const downloadBtn = actionBar.querySelector('.download-msg-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            const textToDownload = content;
            const chatTitle = state.history.find(c => c.id === state.currentChatId)?.title || 'report';
            const cleanTitle = chatTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30) || 'workspace_report';
            const timestamp = new Date().toISOString().slice(0, 10);
            const actualWs = ['sheets', 'docs'].includes(wsName) ? wsName : (isSheetsMode ? 'sheets' : (isDocsMode ? 'docs' : 'report'));
            const filename = `${cleanTitle}_${actualWs}_${timestamp}.md`;

            const blob = new Blob([textToDownload], { type: 'text/markdown;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            downloadBtn.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i>';
            setTimeout(() => {
                downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
            }, 2000);

            console.log(`Action: Report downloaded as ${filename}`);
        });
    }

    const retryBtn = actionBar.querySelector('.retry-btn');
    retryBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        console.log('Action: Retry initiated');
        const allWrappers = Array.from(document.querySelectorAll('.message-wrapper'));
        const index = allWrappers.indexOf(wrapper);
        if (index === -1) return;

        state.currentMessages = state.currentMessages.slice(0, index);
        localStorage.setItem('AXIOGEN_current_session', JSON.stringify(state.currentMessages));

        while (wrapper.nextElementSibling) {
            wrapper.nextElementSibling.remove();
        }
        wrapper.remove();

        await streamResponse();
    });

    const moreBtn = actionBar.querySelector('.more-menu-btn');
    const moreDropdown = actionBar.querySelector('.msg-more-dropdown');
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.msg-more-dropdown.open').forEach(d => {
            if (d !== moreDropdown) d.classList.remove('open');
        });
        moreDropdown.classList.toggle('open');
    });

    const readAloudBtn = actionBar.querySelector('.read-aloud-btn');
    readAloudBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreDropdown.classList.remove('open');

        const isCurrentlyReadingThis = readAloudBtn.innerHTML.includes('Stop');
        stopSpeaking();

        document.querySelectorAll('.read-aloud-btn').forEach(btn => {
            btn.innerHTML = '<i class="fas fa-volume-up"></i> Read aloud';
        });

        if (isCurrentlyReadingThis) return;

        const tempDiv = contentDiv.cloneNode(true);
        tempDiv.querySelectorAll('.copy-code-btn').forEach(b => b.remove());
        tempDiv.querySelectorAll('.expert-badge').forEach(b => b.remove());
        tempDiv.querySelectorAll('.interpreting-loader').forEach(l => l.remove());
        tempDiv.querySelectorAll('style').forEach(s => s.remove());
        tempDiv.querySelectorAll('table').forEach(t => t.remove());
        tempDiv.querySelectorAll('.expert-explanation-zone').forEach(z => z.remove());
        tempDiv.querySelectorAll('div').forEach(d => {
            if (d.textContent.includes('Expert AI Instruction')) d.remove();
        });

        const rawText = tempDiv.innerText || tempDiv.textContent || '';
        const speechText = cleanTextForSpeech(rawText);

        if (!speechText.trim()) return;

        readAloudBtn.innerHTML = '<i class="fas fa-stop"></i> Stop reading';
        speak(speechText, () => {
            readAloudBtn.innerHTML = '<i class="fas fa-volume-up"></i> Read aloud';
        });
    });

    const branchBtn = actionBar.querySelector('.branch-btn');
    branchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreDropdown.classList.remove('open');

        const allWrappers = Array.from(document.querySelectorAll('.message-wrapper'));
        const index = allWrappers.indexOf(wrapper);
        if (index === -1) return;

        const branchedMessages = state.currentMessages.slice(0, index + 1);

        state.currentMessages = branchedMessages;
        state.currentChatId = null;
        localStorage.removeItem('AXIOGEN_current_chat_id');
        localStorage.setItem('AXIOGEN_current_session', JSON.stringify(state.currentMessages));

        clearChatDisplay();
        state.currentMessages.forEach(msg => {
            addMessageToUI(msg.role === 'assistant' ? 'ai' : (msg.role === 'user' ? 'user' : ''), msg.content);
        });
        saveHistory();
    });

    wrapper.appendChild(actionBar);
}

async function handleExplanation(content, targetDiv, wrapper = null, rawContent = '') {
    const firstAiMessage = document.querySelector('.ai-message .message-content');
    if (firstAiMessage && !firstAiMessage.querySelector('.expert-badge')) {
        state.tutorActivated = true;
        localStorage.setItem('AXIOGEN_tutor_active', 'true');
        const badge = document.createElement('div');
        badge.className = 'expert-badge';
        badge.style = "font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: var(--primary); margin-top: 0.8rem; display: flex; align-items: center; gap: 8px; opacity: 0.8;";
        badge.innerHTML = '<div style="width: 6px; height: 6px; background: var(--primary); border-radius: 50%; box-shadow: 0 0 10px var(--primary);"></div> Expert Tutor Activated';
        firstAiMessage.appendChild(badge);
    }

    try {
        // Use current key index directly for expert calls too
        const expertHeaders = {
            'Authorization': `Bearer ${API_KEYS[currentKeyIndex] || state.apiKey}`,
            'Content-Type': 'application/json'
        };

        const expertMessages = [
            {
                role: 'system',
                content: `You are AXIOGEN Expert Tutor — an elite academic AI. Your ONLY job is to explain the content given to you. 
RULES YOU MUST NEVER BREAK:
- NEVER ask for content. The content is already provided in the user message. START explaining immediately.
- NEVER say "Certainly", "Sure", "Of course", "I'd be happy to", "Please provide", "Waiting for your content", or any other filler.
- NEVER write an introduction about what you are going to do. Just DO it.
- BEGIN your response with the actual explanation — first word must be a real concept or heading.
- Use **bold** for key terms, markdown tables for comparisons, code blocks for code examples.
- Be deep, precise, and academically rigorous but easy to understand.`
            },
            { role: 'user', content: `HERE IS THE CONTENT TO EXPLAIN — start your expert explanation immediately, first word:\n\n${content}` }
        ];

        let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: expertHeaders,
            body: JSON.stringify({
                model: state.expertModel,
                messages: expertMessages,
                max_tokens: 1500,
                stream: true
            })
        });

        if (response.status === 429) {
            console.warn('Expert model rate limited. Falling back to Gemini 2.0 Flash...');
            response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: expertHeaders,
                body: JSON.stringify({
                    model: 'google/gemini-2.0-flash-001',
                    messages: expertMessages,
                    max_tokens: 1500,
                    stream: true
                })
            });
        }

        if (!response.ok) throw new Error('Expert API failed');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let expertFullText = '';
        let expertRenderBuffer = '';
        let expertDisplayBuffer = '';
        let expertIsRendering = true;

        targetDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 1rem; color: var(--primary); font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px;">
                <i class="fas fa-user-graduate"></i> Expert AI Instruction
            </div>
            <div class="interpreting-loader"><i class="fas fa-brain fa-spin"></i> AXIOGEN is synthesizing pedagogical insights...</div>
        `;

        const expertRenderLoop = () => {
            if (!expertIsRendering && expertRenderBuffer.length === 0) return;

            if (expertRenderBuffer.length > 0) {
                const chunkSize = Math.max(1, Math.ceil(expertRenderBuffer.length / 3));
                expertDisplayBuffer += expertRenderBuffer.substring(0, chunkSize);
                expertRenderBuffer = expertRenderBuffer.substring(chunkSize);

                let processedText = expertDisplayBuffer.replace(/^(The mission of|I am an|As an AI|Hello|Certainly|Here is|My goal is|I will explain|The main idea here is|The mission of)[^.!?]*[.!?]\s*/gi, '');
                processedText = processedText.replace(/^(The main idea here is to provide an expert guidance)[^.]*.\s*/gi, '');

                const header = `
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 1rem; color: var(--primary); font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px;">
                        <i class="fas fa-user-graduate"></i> Expert AI Instruction
                    </div>
                `;
                targetDiv.innerHTML = header + (typeof marked !== 'undefined' ? marked.parse(processedText) : processedText);
                chatDisplay.scrollTop = chatDisplay.scrollHeight;
            }

            if (expertIsRendering || expertRenderBuffer.length > 0) {
                requestAnimationFrame(expertRenderLoop);
            }
        };
        requestAnimationFrame(expertRenderLoop);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split(/\r?\n/);
            for (const line of lines) {
                if (line.trim().startsWith('data: ')) {
                    const data = line.trim().slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const token = JSON.parse(data).choices[0]?.delta?.content || '';
                        expertFullText += token;
                        expertRenderBuffer += token;
                    } catch (e) { }
                }
            }
        }
        expertIsRendering = false;

        await new Promise(resolve => setTimeout(resolve, 150));

        if (expertFullText.length > 0) {
            const lastAssistant = [...state.currentMessages].reverse().find(m => m.role === 'assistant');
            if (lastAssistant) {
                lastAssistant.expertHtml = targetDiv.innerHTML;
                const chatEntry = state.history.find(c => c.id === state.currentChatId);
                if (chatEntry) {
                    chatEntry.tutorMode = true;
                    chatEntry.messages = [...state.currentMessages];
                    localStorage.setItem('AXIOGEN_history', JSON.stringify(state.history.slice(0, 20)));
                }
            }
        }

        setTimeout(() => addCopyButtons(targetDiv), 100);

        if (wrapper && rawContent.length > 5 && !wrapper.querySelector('.message-actions')) {
            addActionBarToWrapper(wrapper, 'ai', rawContent, targetDiv);
        }
    } catch (e) {
        console.error('Explanation failed:', e);
        targetDiv.innerHTML = '<div style="color: #ff4444; padding: 1rem; background: rgba(255,68,68,0.1); border-radius: 8px;">Failed to generate expert explanation. Check your API key or model settings.</div>';
        if (wrapper && rawContent.length > 5 && !wrapper.querySelector('.message-actions')) {
            addActionBarToWrapper(wrapper, 'ai', rawContent, targetDiv);
        }
    }
}

function saveHistory() {
    if (state.currentMessages.length >= 2) {
        let existingChat = null;
        if (state.currentChatId) {
            existingChat = state.history.find(c => c.id === state.currentChatId);
        }

        if (existingChat) {
            existingChat.messages = [...state.currentMessages];
            if (state.tutorActivated) existingChat.tutorMode = true;
        } else {
            const newId = Date.now().toString();
            const firstUserMsg = state.currentMessages.find(m => m.role === 'user');
            let titleContent = firstUserMsg ? firstUserMsg.content : state.currentMessages[0].content;

            titleContent = titleContent.replace(/\[FILE:.*?\]/g, '').replace(/```[\s\S]*?```/g, '').trim();

            const newChat = {
                id: newId,
                title: (titleContent.substring(0, 30) || "Document Analysis").trim(),
                messages: [...state.currentMessages],
                workspace: state.currentWorkspace,
                tutorMode: state.tutorActivated || false
            };
            state.history.unshift(newChat);
            state.currentChatId = newId;
            localStorage.setItem('AXIOGEN_current_chat_id', newId);
        }
        localStorage.setItem('AXIOGEN_history', JSON.stringify(state.history.slice(0, 20)));
        renderHistory();
    }
}

function clearChatDisplay() {
    Array.from(chatDisplay.children).forEach(child => {
        if (child.id !== 'welcome-screen') {
            child.remove();
        }
    });
}

const contextMenu = document.getElementById('chat-context-menu');
let activeChatIndex = null;
let activeChatFilter = '';
let triggerEditMode = null;

document.getElementById('menu-rename')?.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu?.classList.remove('active');
    if (triggerEditMode) triggerEditMode();
});

document.getElementById('menu-pin')?.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu?.classList.remove('active');
    if (activeChatIndex !== null) {
        const chat = state.history[activeChatIndex];
        chat.pinned = !chat.pinned;
        localStorage.setItem('AXIOGEN_history', JSON.stringify(state.history.slice(0, 20)));
        renderHistory(activeChatFilter);
        activeChatIndex = null;
    }
});

document.getElementById('menu-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu?.classList.remove('active');
    if (activeChatIndex !== null) {
        if (confirm('Delete this chat?')) {
            state.history.splice(activeChatIndex, 1);
            localStorage.setItem('AXIOGEN_history', JSON.stringify(state.history.slice(0, 20)));
            renderHistory(activeChatFilter);
            startNewChat();
            activeChatIndex = null;
        }
    }
});

document.addEventListener('click', () => {
    contextMenu?.classList.remove('active');
});

function loadChatSessionById(chatId) {
    const chat = state.history.find(c => c.id === chatId);
    if (!chat) return;

    state.currentMessages = [...chat.messages];
    state.currentChatId = chat.id || null;
    localStorage.setItem('AXIOGEN_current_session', JSON.stringify(state.currentMessages));
    localStorage.setItem('AXIOGEN_current_chat_id', state.currentChatId || '');

    sidebar?.classList.remove('hover-expanded');
    if (window.innerWidth <= 1024 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }
    }

    if (chat.workspace) {
        if (chat.workspace === 'nsfw') {
            const user = window.AXIOGEN_USER;
            const nsfwAuthorizedEmails = ['aditaypatil07@gmail.com', 'axiogen01@gmail.com'];
            if (!user || !nsfwAuthorizedEmails.includes(user.email)) {
                console.warn('Unauthorized attempt to load NSFW workspace chat history.');
                return;
            }
        }
        if (state.currentWorkspace !== chat.workspace) {
            const btn = document.querySelector(`.workspace-btn[data-workspace="${chat.workspace}"]`);
            if (btn) {
                if (['sheets', 'docs'].includes(chat.workspace)) {
                    toggleProgressWorkspace(chat.workspace, btn);
                } else if (chat.workspace === 'axiogencode') {
                    toggleAxiogenCodeWorkspace(btn);
                } else if (chat.workspace === 'trading') {
                    toggleTradingWorkspace(btn);
                } else if (chat.workspace === 'testing') {
                    toggleTestingWorkspace(btn);
                }
            }
        }
    } else {
        if (state.currentWorkspace === 'neura') {
            resetNeura();
            switchToWorkspace(null);
        } else if (state.currentWorkspace === 'nsfw') {
            resetNsfw();
            switchToWorkspace(null);
        } else if (state.currentWorkspace) {
            switchToWorkspace(null);
        }
    }

    const ws = document.getElementById('welcome-screen');
    if (ws) ws.style.display = 'none';
    clearChatDisplay();

    const wasTutorMode = chat.tutorMode === true;
    if (wasTutorMode) {
        state.tutorActivated = true;
        localStorage.setItem('AXIOGEN_tutor_active', 'true');
        const tutorToggle = document.getElementById('tutor-toggle');
        if (tutorToggle) {
            tutorToggle.textContent = 'Expert Tutor: On';
            tutorToggle.classList.add('active');
        }
    } else {
        if (!state.tutorActivated) {
            state.tutorActivated = false;
        }
    }

    state._loadingHistory = true;
    state.currentMessages.forEach(msg => {
        if (msg.role !== 'system') {
            const role = msg.role === 'assistant' ? 'ai' : 'user';
            const contentDiv = addMessageToUI(role, msg.content);

            if (role === 'ai' && msg.expertHtml && contentDiv) {
                contentDiv.innerHTML = msg.expertHtml;
                addCopyButtons(contentDiv);
            }
        }
    });
    state._loadingHistory = false;
    syncTutorHeaderVisibility();
}

function openSearchModal() {
    const modal = document.getElementById('search-modal');
    const input = document.getElementById('search-chats-input');
    if (modal) {
        modal.classList.add('active');
        if (input) {
            input.value = '';
            input.focus();
        }
        renderSearchHistory('');
    }
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function renderSearchHistory(query = '') {
    const listContainer = document.getElementById('search-results-list');
    if (!listContainer) return;

    const newChatOption = document.getElementById('search-new-chat-option');
    listContainer.innerHTML = '';
    if (newChatOption) {
        listContainer.appendChild(newChatOption);
    } else {
        const opt = document.createElement('div');
        opt.className = 'search-result-item new-chat-option';
        opt.id = 'search-new-chat-option';
        opt.innerHTML = `
            <i class="far fa-edit"></i>
            <span class="result-title">New chat</span>
        `;
        listContainer.appendChild(opt);
    }

    document.getElementById('search-new-chat-option').onclick = () => {
        startNewChat();
        closeSearchModal();
    };

    const cleanQuery = query.trim().toLowerCase();
    const filteredHistory = state.history.filter(chat =>
        !cleanQuery || chat.title.toLowerCase().includes(cleanQuery)
    );

    if (filteredHistory.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'search-no-results';
        noResults.textContent = 'No matching chats found';
        listContainer.appendChild(noResults);
        return;
    }

    const groups = {
        "Today": [],
        "Yesterday": [],
        "Previous 7 Days": [],
        "Previous 30 Days": [],
        "Older": []
    };

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const sevenDaysAgoStart = new Date(todayStart);
    sevenDaysAgoStart.setDate(sevenDaysAgoStart.getDate() - 7);
    const thirtyDaysAgoStart = new Date(todayStart);
    thirtyDaysAgoStart.setDate(thirtyDaysAgoStart.getDate() - 30);

    filteredHistory.forEach(chat => {
        const chatTime = parseInt(chat.id);
        if (isNaN(chatTime)) {
            groups["Older"].push(chat);
            return;
        }

        const chatDate = new Date(chatTime);
        if (chatDate >= todayStart) {
            groups["Today"].push(chat);
        } else if (chatDate >= yesterdayStart) {
            groups["Yesterday"].push(chat);
        } else if (chatDate >= sevenDaysAgoStart) {
            groups["Previous 7 Days"].push(chat);
        } else if (chatDate >= thirtyDaysAgoStart) {
            groups["Previous 30 Days"].push(chat);
        } else {
            groups["Older"].push(chat);
        }
    });

    Object.keys(groups).forEach(category => {
        const items = groups[category];
        if (items.length === 0) return;

        const header = document.createElement('div');
        header.className = 'search-category-header';
        header.textContent = category;
        listContainer.appendChild(header);

        items.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `
                <i class="far fa-comment"></i>
                <span class="result-title">${chat.title}</span>
            `;
            item.onclick = () => {
                loadChatSessionById(chat.id);
                closeSearchModal();
            };
            listContainer.appendChild(item);
        });
    });
}

function renderHistory(filter = '') {
    activeChatFilter = filter;
    historyList.innerHTML = '';

    const displayHistory = state.history
        .map((chat, originalIndex) => ({ ...chat, originalIndex }))
        .filter(chat => !filter || chat.title.toLowerCase().includes(filter))
        .sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return 0;
        });

    displayHistory.forEach((chat) => {
        const i = chat.originalIndex;
        const item = document.createElement('div');
        item.className = `history-item ${chat.pinned ? 'pinned' : ''}`;

        const renderDefaultContent = () => {
            item.innerHTML = `
                <i class="far fa-comment"></i>
                <span class="history-item-title">${chat.title}</span>
                ${chat.pinned ? '<i class="fas fa-thumbtack pinned-icon"></i>' : ''}
                <div class="history-item-actions">
                    <button class="history-action-btn menu-trigger" title="More Options"><i class="fas fa-ellipsis-h"></i></button>
                </div>
            `;

            const trigger = item.querySelector('.menu-trigger');
            trigger.onclick = (e) => {
                e.stopPropagation();
                activeChatIndex = i;
                triggerEditMode = renderEditMode;

                const pinText = document.getElementById('pin-text');
                if (pinText) pinText.textContent = chat.pinned ? 'Unpin chat' : 'Pin chat';

                const rect = trigger.getBoundingClientRect();
                contextMenu.style.top = `${rect.bottom + 10}px`;
                contextMenu.style.left = `${rect.right - 160}px`;
                contextMenu.classList.add('active');
            };

            item.onclick = () => {
                loadChatSessionById(chat.id);
            };
        };

        const renderEditMode = () => {
            item.innerHTML = `
                <i class="far fa-comment"></i>
                <input type="text" class="history-item-rename-input" value="${chat.title}">
            `;
            const input = item.querySelector('input');
            input.focus();
            input.select();

            const save = () => {
                const newTitle = input.value.trim();
                if (newTitle && newTitle !== chat.title) {
                    chat.title = newTitle;
                    localStorage.setItem('AXIOGEN_history', JSON.stringify(state.history.slice(0, 20)));
                }
                renderDefaultContent();
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') renderDefaultContent();
            };

            input.onblur = save;
            input.onclick = (e) => e.stopPropagation();
        };

        renderDefaultContent();
        historyList.appendChild(item);
    });
}

function startNewChat(resetWorkspace = true) {
    if (state.currentWorkspace === 'nsfw') {
        const user = window.AXIOGEN_USER;
        const nsfwAuthorizedEmails = ['aditaypatil07@gmail.com', 'axiogen01@gmail.com'];
        if (!user || !nsfwAuthorizedEmails.includes(user.email)) {
            state.currentWorkspace = null;
        }
    }

    if (window.clearDocsAgentSelection) window.clearDocsAgentSelection();
    if (window.clearSheetsAgentSelection) window.clearSheetsAgentSelection();
    sidebar?.classList.remove('hover-expanded');
    if (window.innerWidth <= 1024 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
        if (window.innerWidth <= 767 || (screen.width < 1024 && navigator.maxTouchPoints > 0)) {
            sidebar?.classList.add('collapsed');
        }
    }

    state.currentMessages = [];
    state.currentChatId = null;
    localStorage.removeItem('AXIOGEN_current_chat_id');
    if (resetWorkspace) {
        state.tutorActivated = false;
        state.currentWorkspace = null;
        localStorage.removeItem('AXIOGEN_tutor_active');
        localStorage.removeItem('AXIOGEN_active_workspace');
    }
    localStorage.removeItem('AXIOGEN_current_session');

    if (resetWorkspace) {
        document.querySelectorAll('.workspace-btn').forEach(b => b.classList.remove('workspace-active'));
    }

    hideAllWorkspaces();

    if (state.currentWorkspace === 'neura') {
        chatDisplay.style.display = 'none';
        const inputArea = document.querySelector('.chat-input-area');
        if (inputArea) inputArea.style.display = 'none';
        const neuraContainer = document.getElementById('neura-container');
        if (neuraContainer) neuraContainer.style.display = 'block';
        resetNeura();
    } else if (state.currentWorkspace === 'nsfw') {
        chatDisplay.style.display = 'none';
        const inputArea = document.querySelector('.chat-input-area');
        if (inputArea) inputArea.style.display = 'none';
        const nsfwContainer = document.getElementById('nsfw-container');
        if (nsfwContainer) nsfwContainer.style.display = 'block';
        resetNsfw();
    } else {
        chatDisplay.style.display = 'flex';
        const inputArea = document.querySelector('.chat-input-area');
        if (inputArea) {
            inputArea.style.display = 'block';
            const micBtn = document.getElementById('voice-input-btn');
            const uploadBtn = document.getElementById('upload-btn');
            if (micBtn) micBtn.style.display = 'flex';
            if (uploadBtn) uploadBtn.style.display = 'flex';
        }
    }

    if (resetWorkspace) {
        const tutorHeaderControls = document.getElementById('tutor-header-controls');
        if (tutorHeaderControls) tutorHeaderControls.style.display = 'none';
    }
    chatDisplay.innerHTML = `
        <div class="welcome-screen" id="welcome-screen">
            <div class="welcome-logo-wrap">
                <svg id="atom" width="300" height="300" viewBox="0 0 300 300">
                    <defs>
                        <linearGradient id="silverStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#E6ECF2" />
                            <stop offset="40%" stop-color="#8a96a3" />
                            <stop offset="100%" stop-color="#E6ECF2" />
                        </linearGradient>
                    </defs>
                    <ellipse cx="150" cy="150" rx="110" ry="42" fill="none" stroke="url(#silverStroke)"
                        stroke-width="2.2" transform="rotate(0,150,150)" />
                    <ellipse cx="150" cy="150" rx="110" ry="42" fill="none" stroke="url(#silverStroke)"
                        stroke-width="2.2" transform="rotate(60,150,150)" />
                    <ellipse cx="150" cy="150" rx="110" ry="42" fill="none" stroke="url(#silverStroke)"
                        stroke-width="2.2" transform="rotate(120,150,150)" />
                    <circle cx="150" cy="150" r="7" fill="#8a96a3" />
                    <circle cx="150" cy="150" r="4" fill="#E6ECF2" />
                    <circle id="e1" r="5.5" fill="#E6ECF2" />
                    <circle id="e2" r="5.5" fill="#E6ECF2" />
                    <circle id="e3" r="5.5" fill="#E6ECF2" />
                    <circle id="h1" r="9" fill="#E6ECF2" opacity="0.25" />
                    <circle id="h2" r="9" fill="#E6ECF2" opacity="0.25" />
                    <circle id="h3" r="9" fill="#E6ECF2" opacity="0.25" />
                </svg>
                <div class="name">AXIOGEN</div>
                <div class="rule"></div>
                <div class="sub">INTELLIGENT PLATFORM</div>
            </div>
        </div>
    `;

    const newWelcome = document.getElementById('welcome-screen');
    if (newWelcome) newWelcome.style.display = 'flex';

    syncTutorHeaderVisibility();
}

function saveSettings() {
    state.apiKey = apiKeyInput.value.trim();
    state.expertModel = expertModelInput.value.trim() || 'google/gemini-2.0-flash-001';

    localStorage.setItem('AXIOGEN_api_key', state.apiKey);
    localStorage.setItem('AXIOGEN_expert_model', state.expertModel);

    // Reset key index so manually entered key starts fresh at index 0
    currentKeyIndex = 0;
    updateApiKeyPool();

    settingsModal.classList.remove('active');
    console.log('Settings saved. API Key active.');
}

function populateVoiceList() {
    const voiceSelect = document.getElementById('neura-voice-select');
    if (!voiceSelect) return;

    const voices = getAvailableVoices();
    const activeVoice = getSelectedVoice();
    const currentVoiceName = localStorage.getItem('AXIOGEN_user_voice') || (activeVoice ? activeVoice.name : '');

    voiceSelect.innerHTML = '';

    const premiumGroup = document.createElement('optgroup');
    premiumGroup.label = "Premium AI Simulated Voices";

    const lavenderOption = document.createElement('option');
    lavenderOption.value = "LavenderLessons (Simulated)";
    lavenderOption.textContent = "LavenderLessons (ElevenLabs - Calm & Serene)";
    if (currentVoiceName === "LavenderLessons (Simulated)") {
        lavenderOption.selected = true;
    }
    premiumGroup.appendChild(lavenderOption);
    voiceSelect.appendChild(premiumGroup);

    const neuralVoices = [];
    const standardVoices = [];

    voices.forEach(voice => {
        if (voice.lang.startsWith('en')) {
            const nameLower = voice.name.toLowerCase();
            const isNeural = nameLower.includes('natural') ||
                nameLower.includes('online') ||
                nameLower.includes('premium') ||
                nameLower.includes('neural') ||
                nameLower.includes('siri') ||
                nameLower.includes('google');

            if (isNeural) {
                neuralVoices.push(voice);
            } else {
                standardVoices.push(voice);
            }
        }
    });

    if (neuralVoices.length > 0) {
        const neuralGroup = document.createElement('optgroup');
        neuralGroup.label = "Premium Neural Voices";
        neuralVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = voice.name.replace('Microsoft ', '').replace('Google ', '');
            if (currentVoiceName === voice.name) option.selected = true;
            neuralGroup.appendChild(option);
        });
        voiceSelect.appendChild(neuralGroup);
    }

    if (standardVoices.length > 0) {
        const standardGroup = document.createElement('optgroup');
        standardGroup.label = "Standard Synthetic Voices";
        standardVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = voice.name;
            if (currentVoiceName === voice.name) option.selected = true;
            standardGroup.appendChild(option);
        });
        voiceSelect.appendChild(standardGroup);
    }

    if (voiceSelect.children.length === 0 && voices.length > 0) {
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (currentVoiceName === voice.name) option.selected = true;
            voiceSelect.appendChild(option);
        });
    }
}

init();
