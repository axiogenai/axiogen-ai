// docs.js
document.addEventListener('DOMContentLoaded', () => {
    // ========== AGENT DATA ==========
    const docsAgents = [
        {
            id: 'summarize',
            name: 'Summarize Document',
            shortName: 'Summarize',
            icon: 'summarize',
            color: '#6366f1',
            desc: 'Get key insights from long docs',
            longDesc: 'Upload your lengthy PDFs, reports, or articles, and this agent will instantly extract the core insights, key takeaways, and main points, giving you a comprehensive summary in seconds.',
            systemPrompt: 'You are a document summarization specialist. Extract key insights, main points, and actionable takeaways from documents. Provide concise summaries while preserving important details.'
        },
        {
            id: 'compare',
            name: 'Compare Documents',
            shortName: 'Compare',
            icon: 'compare',
            color: '#8b5cf6',
            desc: 'Find differences between versions',
            longDesc: 'Upload multiple versions of a document, and this agent will meticulously highlight the differences, additions, and modifications so you never miss a change.',
            systemPrompt: 'You are a document comparison expert. Identify differences, similarities, and changes between document versions. Highlight additions, deletions, and modifications with clear annotations.'
        },
        {
            id: 'translate',
            name: 'Translate & Export',
            shortName: 'Translate',
            icon: 'translate',
            color: '#06b6d4',
            desc: 'Bilingual document output',
            longDesc: 'A professional-grade bilingual assistant that accurately translates your documents while perfectly preserving the original formatting, tone, and context.',
            systemPrompt: 'You are a professional translator. Translate documents accurately while preserving formatting, tone, and context. Support multiple languages and provide bilingual output when requested.'
        },
        {
            id: 'report',
            name: 'Generate Report',
            shortName: 'Report',
            icon: 'auto_awesome',
            color: '#f59e0b',
            desc: 'Create docs from data',
            longDesc: 'Transform your raw data, scattered notes, or brief outlines into a highly professional, beautifully structured executive report ready for presentation.',
            systemPrompt: 'You are a report generation specialist. Transform raw data, notes, or outlines into professional, well-structured documents. Create executive summaries, detailed reports, and formatted outputs.'
        },
        {
            id: 'review',
            name: 'Review & Edit',
            shortName: 'Review',
            icon: 'rate_review',
            color: '#ef4444',
            desc: 'Inline comments & fixes',
            longDesc: 'Your personal proofreader and editor. It deeply analyzes your document for grammatical perfection, clarity, and style, offering inline suggestions to polish your writing.',
            systemPrompt: 'You are an editor and proofreader. Review documents for grammar, clarity, style, and accuracy. Provide inline suggestions, corrections, and improvement recommendations.'
        },
        {
            id: 'visualize',
            name: 'Visualize Data',
            shortName: 'Visualize',
            icon: 'insert_chart',
            color: '#10b981',
            desc: 'Charts from spreadsheets',
            longDesc: 'Turn boring spreadsheets into actionable insights. This agent analyzes your data and suggests the most effective charts, graphs, and visual representations for your numbers.',
            systemPrompt: 'You are a data visualization expert. Analyze spreadsheet data and suggest appropriate charts, graphs, and visual representations. Describe visualizations clearly for implementation.'
        }
    ];

    // ========== DOM ELEMENTS ==========
    const cardsContainer = document.getElementById('docsCardsContainer');
    const agentGrid = document.getElementById('docsAgentGrid');
    
    // Global Prompt Box integrations
    const activeAgentBar = document.getElementById('docsActiveAgentBar');
    const agentBadge = document.getElementById('docsAgentBadge');
    const badgeIcon = document.getElementById('docsBadgeIcon');
    const badgeName = document.getElementById('docsBadgeName');
    const badgeRemove = document.getElementById('docsBadgeRemove');
    
    const globalChatInput = document.getElementById('chat-input');
    const globalSendBtn = document.getElementById('send-btn');

    // Agent Detail View
    const docsAgentDetail = document.getElementById('docsAgentDetail');
    const docsDetailIcon = document.getElementById('docsDetailIcon');
    const docsDetailTitle = document.getElementById('docsDetailTitle');
    const docsDetailDesc = document.getElementById('docsDetailDesc');

    let selectedAgent = null;

    // ========== INIT CARDS ==========
    function initCards() {
        if(!agentGrid) return;
        agentGrid.innerHTML = '';
        docsAgents.forEach(agent => {
            const card = document.createElement('div');
            card.className = 'docs-agent-card';
            card.dataset.agentId = agent.id;
            card.innerHTML = `
                <div class="docs-card-icon" style="background: ${agent.color}20; color: ${agent.color}"><span class="material-symbols-outlined">${agent.icon}</span></div>
                <div class="docs-card-title">${agent.name}</div>
                <div class="docs-card-desc">${agent.desc}</div>
            `;
            card.addEventListener('click', () => selectAgent(agent));
            agentGrid.appendChild(card);
        });
    }

    // ========== SELECT AGENT ==========
    function selectAgent(agent) {
        selectedAgent = agent;

        // Hide cards and show detail view
        if (cardsContainer) cardsContainer.classList.add('hidden');
        if (docsAgentDetail) docsAgentDetail.style.display = 'flex';

        // Populate detail view
        if (docsDetailIcon) {
            docsDetailIcon.innerHTML = `<span class="material-symbols-outlined" style="font-size: 36px;">${agent.icon}</span>`;
            docsDetailIcon.style.background = `${agent.color}15`;
            docsDetailIcon.style.color = agent.color;
        }
        if (docsDetailTitle) docsDetailTitle.textContent = agent.name;
        if (docsDetailDesc) docsDetailDesc.textContent = agent.longDesc;

        // Setup badge in global input
        if (badgeIcon) badgeIcon.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">${agent.icon}</span>`;
        if (badgeName) badgeName.textContent = agent.shortName;
        if (agentBadge) agentBadge.style.background = agent.color;

        // Show active bar above global input
        if (activeAgentBar) {
            activeAgentBar.style.display = 'flex';
        }

        // Update placeholder of global input
        if (globalChatInput) {
            globalChatInput.placeholder = `${agent.name}: Ask about your documents...`;
            globalChatInput.focus();
        }
    }

    // ========== REMOVE AGENT (X button clicked) ==========
    function removeAgent(keepChat = false) {
        selectedAgent = null;

        // Show cards and hide detail view
        if (cardsContainer) cardsContainer.classList.remove('hidden');
        if (docsAgentDetail) docsAgentDetail.style.display = 'none';

        // Hide active bar
        if (activeAgentBar) {
            activeAgentBar.style.display = 'none';
        }

        // Reset global input
        if (globalChatInput) {
            globalChatInput.placeholder = 'Message AXIOGEN...';
        }
        
        if (keepChat === true) return;

        // Full reset of docs session
        if (window.state && window.state.currentWorkspace === 'docs') {
            window.state.currentMessages = [];
            window.state.currentChatId = null;
            
            const chatDisplay = document.getElementById('chat-display');
            if (chatDisplay) {
                Array.from(chatDisplay.children).forEach(child => {
                    if (child.id !== 'welcome-screen') child.remove();
                });
                chatDisplay.style.display = 'none';
            }
            
            const docsContainer = document.getElementById('docs-container');
            if (docsContainer) docsContainer.style.display = 'flex';
            
            const docsMain = document.querySelector('.docs-main-container');
            if (docsMain) docsMain.style.display = 'flex';
        }
    }

    // ========== HOOK INTO GLOBAL SEND ==========
    // We override the global send behavior gently if a docs agent is active
    if (globalSendBtn) {
        const originalClick = globalSendBtn.onclick;
        globalSendBtn.addEventListener('click', (e) => {
            if (window.state && window.state.currentWorkspace === 'docs' && selectedAgent) {
                // Initialize session context with agent system prompt BEFORE global send picks it up
                // (Global send relies on state.currentMessages)
                if (!window.state.currentMessages) window.state.currentMessages = [];
                if (window.state.currentMessages.length > 0 && window.state.currentMessages[0].role === 'system') {
                    window.state.currentMessages[0].content = selectedAgent.systemPrompt;
                } else {
                    window.state.currentMessages.unshift({ role: 'system', content: selectedAgent.systemPrompt });
                }
                
                // Hide docs selection UI and show chat display inline
                const docsMain = document.querySelector('.docs-main-container');
                if (docsMain) docsMain.style.display = 'none';
                
                const docsContainer = document.getElementById('docs-container');
                if (docsContainer) docsContainer.style.display = 'none';
                
                const chatDisplay = document.getElementById('chat-display');
                if (chatDisplay) chatDisplay.style.display = 'flex';
                
                // Do NOT call removeAgent() or switch workspace.
                // We let main.js handle the actual sending in the current workspace.
            }
        }, { capture: true }); // Use capture so we set state before main.js processes it
    }
    
    // Also hook into Enter key
    if (globalChatInput) {
        globalChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (window.state && window.state.currentWorkspace === 'docs' && selectedAgent) {
                    if (!window.state.currentMessages) window.state.currentMessages = [];
                    if (window.state.currentMessages.length > 0 && window.state.currentMessages[0].role === 'system') {
                        window.state.currentMessages[0].content = selectedAgent.systemPrompt;
                    } else {
                        window.state.currentMessages.unshift({ role: 'system', content: selectedAgent.systemPrompt });
                    }
                    const docsMain = document.querySelector('.docs-main-container');
                    if (docsMain) docsMain.style.display = 'none';
                    
                    const docsContainer = document.getElementById('docs-container');
                    if (docsContainer) docsContainer.style.display = 'none';
                    
                    const chatDisplay = document.getElementById('chat-display');
                    if (chatDisplay) chatDisplay.style.display = 'flex';
                    
                    // We let main.js handle the actual sending and UI updates
                    // Do NOT call removeAgent() or switch workspace.
                }
            }
        }, { capture: true });
    }

    // ========== EVENT LISTENERS ==========
    if (badgeRemove) badgeRemove.addEventListener('click', removeAgent);

    // If workspace changes AWAY from docs, ensure we reset the badge if they didn't send
    // (main.js handles workspace switching, we can poll or rely on them explicitly clicking)
    window.clearDocsAgentSelection = removeAgent;
    window.isDocsAgentSelected = () => selectedAgent !== null;

    // ========== INIT ==========
    initCards();
});
