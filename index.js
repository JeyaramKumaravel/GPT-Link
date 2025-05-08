import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    db,
    createConversation,
    addMessage,
    getConversationMessages,
    getConversations,
    deleteConversation,
    getConversationContext,
    updateMessageFeedback,
    updateConversationTitle,
    createCollaborativeChat,
    addParticipant,
    removeParticipant,
    getConversationParticipants,
    isUserParticipant,
    getCollaborativeChats,
    createGroup,
    getGroupMembers,
    addGroupMember,
    removeGroupMember,
    updateGroupMemberRole,
    createGroupAnnouncement,
    markMessageAsRead,
    getUnreadMessageCount
} from './db.js';
import authRoutes from './routes/auth.js';
import jwt from 'jsonwebtoken';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import { googleSearch, formatSearchResults } from './google-search.js';
import { googleImageSearch } from './google-image-search.js';
import { retrieveRelevantContext } from './rag-system.js';
import multer from 'multer';
import fs from 'fs';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { DocxLoader } from 'langchain/document_loaders/fs/docx';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { JSONLoader } from 'langchain/document_loaders/fs/json';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { WebSocketServer } from 'ws';
import http from 'http';

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize Express
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Add auth routes
app.use('/api/auth', authRoutes);

// Middleware to protect routes
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Invalid token' });
    }
};

// Protect chat routes
app.use('/api/chat', authenticateToken);
app.use('/api/conversations', authenticateToken);

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'subscribe') {
                // Store the conversation ID this client is interested in
                ws.conversationId = data.conversationId;
            }
        } catch (error) {
            console.error('WebSocket message parsing error:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Function to broadcast updates to relevant clients
function broadcastUpdate(conversationId, update) {
    wss.clients.forEach((client) => {
        if (client.conversationId === conversationId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(update));
        }
    });
}

// API Routes
// Get all conversations for a user
app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const conversations = await database.all(`
            SELECT c.*, 
                   (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
                   (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
                   (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
            FROM conversations c
            WHERE c.user_id = ? AND c.is_collaborative = 0
            ORDER BY c.is_favorite DESC, c.updated_at DESC
        `, [req.user.userId]);

        res.json(conversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// Get messages from a conversation
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const messages = await getConversationMessages(req.params.id, req.user.userId);
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Create a new conversation
app.post('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const conversationId = await createConversation('New Chat', req.user.userId);
        res.json({ conversationId });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
    }
});

// Delete a conversation
app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await deleteConversation(req.params.id, req.user.userId);
        
        // Broadcast the deletion to all clients
        broadcastUpdate(req.params.id, {
            type: 'conversation_deleted',
            conversationId: req.params.id
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// Chat endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message, conversationId, groupId } = req.body;
        let currentConversationId = conversationId;

        if (!currentConversationId) {
            if (groupId) {
                // Create a new group conversation
                currentConversationId = await createConversation('Group Chat', req.user.userId);
                await db.run(`
                    UPDATE conversations 
                    SET group_id = ?, is_group_chat = 1 
                    WHERE id = ?
                `, [groupId, currentConversationId]);
            } else {
                currentConversationId = await createConversation('New Chat', req.user.userId);
            }
        }

        // Add user message
        const newMessageId = await addMessage(currentConversationId, 'user', message, req.user.userId);

        // Broadcast the user message to all clients watching this conversation
        broadcastUpdate(currentConversationId, {
            type: 'new_message',
            message: {
                id: newMessageId,
                role: 'user',
                content: message,
                timestamp: new Date().toISOString()
            }
        });

        // If it's a group chat, mark the message as read for the sender
        if (groupId) {
            await markMessageAsRead(newMessageId, req.user.userId);
        }

        // Get AI response
        const context = await getConversationContext(currentConversationId);
        
        // Get an image related to the user's query
        const imageUrl = await googleImageSearch(message);
        
        // Prepare context for AI
        const contextMessages = context.messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        // Get current date and time in IST
        const now = new Date();
        const options = { 
            timeZone: 'Asia/Kolkata',
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        };
        const istDateTime = now.toLocaleString('en-IN', options);

        // Use RAG system to retrieve relevant context
        const ragResults = await retrieveRelevantContext(message, req.user.userId, currentConversationId);

        const systemMessage = {
            role: 'system',
            content: `You are a helpful AI assistant optimized for users in India. Format responses using markdown.

Current date and time: ${istDateTime} (IST)
Location: India

Use Indian conventions:
- Currency: ₹/INR
- Distance: km/m
- Temperature: °C
- Weight: kg/g
- Area: sq ft for property, hectares/acres for farmland
- Dates: DD/MM/YYYY
- Phone: +91 prefix
- Time: 12-hour AM/PM format

Be familiar with Indian festivals, cuisine, geography, education system (CBSE/ICSE), government services (Aadhaar/PAN), and languages.

${ragResults.context}

IMPORTANT: Format your response in this order:
1. First, provide a brief introduction or context (1-2 sentences)
2. Then include this image using markdown:
${imageUrl ? `![Related Image](${imageUrl})` : '(No relevant image found)'}
3. Finally, provide the main response or detailed explanation

Maintain context and provide relevant responses. Always be confident and thorough in your answers.`
        };

        // Get AI response
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                systemMessage,
                ...contextMessages,
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 500
        });

        const aiResponse = completion.choices[0].message.content;

        // Add AI response
        const messageId = await addMessage(currentConversationId, 'assistant', aiResponse, req.user.userId);

        // Broadcast the update to all clients watching this conversation
        broadcastUpdate(currentConversationId, {
            type: 'new_message',
            message: {
                id: messageId,
                role: 'assistant',
                content: aiResponse,
                timestamp: new Date().toISOString(),
                usedWebSearch: ragResults.hasWebResults
            }
        });

        res.json({ 
            response: aiResponse,
            conversationId: currentConversationId,
            messageId: messageId,
            usedWebSearch: ragResults.hasWebResults
        });
    } catch (error) {
        console.error('Error in chat endpoint:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// Add feedback endpoint
app.post('/api/messages/:id/feedback', authenticateToken, async (req, res) => {
    try {
        const { score } = req.body;
        await updateMessageFeedback(req.params.id, score);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating feedback:', error);
        res.status(500).json({ error: 'Failed to update feedback' });
    }
});

// Add user routes
app.use('/api/user', userRoutes);

// Add admin routes
app.use('/api/admin', adminRoutes);

// Add this endpoint to update conversation title
app.put('/api/conversations/:id/title', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;
        if (!title || title.trim() === '') {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }
        
        await updateConversationTitle(req.params.id, title, req.user.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating conversation title:', error);
        res.status(500).json({ error: 'Failed to update conversation title' });
    }
});

// Fix the auto-name endpoint to not use OpenAI API
app.post('/api/conversations/:id/auto-name', authenticateToken, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const userId = req.user.userId;
        
        console.log(`Auto-naming conversation ${conversationId} for user ${userId}`);
        
        // Get the first few messages of the conversation
        const messages = await getConversationMessages(conversationId, userId);
        
        if (!messages || messages.length === 0) {
            console.log('No messages found');
            return res.status(400).json({ error: 'No messages found' });
        }
        
        console.log(`Found ${messages.length} messages in conversation`);
        
        // Extract content from the first user message
        const userMessage = messages.find(msg => msg.role === 'user');
        if (!userMessage) {
            console.log('No user message found');
            return res.status(400).json({ error: 'No user message found' });
        }
        
        console.log(`Using user message: "${userMessage.content.substring(0, 50)}..."`);
        
        // Generate a simple title from the first user message
        const words = userMessage.content
            .split(/\s+/)
            .filter(word => word.length > 2)
            .slice(0, 5);
            
        let generatedTitle = words.join(' ');
        
        // If title is too short, add more context
        if (generatedTitle.length < 10 && messages.length > 1) {
            // Try to add some words from the assistant's response
            const assistantMessage = messages.find(msg => msg.role === 'assistant');
            if (assistantMessage) {
                const assistantWords = assistantMessage.content
                    .split(/\s+/)
                    .filter(word => word.length > 3 && !words.includes(word))
                    .slice(0, 3);
                
                if (assistantWords.length > 0) {
                    generatedTitle += ` - ${assistantWords.join(' ')}`;
                }
            }
        }
        
        // Ensure the title isn't too long
        if (generatedTitle.length > 40) {
            generatedTitle = generatedTitle.substring(0, 40) + '...';
        }
        
        // Capitalize first letter of each word
        generatedTitle = generatedTitle
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
            
        console.log(`Generated title: "${generatedTitle}"`);
        
        // Update the conversation title
        await updateConversationTitle(conversationId, generatedTitle, userId);
        console.log('Conversation title updated successfully');
        
        res.json({ title: generatedTitle });
    } catch (error) {
        console.error('Error auto-naming conversation:', error);
        
        // Fallback to a generic title with timestamp
        const fallbackTitle = `Chat ${new Date().toLocaleDateString()}`;
        
        try {
            await updateConversationTitle(req.params.id, fallbackTitle, req.user.userId);
            res.json({ title: fallbackTitle });
        } catch (updateError) {
            res.status(500).json({ 
                error: 'Failed to generate conversation name', 
                details: error.message 
            });
        }
    }
});

// Fix the endpoint to toggle conversation favorite status
app.put('/api/conversations/:id/favorite', authenticateToken, async (req, res) => {
    try {
        const { is_favorite } = req.body;
        const conversationId = req.params.id;
        const userId = req.user.userId;
        
        console.log(`Updating favorite status for conversation ${conversationId} to ${is_favorite ? 'pinned' : 'unpinned'}`);
        
        // First check if the conversation belongs to the user
        const database = await db;
        const conversation = await database.get(
            'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, userId]
        );
        
        if (!conversation) {
            console.error(`Conversation not found or unauthorized: ${conversationId}, user: ${userId}`);
            return res.status(404).json({ error: 'Conversation not found or unauthorized' });
        }
        
        // Update the conversation's favorite status
        await database.run(
            'UPDATE conversations SET is_favorite = ? WHERE id = ? AND user_id = ?',
            [is_favorite ? 1 : 0, conversationId, userId]
        );
        
        console.log(`Successfully updated favorite status for conversation ${conversationId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating conversation favorite status:', error);
        res.status(500).json({ error: 'Failed to update conversation favorite status' });
    }
});

// Add endpoint to delete a message
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.userId;
        
        // Verify the message belongs to the user
        const database = await db;
        const message = await database.get(
            'SELECT * FROM messages WHERE id = ? AND user_id = ?',
            [messageId, userId]
        );
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found or unauthorized' });
        }
        
        // Delete the message
        await database.run(
            'DELETE FROM messages WHERE id = ? AND user_id = ?',
            [messageId, userId]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    // Accept a wider range of file types
    const allowedTypes = [
        'text/plain', 'text/markdown', 'text/csv',
        'application/pdf', 'application/json',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
        'application/msword', // doc
        'image/jpeg', 'image/png', 'image/gif', 'image/webp'
    ];
    
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.endsWith('.md') || 
        file.originalname.endsWith('.csv') || 
        file.originalname.endsWith('.json')) {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file type'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: fileFilter
});

// File upload endpoint
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { conversationId } = req.body;
        const userId = req.user.userId;
        
        if (!conversationId) {
            return res.status(400).json({ error: 'Conversation ID is required' });
        }
        
        // Get file details
        const { originalname, path: filePath, mimetype, size } = req.file;
        
        // Add user message about the file
        const userMessage = `I'm attaching a file for analysis: ${originalname}.`;
        await addMessage(conversationId, 'user', userMessage, userId);
        
        // Extract file content based on type
        let fileContent = '';
        let fileType = '';
        
        try {
            // Use appropriate loader based on file type
            if (mimetype.includes('text/plain') || originalname.endsWith('.txt')) {
                const loader = new TextLoader(filePath);
                const docs = await loader.load();
                fileContent = docs.map(doc => doc.pageContent).join('\n');
                fileType = 'text';
            } 
            else if (mimetype.includes('text/markdown') || originalname.endsWith('.md')) {
                const loader = new TextLoader(filePath);
                const docs = await loader.load();
                fileContent = docs.map(doc => doc.pageContent).join('\n');
                fileType = 'markdown';
            }
            else if (mimetype.includes('application/pdf') || originalname.endsWith('.pdf')) {
                const loader = new PDFLoader(filePath);
                const docs = await loader.load();
                fileContent = docs.map(doc => doc.pageContent).join('\n\n');
                fileType = 'PDF';
            }
            else if (mimetype.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || 
                     originalname.endsWith('.docx')) {
                const loader = new DocxLoader(filePath);
                const docs = await loader.load();
                fileContent = docs.map(doc => doc.pageContent).join('\n\n');
                fileType = 'Word document';
            }
            else if (mimetype.includes('text/csv') || originalname.endsWith('.csv')) {
                const loader = new CSVLoader(filePath);
                const docs = await loader.load();
                fileContent = docs.map(doc => doc.pageContent).join('\n\n');
                fileType = 'CSV spreadsheet';
            }
            else if (mimetype.includes('application/json') || originalname.endsWith('.json')) {
                const loader = new JSONLoader(filePath);
                const docs = await loader.load();
                fileContent = docs.map(doc => doc.pageContent).join('\n\n');
                fileType = 'JSON data';
            }
            else if (mimetype.includes('image/')) {
                // For images, we'll just note it's an image
                fileContent = `[This is an image file: ${originalname}]`;
                fileType = 'image';
            } 
            else {
                // For other files, we'll just note the file type
                fileContent = `[This is a ${mimetype} file: ${originalname}]`;
                fileType = mimetype;
            }
            
            // If content is too large, split it into chunks
            if (fileContent.length > 12000) {
                const textSplitter = new RecursiveCharacterTextSplitter({
                    chunkSize: 10000,
                    chunkOverlap: 200
                });
                
                const chunks = await textSplitter.splitText(fileContent);
                
                // Use the first chunk and note that it's truncated
                fileContent = chunks[0] + `\n\n[Note: This file is large (${(size / 1024).toFixed(2)} KB). Only showing the first part. The file contains ${chunks.length} sections in total.]`;
            }
        } catch (extractError) {
            console.error('Error extracting file content:', extractError);
            fileContent = `[Error extracting content from ${originalname}. The file may be corrupted or in an unsupported format.]`;
            fileType = 'unknown';
        }
        
        // Prepare context for AI
        const context = await getConversationContext(conversationId);
        const contextMessages = context.messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        
        // Get current date and time in IST
        const now = new Date();
        const options = { 
            timeZone: 'Asia/Kolkata',
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        };
        const istDateTime = now.toLocaleString('en-IN', options);
        
        // Get file analysis from AI
        const systemMessage = {
            role: 'system',
            content: `You are a helpful AI assistant optimized for users in India. Format responses using markdown.

Current date and time: ${istDateTime} (IST)
Location: India

You are analyzing a file that the user has uploaded. The file is: ${originalname} (${fileType}, ${(size / 1024).toFixed(2)} KB).

Here is the content of the file:
${fileContent}

Analyze this file and provide insights, summaries, or answer questions about it. Be thorough but concise.

For different file types, focus on:
- Text/Markdown: Summarize key points, identify main themes, and highlight important information
- PDF/Word: Extract main ideas, summarize content, and identify document structure
- CSV/Spreadsheets: Describe the data structure, identify patterns, and summarize key insights
- JSON: Explain the data structure, key fields, and relationships
- Images: Acknowledge that you can't see the image content

Format your response with clear headings and bullet points where appropriate.`
        };
        
        // Get AI response
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                systemMessage,
                ...contextMessages,
                {
                    role: 'user',
                    content: `I've uploaded a file named ${originalname}. Please analyze it and provide insights.`
                }
            ],
            max_tokens: 800
        });
        
        const aiResponse = completion.choices[0].message.content;
        
        // Add AI response
        const messageId = await addMessage(conversationId, 'assistant', aiResponse, userId);
        
        // Clean up the file after processing
        fs.unlinkSync(filePath);
        
        res.json({ 
            response: aiResponse,
            messageId: messageId,
            success: true,
            fileType: fileType
        });
    } catch (error) {
        console.error('Error processing file upload:', error);
        
        // Clean up file if it exists
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting file:', unlinkError);
            }
        }
        
        res.status(500).json({ error: 'Failed to process file upload' });
    }
});

// Create a collaborative chat
app.post('/api/collaborative-chats', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;
        const userId = req.user.userId;

        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        const conversationId = await createCollaborativeChat(title || 'New Collaborative Chat', userId);
        
        // Get the created conversation details
        const database = await db;
        const conversation = await database.get(
            'SELECT * FROM conversations WHERE id = ?',
            [conversationId]
        );

        res.json({ 
            conversationId,
            title: conversation.title,
            isCollaborative: true
        });
    } catch (error) {
        console.error('Error creating collaborative chat:', error);
        res.status(500).json({ 
            error: 'Failed to create collaborative chat',
            details: error.message 
        });
    }
});

// Add participant to collaborative chat
app.post('/api/collaborative-chats/:id/participants', authenticateToken, async (req, res) => {
    try {
        const { email } = req.body;
        const conversationId = req.params.id;
        
        // Check if the current user is a participant
        const isParticipant = await isUserParticipant(conversationId, req.user.userId);
        if (!isParticipant) {
            return res.status(403).json({ error: 'You are not a participant in this chat' });
        }

        // Get user ID from email
        const database = await db;
        const user = await database.get('SELECT id FROM users WHERE email = ?', [email]);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if user is already a participant
        const isAlreadyParticipant = await isUserParticipant(conversationId, user.id);
        if (isAlreadyParticipant) {
            return res.status(400).json({ error: 'User is already a participant' });
        }
        
        await addParticipant(conversationId, user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding participant:', error);
        res.status(500).json({ error: 'Failed to add participant' });
    }
});

// Remove participant from collaborative chat
app.delete('/api/collaborative-chats/:id/participants/:userId', authenticateToken, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const userId = req.params.userId;
        
        // Check if the current user is a participant
        const isParticipant = await isUserParticipant(conversationId, req.user.userId);
        if (!isParticipant) {
            return res.status(403).json({ error: 'You are not a participant in this chat' });
        }
        
        await removeParticipant(conversationId, userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing participant:', error);
        res.status(500).json({ error: 'Failed to remove participant' });
    }
});

// Get participants of a collaborative chat
app.get('/api/collaborative-chats/:id/participants', authenticateToken, async (req, res) => {
    try {
        const conversationId = req.params.id;
        
        // Check if the current user is a participant
        const isParticipant = await isUserParticipant(conversationId, req.user.userId);
        if (!isParticipant) {
            return res.status(403).json({ error: 'You are not a participant in this chat' });
        }
        
        const participants = await getConversationParticipants(conversationId);
        res.json(participants);
    } catch (error) {
        console.error('Error getting participants:', error);
        res.status(500).json({ error: 'Failed to get participants' });
    }
});

// Get all collaborative chats for a user
app.get('/api/collaborative-chats', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const conversations = await database.all(`
            SELECT c.*, 
                   (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
                   (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
                   (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
            FROM conversations c
            JOIN conversation_participants cp ON c.id = cp.conversation_id
            WHERE c.is_collaborative = 1 AND cp.user_id = ?
            ORDER BY c.is_favorite DESC, c.updated_at DESC
        `, [req.user.userId]);

        res.json(conversations);
    } catch (error) {
        console.error('Error fetching collaborative chats:', error);
        res.status(500).json({ error: 'Failed to fetch collaborative chats' });
    }
});

// Get a single conversation
app.get('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const conversation = await database.get(`
            SELECT * FROM conversations
            WHERE id = ? AND (
                user_id = ? OR 
                EXISTS (
                    SELECT 1 FROM conversation_participants 
                    WHERE conversation_id = ? AND user_id = ?
                )
            )
        `, [req.params.id, req.user.userId, req.params.id, req.user.userId]);
        
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found or unauthorized' });
        }
        
        res.json(conversation);
    } catch (error) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({ error: 'Failed to get conversation details' });
    }
});

// Route to handle shared chat views
app.get('/shared/:conversationId', async (req, res) => {
    try {
        const database = await db;
        const { conversationId } = req.params;

        // Get conversation details
        const conversation = await database.get(
            'SELECT * FROM conversations WHERE id = ?',
            [conversationId]
        );

        if (!conversation) {
            return res.status(404).send('Chat not found');
        }

        // Get messages for this conversation
        const messages = await database.all(
            'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [conversationId]
        );

        // Send the shared chat view
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${conversation.title} - Shared Chat</title>
                <meta property="og:title" content="${conversation.title} - Shared Chat">
                <meta property="og:description" content="View this shared AI conversation">
                <meta property="og:type" content="website">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                <style>
                    :root {
                        --bg: #f8fafc;
                        --text: #1e293b;
                        --border: #e2e8f0;
                        --user-bg: #2563eb;
                        --user-color: #ffffff;
                        --ai-bg: #f1f5f9;
                        --ai-color: #1e293b;
                        --code-bg: #1e293b;
                        --code-color: #f8fafc;
                        --user-icon: #2563eb;
                        --ai-icon: #64748b;
                        --shadow: 0 1px 3px rgba(0,0,0,0.1);
                        --radius: 0.75rem;
                        --transition: all 0.2s ease;
                    }
                    @media (prefers-color-scheme: dark) {
                        :root {
                            --bg: #0f172a;
                            --text: #f8fafc;
                            --border: #334155;
                            --user-bg: #2563eb;
                            --user-color: #ffffff;
                            --ai-bg: #1e293b;
                            --ai-color: #f8fafc;
                            --code-bg: #0f172a;
                            --code-color: #f8fafc;
                            --user-icon: #2563eb;
                            --ai-icon: #475569;
                            --shadow: 0 1px 3px rgba(0,0,0,0.2);
                        }
                    }
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        font-family: system-ui, -apple-system, sans-serif;
                    }
                    body {
                        background: var(--bg);
                        color: var(--text);
                        line-height: 1.6;
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    .container {
                        max-width: 800px;
                        margin: 0 auto;
                        width: 100%;
                        padding: 0 1rem;
                    }
                    .header {
                        background: var(--bg);
                        border-bottom: 1px solid var(--border);
                        position: sticky;
                        top: 0;
                        z-index: 10;
                        backdrop-filter: blur(8px);
                        -webkit-backdrop-filter: blur(8px);
                    }
                    .header-content {
                        padding: 1.5rem 0;
                        text-align: center;
                    }
                    h1 {
                        font-size: 1.5rem;
                        font-weight: 600;
                        margin-bottom: 0.5rem;
                        color: var(--text);
                    }
                    .meta {
                        font-size: 14px;
                        color: #64748b;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.5rem;
                    }
                    .meta i {
                        font-size: 12px;
                    }
                    .messages {
                        flex: 1;
                        padding: 1.5rem 0;
                        display: flex;
                        flex-direction: column;
                        gap: 1rem;
                    }
                    .msg {
                        display: flex;
                        gap: 1rem;
                        padding: 1rem 1.25rem;
                        border-radius: var(--radius);
                        transition: var(--transition);
                        max-width: 85%;
                        margin: 0.5rem 0;
                        position: relative;
                    }
                    .msg.user {
                        margin-left: auto;
                        background: var(--user-bg);
                        color: var(--user-color);
                    }
                    .msg.ai {
                        margin-right: auto;
                        background: var(--ai-bg);
                        color: var(--ai-color);
                    }
                    .msg:hover {
                        transform: translateY(-1px);
                        box-shadow: var(--shadow);
                    }
                    .icon {
                        width: 2.5rem;
                        height: 2.5rem;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                        color: #fff;
                        font-weight: 600;
                        box-shadow: var(--shadow);
                    }
                    .user .icon {
                        background: var(--user-icon);
                    }
                    .ai .icon {
                        background: var(--ai-icon);
                    }
                    .content {
                        flex: 1;
                        overflow-wrap: break-word;
                        font-size: 16px;
                        line-height: 1.5;
                    }
                    .msg.user .content {
                        color: var(--user-color);
                    }
                    .msg.user .content a {
                        color: var(--user-color);
                        text-decoration: underline;
                    }
                    .msg.user .content code {
                        background: rgba(255, 255, 255, 0.2);
                        color: var(--user-color);
                    }
                    .msg.user .content pre {
                        background: rgba(255, 255, 255, 0.1);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                    }
                    .msg.user .content blockquote {
                        border-left-color: rgba(255, 255, 255, 0.3);
                        color: rgba(255, 255, 255, 0.9);
                    }
                    .content img {
                        max-width: 100%;
                        height: auto;
                        border-radius: var(--radius);
                        margin: 1rem 0;
                        box-shadow: var(--shadow);
                    }
                    .content p {
                        margin-bottom: 0.5rem;
                    }
                    .content p:last-child {
                        margin-bottom: 0;
                    }
                    /* Markdown styling */
                    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
                        margin: 1rem 0 0.5rem;
                        font-weight: 600;
                        line-height: 1.3;
                    }
                    .msg.user .content h1,
                    .msg.user .content h2,
                    .msg.user .content h3,
                    .msg.user .content h4,
                    .msg.user .content h5,
                    .msg.user .content h6 {
                        color: var(--user-color);
                    }
                    .content h1 { font-size: 24px; }
                    .content h2 { font-size: 20px; }
                    .content h3 { font-size: 18px; }
                    .content h4 { font-size: 16px; }
                    .content h5 { font-size: 14px; }
                    .content h6 { font-size: 12px; }
                    .content strong, .content b {
                        font-weight: 600;
                    }
                    .content em, .content i {
                        font-style: italic;
                    }
                    .content ul, .content ol {
                        margin: 0.5rem 0;
                        padding-left: 1.5rem;
                    }
                    .content li {
                        margin: 0.25rem 0;
                    }
                    .content blockquote {
                        border-left: 4px solid var(--border);
                        margin: 0.5rem 0;
                        padding: 0.5rem 0 0.5rem 1rem;
                        color: #64748b;
                    }
                    .content hr {
                        border: none;
                        border-top: 1px solid var(--border);
                        margin: 1rem 0;
                    }
                    .content a {
                        color: var(--user-icon);
                        text-decoration: none;
                        transition: var(--transition);
                    }
                    .content a:hover {
                        text-decoration: underline;
                    }
                    .content code:not(pre code) {
                        background: var(--code-bg);
                        color: var(--code-color);
                        padding: 0.2rem 0.4rem;
                        border-radius: 0.25rem;
                        font-size: 14px;
                    }
                    pre {
                        background: var(--code-bg);
                        color: var(--code-color);
                        padding: 0.75rem;
                        border-radius: var(--radius);
                        overflow-x: auto;
                        margin: 0.5rem 0;
                        font-size: 14px;
                        box-shadow: var(--shadow);
                    }
                    code {
                        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    }
                    .timestamp {
                        font-size: 12px;
                        color: #64748b;
                        margin-top: 0.5rem;
                        opacity: 0.8;
                    }
                    .msg.user .timestamp {
                        color: rgba(255, 255, 255, 0.8);
                    }
                    .footer {
                        background: var(--bg);
                        border-top: 1px solid var(--border);
                        padding: 1.5rem 0;
                        text-align: center;
                        font-size: 0.875rem;
                        color: #64748b;
                    }
                    .footer a {
                        color: var(--user-icon);
                        text-decoration: none;
                        font-weight: 500;
                        transition: var(--transition);
                    }
                    .footer a:hover {
                        text-decoration: underline;
                        opacity: 0.8;
                    }
                    @media (max-width: 640px) {
                        .msg {
                            max-width: 90%;
                            padding: 0.75rem 1rem;
                        }
                        .container {
                            padding: 0 0.75rem;
                        }
                        h1 {
                            font-size: 20px;
                        }
                        .icon {
                            width: 2rem;
                            height: 2rem;
                        }
                        .content {
                            font-size: 14px;
                        }
                    }
                    /* Loading animation */
                    .loading {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 200px;
                    }
                    .loading::after {
                        content: '';
                        width: 2rem;
                        height: 2rem;
                        border: 3px solid var(--border);
                        border-top-color: var(--user-icon);
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="container">
                        <div class="header-content">
                            <h1>${conversation.title}</h1>
                            <div class="meta">
                                <i class="fas fa-calendar"></i>
                                <span>Shared on ${new Date().toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="container">
                    <div class="messages">
                        ${messages.map(message => {
                            // Parse message content for markdown and images
                            let content = message.content
                                // Convert headers (H1-H6)
                                .replace(/^###### (.*$)/gm, '<h6>$1</h6>')
                                .replace(/^##### (.*$)/gm, '<h5>$1</h5>')
                                .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
                                .replace(/^### (.*$)/gm, '<h3>$1</h3>')
                                .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                                .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                                // Convert bold
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                // Convert italic
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                // Convert images
                                .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy">')
                                // Convert links
                                .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
                                // Convert code blocks
                                .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
                                // Convert inline code
                                .replace(/`([^`]+)`/g, '<code>$1</code>')
                                // Convert lists
                                .replace(/^\s*[-*+]\s+(.*$)/gm, '<li>$1</li>')
                                // Convert blockquotes
                                .replace(/^\s*>\s+(.*$)/gm, '<blockquote>$1</blockquote>')
                                // Convert horizontal rules
                                .replace(/^---$/gm, '<hr>')
                                // Remove multiple consecutive line breaks
                                .replace(/\n{3,}/g, '\n\n')
                                // Convert remaining line breaks to <br>
                                .replace(/\n/g, '<br>');
                            
                            // Wrap lists in ul tags
                            content = content.replace(/<li>.*?<\/li>/gs, '<ul>$&</ul>');
                            
                            // Remove unnecessary spacing between elements
                            content = content
                                .replace(/<br><br>/g, '<br>')
                                .replace(/<\/p><br>/g, '</p>')
                                .replace(/<br><\/p>/g, '</p>')
                                .replace(/<\/h[1-6]><br>/g, '</h1>')
                                .replace(/<br><h[1-6]>/g, '<h1>')
                                .replace(/<\/ul><br>/g, '</ul>')
                                .replace(/<br><ul>/g, '<ul>')
                                .replace(/<\/ol><br>/g, '</ol>')
                                .replace(/<br><ol>/g, '<ol>')
                                .replace(/<\/blockquote><br>/g, '</blockquote>')
                                .replace(/<br><blockquote>/g, '<blockquote>')
                                .replace(/<\/pre><br>/g, '</pre>')
                                .replace(/<br><pre>/g, '<pre>');
                            
                            return `
                                <div class="msg ${message.role === 'user' ? 'user' : 'ai'}">
                                    <div class="icon">
                                        <i class="fas ${message.role === 'user' ? 'fa-user' : 'fa-robot'}"></i>
                                    </div>
                                    <div class="content">
                                        ${content}
                                        <div class="timestamp">
                                            ${new Date(message.created_at).toLocaleTimeString([], { 
                                                hour: '2-digit', 
                                                minute: '2-digit' 
                                            })}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <div class="footer">
                    <div class="container">
                        Shared from <a href="${req.protocol}://${req.get('host')}" target="_blank">AI Assistant</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error serving shared chat:', error);
        res.status(500).send('Error loading shared chat');
    }
});

// Group Chat Routes
// Create a new group
app.post('/api/groups', authenticateToken, async (req, res) => {
    try {
        const { name, description, isPrivate, joinPermission } = req.body;
        const groupId = await createGroup(name, description, req.user.userId, isPrivate, joinPermission);
        res.json({ groupId });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

// Get group members
app.get('/api/groups/:id/members', authenticateToken, async (req, res) => {
    try {
        const members = await getGroupMembers(req.params.id);
        res.json(members);
    } catch (error) {
        console.error('Error getting group members:', error);
        res.status(500).json({ error: 'Failed to get group members' });
    }
});

// Add member to group
app.post('/api/groups/:id/members', authenticateToken, async (req, res) => {
    try {
        const { userId, role } = req.body;
        await addGroupMember(req.params.id, userId, role);
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding group member:', error);
        res.status(500).json({ error: 'Failed to add group member' });
    }
});

// Remove member from group
app.delete('/api/groups/:id/members/:userId', authenticateToken, async (req, res) => {
    try {
        await removeGroupMember(req.params.id, req.params.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing group member:', error);
        res.status(500).json({ error: 'Failed to remove group member' });
    }
});

// Update member role
app.patch('/api/groups/:id/members/:userId/role', authenticateToken, async (req, res) => {
    try {
        const { role } = req.body;
        await updateGroupMemberRole(req.params.id, req.params.userId, role);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating member role:', error);
        res.status(500).json({ error: 'Failed to update member role' });
    }
});

// Create group announcement
app.post('/api/groups/:id/announcements', authenticateToken, async (req, res) => {
    try {
        const { content } = req.body;
        const announcementId = await createGroupAnnouncement(req.params.id, req.user.userId, content);
        res.json({ announcementId });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({ error: 'Failed to create announcement' });
    }
});

// Mark message as read
app.post('/api/messages/:id/read', authenticateToken, async (req, res) => {
    try {
        await markMessageAsRead(req.params.id, req.user.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking message as read:', error);
        res.status(500).json({ error: 'Failed to mark message as read' });
    }
});

// Get unread message count for a group
app.get('/api/groups/:id/unread', authenticateToken, async (req, res) => {
    try {
        const count = await getUnreadMessageCount(req.params.id, req.user.userId);
        res.json({ count });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 