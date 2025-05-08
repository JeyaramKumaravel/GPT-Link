document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
        window.location.href = '/login.html';
        return;
    }

    // Load and apply user preferences
    loadUserPreferences();

    // Add authentication header to all fetch requests
    const originalFetch = window.fetch;
    window.fetch = function() {
        let [resource, config] = arguments;
        if (config === undefined) {
            config = {};
        }
        if (config.headers === undefined) {
            config.headers = {};
        }
        config.headers['Authorization'] = `Bearer ${authToken}`;

        return originalFetch(resource, config)
            .then(response => {
                if (response.status === 401 || response.status === 403) {
                    // Token is invalid or expired
                    localStorage.removeItem('authToken');
                    window.location.href = '/login.html';
                    throw new Error('Authentication required');
                }
                return response;
            });
    };

    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const chatList = document.getElementById('chatList');
    const newChatBtn = document.getElementById('newChatBtn');
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    let currentConversationId = null;

    let ws = null;
    let wsReconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 3000;

    // Initialize WebSocket connection
    function initializeWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            wsReconnectAttempts = 0;
            
            // Subscribe to current conversation if exists
            if (currentConversationId) {
                ws.send(JSON.stringify({
                    type: 'subscribe',
                    conversationId: currentConversationId
                }));
            }
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                wsReconnectAttempts++;
                setTimeout(initializeWebSocket, RECONNECT_DELAY);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    // Handle incoming WebSocket messages
    function handleWebSocketMessage(data) {
        switch (data.type) {
            case 'new_message':
                // Check if message already exists
                const existingMessage = document.querySelector(`.message[data-id="${data.message.id}"]`);
                if (existingMessage) {
                    return; // Skip if message already exists
                }
                
                // If this is a user message, we don't need to do anything else
                if (data.message.role === 'user') {
                    return;
                }
                
                // Add the new message to chat (only for assistant messages)
                addMessageToChat(data.message.role, data.message.content, data.message.id);
                
                // Remove typing indicator only when receiving assistant message
                const typingIndicator = document.querySelector('.typing-indicator');
                if (typingIndicator) {
                    typingIndicator.remove();
                }
                break;
                
            case 'conversation_deleted':
                if (data.conversationId === currentConversationId) {
                    // If current conversation was deleted, create a new one
                    createNewConversation();
                }
                // Refresh conversation list
                loadConversations();
                break;
        }
    }

    // Configure marked options
    marked.setOptions({
        breaks: true,
        gfm: true
    });

    // Load last active conversation or start new chat
    initializeChat();

    // Improve file attachment functionality
    document.getElementById('attachFileBtn').addEventListener('click', () => {
        // Create a file input element
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,.pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.csv,.json';
        fileInput.style.display = 'none';
        
        // Add to DOM and trigger click
        document.body.appendChild(fileInput);
        fileInput.click();
        
        // Handle file selection
        fileInput.addEventListener('change', async () => {
            if (fileInput.files && fileInput.files[0]) {
                const file = fileInput.files[0];
                
                // Check file size (limit to 10MB)
                const maxSize = 10 * 1024 * 1024; // 10MB
                if (file.size > maxSize) {
                    showNotification('File is too large. Maximum size is 10MB.', 'error');
                    return;
                }
                
                // Get file extension
                const extension = file.name.split('.').pop().toLowerCase();
                
                // Check if file type is supported
                const supportedTypes = ['txt', 'md', 'pdf', 'doc', 'docx', 'csv', 'json', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
                if (!supportedTypes.includes(extension)) {
                    showNotification(`Unsupported file type: .${extension}`, 'error');
                    return;
                }
                
                // Show loading notification
                const loadingNotification = showNotification(`Processing ${file.name}...`, 'info', false);
                
                try {
                    // If this is a new chat, create a new conversation first
                    if (!currentConversationId) {
                        try {
                            // Create a new conversation with an initial title based on the file
                            const response = await fetch('/api/conversations', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    initialTitle: `Analysis of ${file.name}`
                                })
                            });
                            
                            if (!response.ok) {
                                throw new Error('Failed to create conversation');
                            }
                            
                            const data = await response.json();
                            currentConversationId = data.conversationId;
                            
                            // Save current conversation ID to local storage
                            localStorage.setItem('currentConversationId', currentConversationId);
                            
                            // Set initial title in header
                            updateChatHeaderTitle(`Analysis of ${file.name}`);
                        } catch (error) {
                            console.error('Error creating conversation:', error);
                            showNotification('Failed to create conversation', 'error');
                            return;
                        }
                    }
                    
                    // Create FormData to send file
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('conversationId', currentConversationId);
                    
                    // Show file processing in chat
                    const fileMessage = `I'm attaching a file for analysis: ${file.name}.`;
                    const userMessageDiv = addMessageToChat('user', fileMessage);
                    
                    // Add typing indicator with file type info
                    const typingIndicator = document.createElement('div');
                    typingIndicator.className = 'typing-indicator';
                    
                    // Customize message based on file type
                    let processingMessage = 'Processing file';
                    if (['pdf', 'doc', 'docx'].includes(extension)) {
                        processingMessage = 'Extracting document content';
                    } else if (['csv', 'json', 'xlsx'].includes(extension)) {
                        processingMessage = 'Analyzing data';
                    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
                        processingMessage = 'Processing image';
                    }
                    
                    typingIndicator.innerHTML = `
                        <div class="message assistant">
                            <div class="message-icon">
                                <i class="fas fa-robot"></i>
                            </div>
                            <div class="typing-animation">
                                <span style="color: var(--info-color);">${processingMessage}</span>
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    `;
                    chatMessages.appendChild(typingIndicator);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    
                    // Send file to server
                    const response = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error('Failed to upload file');
                    }
                    
                    const data = await response.json();
                    
                    // Remove typing indicator
                    typingIndicator.remove();
                    
                    // Add AI response to chat
                    const assistantMessageDiv = addMessageToChat('assistant', data.response, data.messageId);
                    
                    // Add file processed indicator with file type
                    const infoTag = document.createElement('div');
                    infoTag.className = 'file-info-tag';
                    
                    // Choose icon based on file type
                    let fileIcon = 'fa-file-alt';
                    if (data.fileType === 'PDF') {
                        fileIcon = 'fa-file-pdf';
                    } else if (data.fileType === 'Word document') {
                        fileIcon = 'fa-file-word';
                    } else if (data.fileType === 'CSV spreadsheet') {
                        fileIcon = 'fa-file-csv';
                    } else if (data.fileType === 'JSON data') {
                        fileIcon = 'fa-file-code';
                    } else if (data.fileType === 'image') {
                        fileIcon = 'fa-file-image';
                    }
                    
                    infoTag.innerHTML = `<i class="fas ${fileIcon}"></i> File analyzed`;
                    assistantMessageDiv.appendChild(infoTag);
                    
                    // Refresh conversation list to show updated preview
                    await loadConversations();
                    
                    // Remove loading notification
                    loadingNotification.remove();
                    
                    // Show success notification
                    showNotification('File processed successfully', 'success');
                    
                    // Auto-name the conversation if it's new
                    if (document.getElementById('currentChatTitle').textContent === `Analysis of ${file.name}`) {
                        autoNameConversation(currentConversationId, fileMessage);
                    }
                } catch (error) {
                    console.error('Error processing file:', error);
                    
                    // Remove loading notification
                    loadingNotification.remove();
                    
                    // Show error notification
                    showNotification('Failed to process file. Please try again.', 'error');
                } finally {
                    // Clean up the file input
                    document.body.removeChild(fileInput);
                }
            }
        });
    });

    // Add character count functionality
    function updateCharCount() {
        const textarea = document.getElementById('user-input');
        const charCount = document.getElementById('charCount');
        const maxLength = 2000;
        const currentLength = textarea.value.length;
        
        charCount.textContent = `${currentLength}/${maxLength}`;
        
        if (currentLength > maxLength) {
            charCount.style.color = 'var(--error-color)';
        } else if (currentLength > maxLength * 0.8) {
            charCount.style.color = 'var(--warning-color)';
        } else {
            charCount.style.color = 'var(--text-secondary)';
        }
    }

    // Update the existing input event listener
    userInput.addEventListener('input', () => {
        // Enable button only if there's text in the input
        sendButton.disabled = userInput.value.trim() === '';
        
        // Auto-resize the textarea
        userInput.style.height = 'auto';
        userInput.style.height = (userInput.scrollHeight) + 'px';
        
        // Update character count
        updateCharCount();
    });

    // Reset height when cleared
    userInput.addEventListener('focus', () => {
        setTimeout(() => {
            userInput.style.height = 'auto';
            userInput.style.height = (userInput.scrollHeight) + 'px';
        }, 0);
    });

    // Handle send button click
    sendButton.addEventListener('click', handleSendMessage);

    // Handle enter key press (with shift+enter for new line)
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Handle new chat button
    newChatBtn.addEventListener('click', async () => {
        try {
            // Check if current chat is "New Chat" with no messages
            const currentTitle = document.getElementById('currentChatTitle').textContent;
            const messageCount = document.querySelectorAll('.message').length;
            
            if (currentTitle === 'New Chat' && messageCount === 0) {
                // If current chat is already a new empty chat, just return
                showNotification('You already have an empty chat open', 'info');
                return;
            }
            
            // Create a new conversation
            const response = await fetch('/api/conversations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to create conversation');
            }
            
            const data = await response.json();
            
            // Clear chat messages
            document.getElementById('chat-messages').innerHTML = '';
            
            // Update current conversation ID
            currentConversationId = data.conversationId;
            
        // Save current conversation ID to local storage
            localStorage.setItem('currentConversationId', currentConversationId);
            
            // Update chat title
            updateChatHeaderTitle('New Chat');
            
            // Clear user input
            document.getElementById('user-input').value = '';
            
            // Refresh conversation list
            await loadConversations();
            
            // Initialize message count to 0
            updateMessageCount(0);
            
            // Show notification
            showNotification('New chat created', 'success');
        } catch (error) {
            console.error('Error creating new chat:', error);
            showNotification('Failed to create new chat', 'error');
        }
    });

    // Keep the existing mobile menu button functionality
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('show');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && 
            !sidebar.contains(e.target) && 
            !mobileMenuBtn.contains(e.target) && 
            sidebar.classList.contains('show')) {
            sidebar.classList.remove('show');
        }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            sidebar.classList.remove('show');
        }
    });

    // Add this after the other button event listeners
    const userInfoElement = document.getElementById('settingsBtn');
    userInfoElement.addEventListener('click', () => {
        window.location.href = '/settings.html';
    });

    // Add this after other event listeners
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', filterConversations);

    // Add this function to request auto-naming
    async function requestAutoName(conversationId) {
        try {
            const response = await fetch(`/api/conversations/${conversationId}/auto-name`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.title) {
                    updateChatHeaderTitle(data.title);
                    
                    // Refresh the conversation list to show the updated title
                    await loadConversations();
                } else {
                    console.log('Auto-naming did not return a title');
                }
            } else {
                console.error('Failed to auto-name conversation');
            }
        } catch (error) {
            console.error('Error requesting auto-name:', error);
        }
    }

    // Add this function to load user info for the sidebar
    async function loadUserInfo() {
        try {
            const response = await fetch('/api/user/profile');
            
            if (response.ok) {
                const userData = await response.json();
                
                // Update user info in the sidebar
                const userAvatar = document.getElementById('userAvatar');
                const userName = document.getElementById('userName');
                const userEmail = document.getElementById('userEmail');
                
                if (userData.name) {
                    userName.textContent = userData.name;
                    // Set avatar to first letter of name
                    userAvatar.textContent = userData.name.charAt(0).toUpperCase();
                }
                
                if (userData.email) {
                    userEmail.textContent = userData.email;
                }
                
                // Store user ID in localStorage for group features
                if (userData.id) {
                    localStorage.setItem('userId', userData.id);
                }
            }
        } catch (error) {
            console.error('Failed to load user info:', error);
        }
    }

    // Call loadUserInfo after initializing chat
    async function initializeChat() {
        try {
            // Load user info for the sidebar
            await loadUserInfo();
            
            // Load conversations first
            await loadConversations();
            
            // Try to get the last active conversation ID from local storage
            const savedConversationId = localStorage.getItem('currentConversationId');
            
            if (savedConversationId) {
                // Load the last active conversation
                await loadConversation(savedConversationId);
            } else {
                // If no saved conversation, show welcome message
                chatMessages.innerHTML = '';
                addMessageToChat('assistant', 'Hi! How can I help you today?');
            }
        } catch (error) {
            console.error('Error initializing chat:', error);
            chatMessages.innerHTML = '';
            addMessageToChat('assistant', 'Hi! How can I help you today?');
        }
    }

    async function loadConversations() {
        try {
            // Fetch both regular and collaborative chats
            const [regularResponse, collaborativeResponse] = await Promise.all([
                fetch('/api/conversations'),
                fetch('/api/collaborative-chats')
            ]);

            if (!regularResponse.ok || !collaborativeResponse.ok) {
                throw new Error('Failed to fetch conversations');
            }

            const regularConversations = await regularResponse.json();
            const collaborativeConversations = await collaborativeResponse.json();
            
            // Clear existing conversations
            chatList.innerHTML = '';
            
            // Handle empty conversations array
            if ((!Array.isArray(regularConversations) || regularConversations.length === 0) && 
                (!Array.isArray(collaborativeConversations) || collaborativeConversations.length === 0)) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'empty-conversations';
                emptyMessage.innerHTML = `
                    <i class="fas fa-comments"></i>
                    <p>No conversations yet</p>
                    <p>Start a new chat to begin</p>
                `;
                chatList.appendChild(emptyMessage);
                return;
            }

            // Separate regular conversations by type
            const pinnedConversations = regularConversations.filter(conv => conv.is_favorite === 1 && !conv.is_collaborative);
            const nonPinnedConversations = regularConversations.filter(conv => conv.is_favorite !== 1 && !conv.is_collaborative);

            // Render pinned conversations at the top if any exist
            if (pinnedConversations.length > 0) {
                const pinnedHeader = document.createElement('div');
                pinnedHeader.className = 'pinned-header';
                pinnedHeader.innerHTML = `
                    <i class="fas fa-thumbtack"></i>
                    <span>Pinned Conversations</span>
                `;
                chatList.appendChild(pinnedHeader);

                pinnedConversations.forEach(conversation => {
                    const chatItem = createChatItem(conversation);
                    chatList.appendChild(chatItem);
                });
            }

            // Add section header for group chats
            const groupHeader = document.createElement('div');
            groupHeader.className = 'section-header group';
            
            // Add new collaborative chat button to header
            const groupHeaderContent = document.createElement('div');
            groupHeaderContent.className = 'section-header-content';
            groupHeaderContent.innerHTML = `
                <i class="fas fa-users"></i>
                <span>Group Chats</span>
            `;
            
            const newGroupChatBtn = document.createElement('button');
            newGroupChatBtn.className = 'section-add-btn';
            newGroupChatBtn.title = 'New collaborative chat';
            newGroupChatBtn.innerHTML = '<i class="fas fa-plus"></i>';
            newGroupChatBtn.addEventListener('click', createNewCollaborativeChat);
            
            groupHeader.appendChild(groupHeaderContent);
            groupHeader.appendChild(newGroupChatBtn);
            
            chatList.appendChild(groupHeader);

            // Render group conversations if any exist
            if (collaborativeConversations.length > 0) {
                collaborativeConversations.forEach(conversation => {
                    const chatItem = createChatItem(conversation);
                    chatList.appendChild(chatItem);
                });
            }

            // Add section header for regular chats
            if (nonPinnedConversations.length > 0) {
                const regularHeader = document.createElement('div');
                regularHeader.className = 'section-header';
                
                // Add new chat button to header
                const regularHeaderContent = document.createElement('div');
                regularHeaderContent.className = 'section-header-content';
                regularHeaderContent.innerHTML = `
                    <i class="fas fa-comments"></i>
                    <span>Regular Chats</span>
                `;
                
                const newChatBtn = document.createElement('button');
                newChatBtn.className = 'section-add-btn';
                newChatBtn.title = 'New chat';
                newChatBtn.innerHTML = '<i class="fas fa-plus"></i>';
                newChatBtn.addEventListener('click', () => {
                    document.getElementById('newChatBtn').click();
                });
                
                regularHeader.appendChild(regularHeaderContent);
                regularHeader.appendChild(newChatBtn);
                
                chatList.appendChild(regularHeader);
            }

            // Group regular conversations by date
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            const todayConversations = [];
            const yesterdayConversations = [];
            const olderConversations = new Map();
            
            nonPinnedConversations.forEach(conversation => {
                const date = new Date(conversation.created_at);
                date.setHours(0, 0, 0, 0);
                
                if (date.getTime() === today.getTime()) {
                    todayConversations.push(conversation);
                } else if (date.getTime() === yesterday.getTime()) {
                    yesterdayConversations.push(conversation);
                } else {
                    const dateKey = date.toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                    });
                    
                    if (!olderConversations.has(dateKey)) {
                        olderConversations.set(dateKey, []);
                    }
                    olderConversations.get(dateKey).push(conversation);
                }
            });
            
            // Render regular conversations by section
            if (todayConversations.length > 0) {
                renderConversationSection('Today', todayConversations);
            }
            
            if (yesterdayConversations.length > 0) {
                renderConversationSection('Yesterday', yesterdayConversations);
            }
            
            olderConversations.forEach((conversations, date) => {
                renderConversationSection(date, conversations);
            });
        } catch (error) {
            console.error('Error loading conversations:', error);
            showNotification('Failed to load conversations', 'error');
        }
    }

    // Helper function to render a more compact section of conversations
    function renderConversationSection(title, conversations) {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'chat-list-section';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'chat-list-header';
        headerDiv.innerHTML = `
            <span>${title}</span>
            <span class="count">${conversations.length}</span>
        `;
        
        sectionDiv.appendChild(headerDiv);
        
            conversations.forEach(conversation => {
            const chatItem = createChatItem(conversation);
            sectionDiv.appendChild(chatItem);
        });
        
        chatList.appendChild(sectionDiv);
    }

    // Create a more compact chat item
    function createChatItem(conversation) {
                const chatItem = document.createElement('div');
                chatItem.className = 'chat-item';
                if (conversation.id === currentConversationId) {
                    chatItem.classList.add('active');
                }
        
        // Add pinned class if conversation is pinned
        if (conversation.is_favorite === 1) {
            chatItem.classList.add('pinned');
        }
        
                chatItem.dataset.id = conversation.id;
        
        // Truncate title if too long
        let title = conversation.title || 'New Chat';
        if (title.length > 25) {
            title = title.substring(0, 22) + '...';
        }
                
                chatItem.innerHTML = `
                    <div class="chat-item-content">
                <div class="chat-title" title="${conversation.title || 'New Chat'}">
                    ${title}
                    </div>
                    </div>
            <div class="chat-item-actions">
                <button class="pin-chat-btn" title="${conversation.is_favorite === 1 ? 'Unpin chat' : 'Pin chat'}">
                    <i class="fas fa-thumbtack"></i>
                    </button>
                <button class="delete-chat-btn" title="Delete chat">
                    <i class="fas fa-times"></i>
                    </button>
            </div>
                `;

                // Add click handler for loading conversation
                chatItem.querySelector('.chat-item-content').addEventListener('click', () => {
                    loadConversation(conversation.id);
                    // Update active conversation styling
                    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
                    chatItem.classList.add('active');
            
            // On mobile, close the sidebar after selecting a conversation
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('show');
            }
        });

        // Add click handler for pin button
        chatItem.querySelector('.pin-chat-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const newPinnedState = conversation.is_favorite !== 1;
                const response = await fetch(`/api/conversations/${conversation.id}/favorite`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({ is_favorite: newPinnedState })
                });
                
                if (response.ok) {
                    // Refresh the conversation list to reorder
                    await loadConversations();
                    
                    // Show notification
                    if (newPinnedState) {
                        showNotification('Conversation pinned', 'success');
                    } else {
                        showNotification('Conversation unpinned', 'success');
                    }
                } else {
                    throw new Error('Failed to update pin status');
                }
            } catch (error) {
                console.error('Error updating pin status:', error);
                showNotification('Failed to update pin status', 'error');
            }
                });

                // Add click handler for delete button
                chatItem.querySelector('.delete-chat-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
            if (confirm('Delete this conversation?')) {
                        const success = await deleteConversation(conversation.id);
                        if (success) {
                            await loadConversations();
                            if (currentConversationId === conversation.id) {
                                currentConversationId = null;
                                localStorage.removeItem('currentConversationId');
                                chatMessages.innerHTML = '';
                                addMessageToChat('assistant', 'Hi! How can I help you today?');
                            }
                        }
                    }
                });
                
        return chatItem;
    }

    async function loadConversation(id) {
        try {
            currentConversationId = id;
            
            // Subscribe to WebSocket updates for this conversation
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'subscribe',
                    conversationId: id
                }));
            }
            
            // Save current conversation ID to local storage
            localStorage.setItem('currentConversationId', id);
            
            // Clear current messages
            chatMessages.innerHTML = '';
            
            // Show loading
            addTypingIndicator();
            
            // Get conversation details first to check if it's collaborative
            const conversationResponse = await fetch(`/api/conversations/${id}`);
            if (!conversationResponse.ok) {
                if (conversationResponse.status === 404) {
                    // Clear invalid conversation ID from localStorage
                    localStorage.removeItem('currentConversationId');
                    // Create a new conversation
                    const newConversation = await createNewConversation();
                    if (newConversation) {
                        showNotification('Previous conversation not found. Created a new one.', 'info');
                        return;
                    }
                }
                throw new Error('Failed to get conversation details');
            }
            
            const conversation = await conversationResponse.json();
            const isCollaborative = conversation.is_collaborative === 1;
            
            // Get messages
            const response = await fetch(`/api/conversations/${id}/messages`);
            if (!response.ok) {
                throw new Error('Failed to get messages');
            }
            
            const messages = await response.json();
            
            // Remove loading indicator
            document.querySelector('.typing-indicator')?.remove();
            
            // Update chat title and add group options button if it's a collaborative chat
            const titleElement = document.getElementById('currentChatTitle');
            let title = conversation.title || 'New Chat';
            
            if (isCollaborative) {
                // For collaborative chats, add the users icon and group options
                title = title;
                
                // Add group options button to header if it doesn't exist
                if (!document.getElementById('groupOptionsBtn')) {
                    const chatHeaderActions = document.querySelector('.chat-header-actions');
                    const groupOptionsBtn = document.createElement('button');
                    groupOptionsBtn.className = 'chat-header-btn';
                    groupOptionsBtn.id = 'groupOptionsBtn';
                    groupOptionsBtn.title = 'Group options';
                    groupOptionsBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
                    groupOptionsBtn.addEventListener('click', () => showGroupOptions(conversation));
                    
                    // Insert before the share button
                    const shareBtn = document.getElementById('shareChatBtn');
                    chatHeaderActions.insertBefore(groupOptionsBtn, shareBtn);
                }
            } else {
                // Remove group options button if it exists and this is not a group chat
                const groupOptionsBtn = document.getElementById('groupOptionsBtn');
                if (groupOptionsBtn) {
                    groupOptionsBtn.remove();
                }
            }
            
            updateChatHeaderTitle(title);
            
            // If no messages, show welcome message
            if (messages.length === 0) {
                if (isCollaborative) {
                    addMessageToChat('assistant', `Welcome to this collaborative chat! You can invite others to join this conversation.`);
                } else {
                    addMessageToChat('assistant', 'Hi! How can I help you today?');
                }
                updateMessageCount(0);
                return;
            }
            
            // Add messages to UI
            messages.forEach(message => {
                // For collaborative chats, show user names
                if (isCollaborative && message.user_name && message.role === 'user') {
                    addMessageToChat(message.role, {
                        text: message.content,
                        userName: message.user_name
                    }, message.id);
                } else {
                    addMessageToChat(message.role, message.content, message.id);
                }
            });
            
            // Update message count
            updateMessageCount(messages.length);
            
            // Scroll to bottom
            document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
        } catch (error) {
            console.error('Error loading conversation:', error);
            document.querySelector('.typing-indicator')?.remove();
            showNotification('Failed to load conversation', 'error');
        }
    }

    async function deleteConversation(id) {
        try {
            // Show in-progress notification
            const loadingNotification = showNotification('Deleting conversation...', 'info', false);
            
            const response = await fetch(`/api/conversations/${id}`, {
                method: 'DELETE'
            });
            
            // Remove loading notification
            loadingNotification.remove();
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error('Server error:', errorData);
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error('Server failed to delete conversation');
            }

            // Show success message
            showNotification('Conversation deleted successfully', 'success');
            return true;
        } catch (error) {
            console.error('Error deleting conversation:', error);
            showNotification(`Failed to delete conversation: ${error.message}`, 'error');
            return false;
        }
    }

    // Improve the typing indicator function
    function addTypingIndicator(type = 'default') {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        
        let innerContent = '';
        
        switch(type) {
            case 'search':
                innerContent = `
                    <div class="message assistant">
                        <div class="message-icon">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="typing-animation">
                            <span class="typing-text">Searching for information</span>
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                `;
                break;
            case 'file':
                innerContent = `
                    <div class="message assistant">
                        <div class="message-icon">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="typing-animation">
                            <span class="typing-text">Processing file</span>
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                `;
                break;
            default:
                innerContent = `
                    <div class="message assistant">
                        <div class="message-icon">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="typing-animation">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                `;
        }
        
        typingDiv.innerHTML = innerContent;
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        return typingDiv;
    }

    // Update the handleSendMessage function
    async function handleSendMessage() {
        const message = userInput.value.trim();
        if (message === '') return;
        
        // Clear input and reset height
        userInput.value = '';
        userInput.style.height = 'auto';
        
        // Disable send button
        sendButton.disabled = true;

        // Get user info from localStorage
        const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
        const userName = userInfo.name || 'You';

        // Add user message first
        addMessageToChat('user', message);

        // Check if this might need search
        const mightNeedSearch = /current|latest|recent|today|news|weather|stock|price|update|2023|2024/i.test(message);

        // Add appropriate typing indicator after user message
        const typingIndicator = addTypingIndicator(mightNeedSearch ? 'search' : 'default');
        
        try {
            // Send message to server
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    conversationId: currentConversationId
                })
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const data = await response.json();
            
            // Update current conversation ID if it's a new conversation
            if (data.conversationId && (!currentConversationId || currentConversationId !== data.conversationId)) {
                currentConversationId = data.conversationId;
                localStorage.setItem('currentConversationId', currentConversationId);
            }
            
            // Refresh conversation list to show updated preview
            await loadConversations();
            
            // Auto-name the conversation if it's new
            if (document.getElementById('currentChatTitle').textContent === 'New Chat') {
                autoNameConversation(currentConversationId, message);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            
            // Remove typing indicator only on error
            typingIndicator.remove();
            
            // Show error message
            const errorDiv = document.createElement('div');
            errorDiv.className = 'message system error';
            errorDiv.textContent = 'Failed to get response. Please try again.';
            chatMessages.appendChild(errorDiv);
            
            showNotification('Failed to get response', 'error');
        } finally {
            // Re-enable send button
            sendButton.disabled = false;
        }
    }

    // Updated addMessageToChat function to handle file attachments
    function addMessageToChat(role, content, messageId) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        if (messageId) {
            messageDiv.dataset.id = messageId;
        }
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'message-icon';
        iconDiv.innerHTML = role === 'assistant' ? 
            '<i class="fas fa-link"></i>' : 
            '<i class="fas fa-user"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Extract userName if content is an object
        let messageContent = content;
        let userName = null;
        
        if (typeof content === 'object' && content !== null) {
            messageContent = content.text || '';
            userName = content.userName || null;
        }
        
        // Add name for both user and assistant messages
        const nameDiv = document.createElement('div');
        nameDiv.className = 'message-name';
        
        // Get user info from localStorage for user messages
        if (role === 'user') {
            const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
            nameDiv.textContent = userName || userInfo.name || 'You';
        } else {
            nameDiv.textContent = 'GPT-Link';
        }
        
        contentDiv.appendChild(nameDiv);
        
        // Add message content
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = marked.parse(messageContent);
        contentDiv.appendChild(textDiv);
        
        messageDiv.appendChild(iconDiv);
        messageDiv.appendChild(contentDiv);
        
        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.appendChild(timestamp);
        
        // Add message actions
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        if (role === 'assistant') {
            // Add copy button for assistant messages
            const copyBtn = document.createElement('button');
            copyBtn.className = 'message-action-btn';
            copyBtn.title = 'Copy message';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
            copyBtn.addEventListener('click', () => {
                // Copy message content to clipboard
                navigator.clipboard.writeText(content)
                    .then(() => {
                        showNotification('Message copied to clipboard', 'success');
                    })
                    .catch(err => {
                        console.error('Could not copy text: ', err);
                        showNotification('Failed to copy message', 'error');
                    });
            });
            
            // Add regenerate button for assistant messages
            const regenerateBtn = document.createElement('button');
            regenerateBtn.className = 'message-action-btn';
            regenerateBtn.title = 'Regenerate response';
            regenerateBtn.innerHTML = '<i class="fas fa-redo-alt"></i>';
            regenerateBtn.addEventListener('click', () => {
                // Get the previous user message
                const messages = Array.from(document.querySelectorAll('.message'));
                const currentIndex = messages.indexOf(messageDiv);
                
                if (currentIndex > 0 && messages[currentIndex - 1].classList.contains('user')) {
                    const userMessage = messages[currentIndex - 1].querySelector('.message-content').textContent;
                    
                    // Remove the current assistant message
                    messageDiv.remove();
                    
                    // Regenerate the response
                    regenerateResponse(userMessage);
                } else {
                    showNotification('Cannot regenerate this response', 'error');
                }
            });
            
            // Add speak button for assistant messages
            const speakBtn = document.createElement('button');
            speakBtn.className = 'message-action-btn';
            speakBtn.title = 'Read aloud';
            speakBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            
            // Keep track of current speech
            let currentSpeech = null;
            
            speakBtn.addEventListener('click', () => {
                // Check if speech synthesis is available
                if ('speechSynthesis' in window) {
                    try {
                        // If there's already speech playing, stop it
                        if (currentSpeech) {
                            window.speechSynthesis.cancel();
                            currentSpeech = null;
                            speakBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                            speakBtn.title = 'Read aloud';
                            return;
                        }
                        
                        // Get plain text content
                        const textContent = contentDiv.textContent;
                        const utterance = new SpeechSynthesisUtterance(textContent);
                        
                        // Configure speech settings
                        utterance.rate = 1.0; // Normal speed
                        utterance.pitch = 1.0; // Normal pitch
                        utterance.volume = 1.0; // Full volume
                        
                        // Try to get a female voice if available
                        const voices = window.speechSynthesis.getVoices();
                        const femaleVoice = voices.find(voice => voice.name.includes('female') || voice.name.includes('Female'));
                        if (femaleVoice) {
                            utterance.voice = femaleVoice;
                        }
                        
                        // Add event handlers
                        utterance.onstart = () => {
                            currentSpeech = utterance;
                            speakBtn.innerHTML = '<i class="fas fa-stop"></i>';
                            speakBtn.title = 'Stop reading';
                            showNotification('Reading message aloud', 'info');
                        };
                        
                        utterance.onend = () => {
                            currentSpeech = null;
                            speakBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                            speakBtn.title = 'Read aloud';
                        };
                        
                        utterance.onerror = (event) => {
                            console.error('Speech synthesis error:', event);
                            currentSpeech = null;
                            speakBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                            speakBtn.title = 'Read aloud';
                            
                            // Handle specific error types
                            if (event.error === 'interrupted') {
                                showNotification('Speech interrupted', 'info');
                            } else if (event.error === 'canceled') {
                                showNotification('Speech canceled', 'info');
                            } else {
                                showNotification('Error reading message aloud', 'error');
                            }
                        };
                        
                        // Stop any current speech
                        window.speechSynthesis.cancel();
                        
                        // Speak the text
                        window.speechSynthesis.speak(utterance);
                        
                    } catch (error) {
                        console.error('Speech synthesis error:', error);
                        currentSpeech = null;
                        speakBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                        speakBtn.title = 'Read aloud';
                        showNotification('Error reading message aloud', 'error');
                    }
                } else {
                    showNotification('Text-to-speech not supported in your browser', 'error');
                }
            });
            
            actionsDiv.appendChild(regenerateBtn);
            actionsDiv.appendChild(speakBtn);
            actionsDiv.appendChild(copyBtn);
        } else if (role === 'user') {
            // Add edit button for user messages
            const editBtn = document.createElement('button');
            editBtn.className = 'message-action-btn';
            editBtn.title = 'Edit message';
            editBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
            editBtn.addEventListener('click', () => {
                // Store the current content
                const currentContent = typeof content === 'object' ? content.text : content;
                
                // Replace content with textarea
                contentDiv.innerHTML = '';
                const textarea = document.createElement('textarea');
                textarea.className = 'edit-message-textarea';
                textarea.value = currentContent;
                textarea.rows = Math.max(3, currentContent.split('\n').length);
                contentDiv.appendChild(textarea);
                
                // Add save and cancel buttons
                const editActions = document.createElement('div');
                editActions.className = 'edit-actions';
                
                const saveBtn = document.createElement('button');
                saveBtn.className = 'edit-action-btn save';
                saveBtn.innerHTML = '<i class="fas fa-check"></i> Save';
                
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'edit-action-btn cancel';
                cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
                
                editActions.appendChild(saveBtn);
                editActions.appendChild(cancelBtn);
                contentDiv.appendChild(editActions);
                
                // Focus the textarea
                textarea.focus();
                
                // Handle save button click
                saveBtn.addEventListener('click', () => {
                    const newContent = textarea.value.trim();
                    if (newContent && newContent !== currentContent) {
                        // Update the message content
                        contentDiv.innerHTML = marked.parse(newContent);
                        
                        // Re-add syntax highlighting
                        contentDiv.querySelectorAll('pre code').forEach((block) => {
                            hljs.highlightElement(block);
                        });
                        
                        // If there's a next message and it's from the assistant, regenerate it
                        const messages = Array.from(document.querySelectorAll('.message'));
                        const currentIndex = messages.indexOf(messageDiv);
                        
                        if (currentIndex < messages.length - 1 && messages[currentIndex + 1].classList.contains('assistant')) {
                            // Remove the assistant message
                            messages[currentIndex + 1].remove();
                            
                            // Regenerate the response with the edited message
                            regenerateResponse(newContent);
                        }
                    } else {
                        // If no changes or empty, just restore the original content
                        contentDiv.innerHTML = marked.parse(currentContent);
                        
                        // Re-add syntax highlighting
                        contentDiv.querySelectorAll('pre code').forEach((block) => {
                            hljs.highlightElement(block);
                        });
                    }
                });
                
                // Handle cancel button click
                cancelBtn.addEventListener('click', () => {
                    // Restore the original content
                    contentDiv.innerHTML = marked.parse(currentContent);
                    
                    // Re-add syntax highlighting
                    contentDiv.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                });
            });
            
            // Add delete button for user messages
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'message-action-btn delete';
            deleteBtn.title = 'Delete message';
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
            deleteBtn.addEventListener('click', () => {
                // Confirm deletion
                if (confirm('Delete this message and its response?')) {
                    // Find the next message (assistant response)
                    const messages = Array.from(document.querySelectorAll('.message'));
                    const currentIndex = messages.indexOf(messageDiv);
                    
                    // Get message IDs for deletion
                    const userMessageId = messageDiv.dataset.id;
                    let assistantMessageId = null;
                    
                    if (currentIndex < messages.length - 1 && messages[currentIndex + 1].classList.contains('assistant')) {
                        assistantMessageId = messages[currentIndex + 1].dataset.id;
                        // Remove the assistant message from DOM
                        messages[currentIndex + 1].remove();
                    }
                    
                    // Remove the user message from DOM
                    messageDiv.remove();
                    
                    // Delete messages from server
                    deleteMessages(userMessageId, assistantMessageId);
                    
                    // Update message count
                    updateMessageCount();
                    
                    showNotification('Messages deleted', 'success');
                }
            });
            
            // Add copy button for user messages
            const copyBtn = document.createElement('button');
            copyBtn.className = 'message-action-btn';
            copyBtn.title = 'Copy message';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
            copyBtn.addEventListener('click', () => {
                // Copy message content to clipboard
                navigator.clipboard.writeText(content)
                    .then(() => {
                        showNotification('Message copied to clipboard', 'success');
                    })
                    .catch(err => {
                        console.error('Could not copy text: ', err);
                        showNotification('Failed to copy message', 'error');
                    });
            });
            
            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);
            actionsDiv.appendChild(copyBtn);
        }
        
        messageDiv.appendChild(actionsDiv);
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Update message count
        updateMessageCount();
        
        return messageDiv;
    }

    // Function to regenerate a response
    async function regenerateResponse(userMessage) {
        if (!currentConversationId || !userMessage) return;
        
        // Show typing indicator
        const typingIndicator = addTypingIndicator();
        
        try {
            // Send message to API with regenerate flag
            const response = await fetch(`/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: userMessage,
                    conversationId: currentConversationId,
                    regenerate: true
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to regenerate response');
            }
            
            const data = await response.json();
            
            // Remove typing indicator
            typingIndicator.remove();
            
            // Add new assistant response to chat
            addMessageToChat('assistant', data.response);
            
        } catch (error) {
            console.error('Error regenerating response:', error);
            
            // Remove typing indicator
            typingIndicator.remove();
            
            // Show error message
            addMessageToChat('assistant', 'Sorry, I encountered an error while regenerating the response. Please try again.');
            showNotification('Failed to regenerate response', 'error');
        }
    }

    // Update showNotification function to support persistent notifications
    function showNotification(message, type = 'info', autoHide = true) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        if (type === 'info' && message.includes('Processing')) {
            // Special styling for file processing
            notification.className += ' file-processing';
            notification.innerHTML = `
                <i class="fas fa-spinner spinner"></i>
                <span>${message}</span>
            `;
        } else {
        notification.textContent = message;
        }
        
        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 100);
        
        if (autoHide) {
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
        }
        
        return notification;
    }

    // Add these utility functions at the top
    function showLoading() {
        const loader = document.createElement('div');
        loader.className = 'loading-spinner';
        loader.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
        document.body.appendChild(loader);
    }

    function hideLoading() {
        const loader = document.querySelector('.loading-spinner');
        if (loader) {
            loader.remove();
        }
    }

    // Add this function to load and apply user preferences
    async function loadUserPreferences() {
        // First check localStorage for cached preferences
        const cachedPrefs = localStorage.getItem('userPreferences');
        if (cachedPrefs) {
            const prefs = JSON.parse(cachedPrefs);
            applyPreferences(prefs);
        }
        
        // Then fetch from server to ensure we have the latest
        try {
            const response = await fetch('/api/user/preferences', {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const prefs = {
                    theme: data.theme,
                    fontSize: data.font_size || 'medium'
                };
                
                // Update localStorage
                localStorage.setItem('userPreferences', JSON.stringify(prefs));
                
                // Apply preferences
                applyPreferences(prefs);
            }
        } catch (error) {
            console.error('Failed to load preferences:', error);
        }
    }

    function applyPreferences(prefs) {
        // Apply theme
        document.documentElement.setAttribute('data-theme', prefs.theme);
        
        // Apply font size
        document.documentElement.style.fontSize = {
            small: '14px',
            medium: '16px',
            large: '18px'
        }[prefs.fontSize];
    }

    // Updated filter function to work with sections and only search titles
    function filterConversations() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const chatSections = document.querySelectorAll('.chat-list-section');
        
        if (!searchTerm) {
            // If search is empty, show all conversations
            chatSections.forEach(section => {
                section.style.display = 'block';
                const items = section.querySelectorAll('.chat-item');
                items.forEach(item => {
                    item.style.display = 'flex';
                });
                
                // Update count
                const count = section.querySelectorAll('.chat-item[style="display: flex;"]').length;
                const countElement = section.querySelector('.count');
                if (countElement) {
                    countElement.textContent = count;
                }
                
                // Hide empty sections
                if (count === 0) {
                    section.style.display = 'none';
                }
            });
            
            // Check if we need to show the empty state
            const visibleItems = document.querySelectorAll('.chat-item[style="display: flex;"]');
            const emptyState = document.querySelector('.empty-conversations');
            
            if (visibleItems.length === 0 && !emptyState) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'empty-conversations';
                emptyMessage.innerHTML = `
                    <i class="fas fa-comments"></i>
                    <p>No conversations yet</p>
                    <p>Start a new chat to begin</p>
                `;
                chatList.appendChild(emptyMessage);
            } else if (visibleItems.length > 0 && emptyState) {
                emptyState.remove();
            }
            
            return;
        }
        
        // Remove any existing empty state during search
        const emptyState = document.querySelector('.empty-conversations');
        if (emptyState) {
            emptyState.remove();
        }
        
        let hasVisibleItems = false;
        
        // Filter conversations based on search term
        chatSections.forEach(section => {
            let sectionHasVisibleItems = false;
            const items = section.querySelectorAll('.chat-item');
            
            items.forEach(item => {
                const title = item.querySelector('.chat-title').textContent.toLowerCase();
                
                if (title.includes(searchTerm)) {
                    item.style.display = 'flex';
                    hasVisibleItems = true;
                    sectionHasVisibleItems = true;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Update count and visibility of section
            const count = section.querySelectorAll('.chat-item[style="display: flex;"]').length;
            const countElement = section.querySelector('.count');
            if (countElement) {
                countElement.textContent = count;
            }
            
            section.style.display = sectionHasVisibleItems ? 'block' : 'none';
        });
        
        // Show search empty state if no results
        if (!hasVisibleItems) {
            const searchEmptyMessage = document.createElement('div');
            searchEmptyMessage.className = 'empty-conversations';
            searchEmptyMessage.innerHTML = `
                <i class="fas fa-search"></i>
                <p>No results found</p>
                <p>Try a different search term</p>
            `;
            chatList.appendChild(searchEmptyMessage);
        }
    }

    // Helper function to format dates
    function formatDate(date) {
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            // Today - show time
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            // Yesterday
            return 'Yesterday';
        } else if (diffDays < 7) {
            // Within a week - show day name
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            // Older - show date
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

    // Add this function to update the chat header title
    function updateChatHeaderTitle(title) {
        const chatTitle = document.getElementById('currentChatTitle');
        chatTitle.textContent = title || 'New Chat';
    }

    // Add event listener for chat header actions
    document.getElementById('chatTitleContainer').addEventListener('click', () => {
        const currentTitle = document.getElementById('currentChatTitle').textContent;
        const newTitle = prompt('Rename conversation:', currentTitle);
        
        if (newTitle && newTitle.trim() !== '' && newTitle !== currentTitle) {
            updateConversationTitle(currentConversationId, newTitle.trim());
        }
    });

    // Function to update conversation title
    async function updateConversationTitle(conversationId, newTitle) {
        try {
            const response = await fetch(`/api/conversations/${conversationId}/title`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: newTitle })
            });
            
            if (response.ok) {
                // Update the title in the header
                updateChatHeaderTitle(newTitle);
                
                // Refresh the conversation list to show the updated title
                await loadConversations();
                
                showNotification('Conversation renamed successfully', 'success');
            } else {
                throw new Error('Failed to update conversation title');
            }
        } catch (error) {
            console.error('Error updating conversation title:', error);
            showNotification('Failed to rename conversation', 'error');
        }
    }

    // Updated function to create a new conversation with an initial title
    async function createNewConversation(initialTitle = null) {
        try {
            const requestBody = initialTitle ? { initialTitle } : {};
            
            const response = await fetch('/api/conversations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                throw new Error('Failed to create conversation');
            }
            
            const data = await response.json();
            currentConversationId = data.conversationId;
            
            // Save current conversation ID to local storage
            localStorage.setItem('currentConversationId', currentConversationId);
            
            // Set initial title in header
            updateChatHeaderTitle(initialTitle || 'New Chat');
            
            // If no initial title was provided, we'll let the auto-naming happen later
            return currentConversationId;
        } catch (error) {
            console.error('Error creating conversation:', error);
            showNotification('Failed to create conversation', 'error');
            return null;
        }
    }

    // Updated function to update message count in the header
    function updateMessageCount(count) {
        const messageCountBadge = document.getElementById('messageCountBadge');
        if (messageCountBadge) {
            // If count is provided directly, use it
            // Otherwise, calculate the number of Q&A pairs
            if (typeof count === 'number') {
                // For direct count updates (like when loading a conversation)
                messageCountBadge.textContent = count;
            } else {
                // Count the number of user messages (questions)
                const userMessages = document.querySelectorAll('.message.user');
                messageCountBadge.textContent = userMessages.length;
            }
            
            // Get the current count from the badge
            const currentCount = parseInt(messageCountBadge.textContent, 10);
            
            // Hide the badge if count is 0
            if (currentCount === 0) {
                messageCountBadge.style.display = 'none';
            } else {
                messageCountBadge.style.display = 'inline-flex';
            }
        }
    }

    // Initialize message count on page load
    document.addEventListener('DOMContentLoaded', () => {
        // Existing initialization code...
        
        // Initialize message count to 0
        updateMessageCount(0);
    });

    // Add event listener for share chat button
    document.getElementById('shareChatBtn').addEventListener('click', () => {
        shareChat();
    });

    // Improved share chat functionality with better mobile support
    function shareChat() {
        try {
            // Get current conversation ID
            if (!currentConversationId) {
                showNotification('No active conversation to share', 'error');
                return;
            }
            
            // Show loading state on the share button
            const shareBtn = document.getElementById('shareChatBtn');
            const originalHTML = shareBtn.innerHTML;
            shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            shareBtn.disabled = true;
            
            // Generate shareable link
            const shareableLink = `${window.location.origin}/shared/${currentConversationId}`;
        
        // Detect if we're on mobile
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
                // On mobile, use Web Share API if available
            if (navigator.share) {
                navigator.share({
                        title: 'Shared Chat',
                    text: 'Check out this AI conversation',
                        url: shareableLink
                })
                .then(() => {
                    showNotification('Chat shared successfully', 'success');
                })
                .catch(err => {
                    console.error('Share failed:', err);
                        // If sharing fails, copy to clipboard
                        copyToClipboard(shareableLink);
                })
                .finally(() => {
                        resetShareButton(shareBtn, originalHTML);
                });
                return;
            }
            }
            
            // On desktop or if Web Share API is not available, copy to clipboard
            copyToClipboard(shareableLink);
            resetShareButton(shareBtn, originalHTML);
        } catch (error) {
            console.error('Error sharing chat:', error);
            showNotification('Failed to share chat', 'error');
            resetShareButton(document.getElementById('shareChatBtn'), '<i class="fas fa-share-alt"></i>');
        }
        }
        
    // Helper function to copy to clipboard
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            showNotification('Share link copied to clipboard', 'success');
        } catch (err) {
            console.error('Clipboard API failed:', err);
            // Fallback to execCommand
            const tempInput = document.createElement('input');
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
            showNotification('Share link copied to clipboard', 'success');
        }
    }

    // Helper function to reset share button
    function resetShareButton(button, originalHTML) {
        button.innerHTML = originalHTML;
        button.disabled = false;
    }

    // Add function to delete messages from server
    async function deleteMessages(userMessageId, assistantMessageId) {
        try {
            if (!currentConversationId) return;
            
            // Delete user message
            if (userMessageId) {
                await fetch(`/api/messages/${userMessageId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    }
                });
            }
            
            // Delete assistant message
            if (assistantMessageId) {
                await fetch(`/api/messages/${assistantMessageId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    }
                });
            }
            
            // Refresh conversation list to update preview
            await loadConversations();
        } catch (error) {
            console.error('Error deleting messages:', error);
            showNotification('Failed to delete messages from server', 'error');
        }
    }

    // Add this function to handle auto-naming conversations
    function autoNameConversation(conversationId, firstMessage) {
        // Skip auto-renaming for collaborative chats
        if (!conversationId) return;
        
        // Check if this conversation is collaborative/group
        fetch(`/api/conversations/${conversationId}`)
            .then(response => response.json())
            .then(conversation => {
                // If this is a collaborative chat, don't auto-rename it
                if (conversation.is_collaborative) {
                    console.log('Skipping auto-rename for collaborative chat');
                    return;
                }
                
                // Only auto-name if title is "New Chat"
                if (document.getElementById('currentChatTitle').textContent !== 'New Chat') {
                    return;
                }
                
                // Request auto-naming from the server
                return fetch(`/api/conversations/${conversationId}/auto-name`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Failed to auto-name conversation');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.title) {
                        updateChatHeaderTitle(data.title);
                    }
                });
            })
            .catch(error => {
                console.error('Error in auto-naming:', error);
            });
    }

    // Function to create a new collaborative chat
    async function createNewCollaborativeChat() {
        try {
            // Show loading spinner
            const loadingNotification = showNotification('Creating collaborative chat...', 'info', false);
            
            // Get group name from user
            const defaultTitle = 'New Group Chat';
            const groupName = prompt('Enter a name for this group chat:', defaultTitle) || defaultTitle;
            
            // Create a collaborative chat
            const response = await fetch('/api/collaborative-chats', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: groupName })
            });
            
            if (!response.ok) {
                throw new Error('Failed to create collaborative chat');
            }
            
            const data = await response.json();
            
            // Remove loading notification
            loadingNotification.remove();
            
            // Clear current messages
            document.getElementById('chat-messages').innerHTML = '';
            
            // Update conversation ID
            currentConversationId = data.conversationId;
            
            // Save to local storage
            localStorage.setItem('currentConversationId', currentConversationId);
            
            // Set chat title with collaborative indicator
            updateChatHeaderTitle(groupName);
            
            // Add initial message
            addMessageToChat('assistant', `Welcome to "${groupName}"! This is a collaborative chat where multiple people can participate. You can invite others to join this conversation.`);
            
            // Show participant management button
            await loadConversations();
            
            // Show success message
            showNotification('Collaborative chat created successfully', 'success');
            
            // Show participant management modal
            await showParticipantManagement();
        } catch (error) {
            console.error('Error creating collaborative chat:', error);
            showNotification('Failed to create collaborative chat', 'error');
        }
    }

    // Function to show participant management UI
    async function showParticipantManagement() {
        try {
            // Remove any existing modal first
            const existingModal = document.querySelector('.participant-management-modal');
            if (existingModal) {
                existingModal.remove();
            }

            const response = await fetch(`/api/collaborative-chats/${currentConversationId}/participants`);
            if (!response.ok) {
                throw new Error('Failed to get participants');
            }
            
            const participants = await response.json();
            
            // Create participant management modal
            const modal = document.createElement('div');
            modal.className = 'participant-management-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>Manage Participants</h2>
                    <div class="participants-list">
                        ${participants.map(p => `
                            <div class="participant-item">
                                <span>${p.name} (${p.role})</span>
                                ${p.role !== 'owner' ? `
                                    <button class="remove-participant-btn" data-user-id="${p.id}">
                                        <i class="fas fa-times"></i>
                                    </button>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <div class="add-participant">
                        <input type="email" placeholder="Enter participant's email">
                        <button class="add-participant-btn">Add Participant</button>
                    </div>
                    <button class="close-modal-btn">Close</button>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Add event listeners
            modal.querySelector('.close-modal-btn').addEventListener('click', () => {
                modal.remove();
            });
            
            modal.querySelector('.add-participant-btn').addEventListener('click', async () => {
                const email = modal.querySelector('input[type="email"]').value;
                if (!email) {
                    showNotification('Please enter an email address', 'error');
                    return;
                }
                
                try {
                    const response = await fetch(`/api/collaborative-chats/${currentConversationId}/participants`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ email })
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                        throw new Error(data.error || 'Failed to add participant');
                    }
                    
                    showNotification('Participant added successfully', 'success');
                    showParticipantManagement(); // Refresh the list
                } catch (error) {
                    console.error('Error adding participant:', error);
                    showNotification(error.message || 'Failed to add participant', 'error');
                }
            });
            
            // Add event listeners for remove buttons
            modal.querySelectorAll('.remove-participant-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const userId = btn.dataset.userId;
                    if (confirm('Remove this participant?')) {
                        try {
                            const response = await fetch(`/api/collaborative-chats/${currentConversationId}/participants/${userId}`, {
                                method: 'DELETE'
                            });
                            
                            if (!response.ok) {
                                throw new Error('Failed to remove participant');
                            }
                            
                            showNotification('Participant removed successfully', 'success');
                            showParticipantManagement(); // Refresh the list
                        } catch (error) {
                            console.error('Error removing participant:', error);
                            showNotification('Failed to remove participant', 'error');
                        }
                    }
                });
            });
        } catch (error) {
            console.error('Error showing participant management:', error);
            showNotification('Failed to load participants', 'error');
        }
    }

    // Add function to show group options
    function showGroupOptions(conversation) {
        // Remove existing menu if it exists
        const existingMenu = document.getElementById('groupOptionsMenu');
        if (existingMenu) {
            existingMenu.remove();
            return;
        }
        
        // Create options menu
        const menu = document.createElement('div');
        menu.id = 'groupOptionsMenu';
        menu.className = 'group-options-menu';
        
        // Add menu options
        menu.innerHTML = `
            <div class="menu-item" id="manageParticipantsOption">
                <i class="fas fa-users"></i> Manage participants
            </div>
            <div class="menu-item" id="renameGroupOption">
                <i class="fas fa-edit"></i> Rename group
            </div>
            <div class="menu-item" id="leaveGroupOption">
                <i class="fas fa-sign-out-alt"></i> Leave group
            </div>
            <div class="menu-item danger" id="deleteGroupOption">
                <i class="fas fa-trash-alt"></i> Delete group
            </div>
        `;
        
        // Check if user is owner, if not, hide delete option and show leave option
        if (conversation.user_id !== parseInt(localStorage.getItem('userId'))) {
            menu.querySelector('#deleteGroupOption').style.display = 'none';
        } else {
            menu.querySelector('#leaveGroupOption').style.display = 'none';
        }
        
        // Position the menu
        const button = document.getElementById('groupOptionsBtn');
        const buttonRect = button.getBoundingClientRect();
        menu.style.top = `${buttonRect.bottom + 5}px`;
        menu.style.right = `${window.innerWidth - buttonRect.right}px`;
        
        // Add event listeners
        menu.querySelector('#manageParticipantsOption').addEventListener('click', () => {
            menu.remove();
            showParticipantManagement();
        });
        
        menu.querySelector('#renameGroupOption').addEventListener('click', () => {
            menu.remove();
            renameGroup(conversation);
        });
        
        menu.querySelector('#leaveGroupOption').addEventListener('click', () => {
            menu.remove();
            leaveGroup(conversation.id);
        });
        
        menu.querySelector('#deleteGroupOption').addEventListener('click', () => {
            menu.remove();
            deleteGroup(conversation.id);
        });
        
        // Add click outside to close
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && e.target !== button) {
                menu.remove();
            }
        }, { once: true });
        
        // Add to DOM
        document.body.appendChild(menu);
    }

    // Add function to rename a group
    async function renameGroup(conversation) {
        const newName = prompt('Enter a new name for this group:', conversation.title);
        
        if (!newName || newName.trim() === '' || newName === conversation.title) {
            return;
        }
        
        try {
            const loadingNotification = showNotification('Renaming group...', 'info', false);
            
            const response = await fetch(`/api/conversations/${conversation.id}/title`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: newName })
            });
            
            loadingNotification.remove();
            
            if (!response.ok) {
                throw new Error('Failed to rename group');
            }
            
            // Update the UI
            updateChatHeaderTitle(newName);
            
            // Refresh conversation list
            await loadConversations();
            
            showNotification('Group renamed successfully', 'success');
        } catch (error) {
            console.error('Error renaming group:', error);
            showNotification('Failed to rename group', 'error');
        }
    }

    // Add function to leave a group
    async function leaveGroup(conversationId) {
        if (!confirm('Are you sure you want to leave this group?')) {
            return;
        }
        
        try {
            const loadingNotification = showNotification('Leaving group...', 'info', false);
            
            const userId = localStorage.getItem('userId');
            const response = await fetch(`/api/collaborative-chats/${conversationId}/participants/${userId}`, {
                method: 'DELETE'
            });
            
            loadingNotification.remove();
            
            if (!response.ok) {
                throw new Error('Failed to leave group');
            }
            
            // Refresh conversation list and load a new chat
            await loadConversations();
            
            // Clear the current chat and start a new one
            document.getElementById('newChatBtn').click();
            
            showNotification('You have left the group', 'success');
        } catch (error) {
            console.error('Error leaving group:', error);
            showNotification('Failed to leave group', 'error');
        }
    }

    // Add function to delete a group
    async function deleteGroup(conversationId) {
        if (!confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
            return;
        }
        
        try {
            const loadingNotification = showNotification('Deleting group...', 'info', false);
            
            const response = await fetch(`/api/conversations/${conversationId}`, {
                method: 'DELETE'
            });
            
            loadingNotification.remove();
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || 'Failed to delete group');
            }
            
            // Refresh conversation list and load a new chat
            await loadConversations();
            
            // Clear the current chat and start a new one
            document.getElementById('newChatBtn').click();
            
            showNotification('Group deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting group:', error);
            showNotification(`Failed to delete group: ${error.message}`, 'error');
        }
    }

    // Initialize WebSocket connection
    initializeWebSocket();
}); 