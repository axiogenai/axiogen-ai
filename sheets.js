// sheets.js
document.addEventListener('DOMContentLoaded', () => {
    // ========== AGENT DATA ==========
    const sheetsAgents = [
        {
            id: 'analyze',
            name: 'Analyze Data',
            shortName: 'Analyze',
            icon: 'query_stats',
            color: '#10b981', // Emerald
            desc: 'Statistical insights & trends',
            longDesc: 'Upload your spreadsheets, Excel, or CSV files, and this agent will deeply analyze the dataset to extract key statistical insights, trends, correlations, outliers, and visual patterns.',
            systemPrompt: 'You are a data analysis specialist. Analyze spreadsheets to find statistical insights, trends, outliers, correlations, and patterns. Provide clear summaries with actionable recommendations.'
        },
        {
            id: 'formula',
            name: 'Build Formulas',
            shortName: 'Formula',
            icon: 'functions',
            color: '#8b5cf6', // Violet
            desc: 'Complex calculations & logic',
            longDesc: 'Build high-performance, complex spreadsheet formulas, nested functions, array formulas, or custom logical operations with clear explanations of how each calculation runs.',
            systemPrompt: 'You are an Excel/Sheets formula expert. Build complex formulas, nested functions, array formulas, and custom calculations. Explain how each formula works step by step.'
        },
        {
            id: 'chart',
            name: 'Create Charts',
            shortName: 'Chart',
            icon: 'show_chart',
            color: '#06b6d4', // Cyan
            desc: 'Visualize your data',
            longDesc: 'Transform boring spreadsheet columns into dynamic visual charts. Recommend target visualization layouts and explain trends and patterns represented by the generated visual blocks.',
            systemPrompt: 'You are a data visualization expert. Recommend the best chart types for given datasets, create visualizations, and explain insights drawn from charts. Support bar, line, pie, scatter, heatmap, and custom charts.'
        },
        {
            id: 'clean',
            name: 'Clean Data',
            shortName: 'Clean',
            icon: 'mop',
            color: '#f59e0b', // Amber
            desc: 'Remove duplicates & fix errors',
            longDesc: 'Purge duplicate data points, correct layout format bugs, standardize variable categories, handle null/missing data values, and build clean, validated, standardized datasets.',
            systemPrompt: 'You are a data cleaning specialist. Remove duplicates, fix formatting errors, standardize data types, handle missing values, and validate datasets. Provide a detailed report of all changes made.'
        },
        {
            id: 'pivot',
            name: 'Pivot Tables',
            shortName: 'Pivot',
            icon: 'pivot_table_chart',
            color: '#ef4444', // Crimson
            desc: 'Summarize & group data',
            longDesc: 'Synthesize data through highly configurable pivot tables. Learn how to configure aggregate filters, pivot dimensions, or summarize multidimensional matrices dynamically.',
            systemPrompt: 'You are a pivot table expert. Create pivot table configurations, suggest groupings and aggregations, and explain how to set up complex summaries in Excel/Google Sheets.'
        },
        {
            id: 'export',
            name: 'Export & Report',
            shortName: 'Export',
            icon: 'upload_file',
            color: '#10b981', // Emerald green
            desc: 'Generate formatted outputs',
            longDesc: 'Construct high-quality reports, executive summaries, and organized formatting. Export spreadsheet outputs into beautifully styled and clean PDF, HTML, or Markdown report layouts.',
            systemPrompt: 'You are a reporting specialist. Generate formatted reports from spreadsheet data, create executive summaries, and suggest the best export formats (PDF, HTML, Markdown) for different audiences.'
        }
    ];

    // ========== DOM ELEMENTS ==========
    const cardsContainer = document.getElementById('sheetsCardsContainer');
    const agentGrid = document.getElementById('sheetsAgentGrid');
    
    // Global Prompt Box integrations
    const activeAgentBar = document.getElementById('sheetsActiveAgentBar');
    const agentBadge = document.getElementById('sheetsAgentBadge');
    const badgeIcon = document.getElementById('sheetsBadgeIcon');
    const badgeName = document.getElementById('sheetsBadgeName');
    const badgeRemove = document.getElementById('sheetsBadgeRemove');
    
    const globalChatInput = document.getElementById('chat-input');
    const globalSendBtn = document.getElementById('send-btn');

    // Agent Detail View
    const sheetsAgentDetail = document.getElementById('sheetsAgentDetail');
    const sheetsDetailIcon = document.getElementById('sheetsDetailIcon');
    const sheetsDetailTitle = document.getElementById('sheetsDetailTitle');
    const sheetsDetailDesc = document.getElementById('sheetsDetailDesc');

    let selectedAgent = null;

    // ========== INIT CARDS ==========
    function initCards() {
        if(!agentGrid) return;
        agentGrid.innerHTML = '';
        sheetsAgents.forEach(agent => {
            const card = document.createElement('div');
            card.className = 'sheets-agent-card';
            card.dataset.agentId = agent.id;
            card.innerHTML = `
                <div class="sheets-card-icon" style="background: ${agent.color}20; color: ${agent.color}"><span class="material-symbols-outlined">${agent.icon}</span></div>
                <div class="sheets-card-title">${agent.name}</div>
                <div class="sheets-card-desc">${agent.desc}</div>
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
        if (sheetsAgentDetail) sheetsAgentDetail.style.display = 'flex';

        // Populate detail view
        if (sheetsDetailIcon) {
            sheetsDetailIcon.innerHTML = `<span class="material-symbols-outlined" style="font-size: 36px;">${agent.icon}</span>`;
            sheetsDetailIcon.style.background = `${agent.color}15`;
            sheetsDetailIcon.style.color = agent.color;
        }
        if (sheetsDetailTitle) sheetsDetailTitle.textContent = agent.name;
        if (sheetsDetailDesc) sheetsDetailDesc.textContent = agent.longDesc;

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
            globalChatInput.placeholder = `${agent.name}: Ask about your spreadsheets...`;
            globalChatInput.focus();
        }
    }

    // ========== REMOVE AGENT (X button clicked) ==========
    function removeAgent(keepChat = false) {
        selectedAgent = null;

        // Show cards and hide detail view
        if (cardsContainer) cardsContainer.classList.remove('hidden');
        if (sheetsAgentDetail) sheetsAgentDetail.style.display = 'none';

        // Hide active bar
        if (activeAgentBar) {
            activeAgentBar.style.display = 'none';
        }

        // Reset global input
        if (globalChatInput) {
            globalChatInput.placeholder = 'Message AXIOGEN...';
        }
        
        if (keepChat === true) return;

        // Full reset of sheets session
        if (window.state && window.state.currentWorkspace === 'sheets') {
            window.state.currentMessages = [];
            window.state.currentChatId = null;
            
            const chatDisplay = document.getElementById('chat-display');
            if (chatDisplay) {
                Array.from(chatDisplay.children).forEach(child => {
                    if (child.id !== 'welcome-screen') child.remove();
                });
                chatDisplay.style.display = 'none';
            }
            
            const sheetsContainer = document.getElementById('sheets-container');
            if (sheetsContainer) sheetsContainer.style.display = 'flex';
            
            const sheetsMain = document.querySelector('.sheets-main-container');
            if (sheetsMain) sheetsMain.style.display = 'flex';
        }
    }

    // ========== HOOK INTO GLOBAL SEND ==========
    // We override the global send behavior gently if a sheets agent is active
    if (globalSendBtn) {
        globalSendBtn.addEventListener('click', (e) => {
            if (window.state && window.state.currentWorkspace === 'sheets' && selectedAgent) {
                // Initialize session context with agent system prompt BEFORE global send picks it up
                if (!window.state.currentMessages) window.state.currentMessages = [];
                if (window.state.currentMessages.length > 0 && window.state.currentMessages[0].role === 'system') {
                    window.state.currentMessages[0].content = selectedAgent.systemPrompt;
                } else {
                    window.state.currentMessages.unshift({ role: 'system', content: selectedAgent.systemPrompt });
                }
                
                // Hide sheets selection UI and show chat display inline
                const sheetsMain = document.querySelector('.sheets-main-container');
                if (sheetsMain) sheetsMain.style.display = 'none';
                
                const sheetsContainer = document.getElementById('sheets-container');
                if (sheetsContainer) sheetsContainer.style.display = 'none';
                
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
                if (window.state && window.state.currentWorkspace === 'sheets' && selectedAgent) {
                    if (!window.state.currentMessages) window.state.currentMessages = [];
                    if (window.state.currentMessages.length > 0 && window.state.currentMessages[0].role === 'system') {
                        window.state.currentMessages[0].content = selectedAgent.systemPrompt;
                    } else {
                        window.state.currentMessages.unshift({ role: 'system', content: selectedAgent.systemPrompt });
                    }
                    const sheetsMain = document.querySelector('.sheets-main-container');
                    if (sheetsMain) sheetsMain.style.display = 'none';
                    
                    const sheetsContainer = document.getElementById('sheets-container');
                    if (sheetsContainer) sheetsContainer.style.display = 'none';
                    
                    const chatDisplay = document.getElementById('chat-display');
                    if (chatDisplay) chatDisplay.style.display = 'flex';
                }
            }
        }, { capture: true });
    }

    // ========== EVENT LISTENERS ==========
    if (badgeRemove) badgeRemove.addEventListener('click', removeAgent);

    // If workspace changes AWAY from sheets, ensure we reset the badge if they didn't send
    window.clearSheetsAgentSelection = removeAgent;
    window.isSheetsAgentSelected = () => selectedAgent !== null;

    // ========== INIT ==========
    initCards();
});
