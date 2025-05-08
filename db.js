import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcrypt';

// Initialize database connection
let db;

// Initialize database
async function initDB() {
    try {
        console.log('Initializing database...');
        db = await open({
            filename: './chat.db',
            driver: sqlite3.Database
        });
        console.log('Database connection established');

        // Enable foreign keys
        await db.exec('PRAGMA foreign_keys = ON');

        // Create tables...
        await createTables();
        
        return db;
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

// Create all required tables
async function createTables() {
    try {
        // Create users table first (since other tables reference it)
        console.log('Creating users table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_verified BOOLEAN DEFAULT 0,
                verification_token TEXT,
                verification_expires TIMESTAMP,
                is_admin BOOLEAN DEFAULT 0,
                last_login TIMESTAMP,
                account_status TEXT DEFAULT 'active',
                login_attempts INTEGER DEFAULT 0,
                reset_token TEXT,
                reset_token_expires TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create user preferences table
        console.log('Creating user preferences table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id INTEGER PRIMARY KEY,
                theme TEXT DEFAULT 'dark',
                font_size TEXT DEFAULT 'medium',
                language TEXT DEFAULT 'en',
                notifications_enabled BOOLEAN DEFAULT 1,
                chat_history_enabled BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create user activity log
        console.log('Creating user activity log...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                activity_type TEXT NOT NULL,
                description TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create conversations table
        console.log('Creating conversations table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT,
                context_score FLOAT DEFAULT 0.0,
                is_archived BOOLEAN DEFAULT 0,
                is_favorite BOOLEAN DEFAULT 0,
                is_collaborative INTEGER DEFAULT 0,
                last_message_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create messages table
        console.log('Creating messages table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                user_id INTEGER NOT NULL,
                role TEXT,
                content TEXT,
                feedback_score INTEGER DEFAULT 0,
                is_flagged BOOLEAN DEFAULT 0,
                flag_reason TEXT,
                context_relevance FLOAT DEFAULT 0.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create context memory table
        console.log('Creating context memory table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS context_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                key_concept TEXT,
                relevance_score FLOAT,
                usage_count INTEGER DEFAULT 1,
                last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        `);

        // Create user tags table
        console.log('Creating user tags table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                tag_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create conversation participants table
        console.log('Creating conversation participants table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS conversation_participants (
                conversation_id INTEGER,
                user_id INTEGER,
                role TEXT DEFAULT 'participant',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (conversation_id, user_id),
                FOREIGN KEY (conversation_id) REFERENCES conversations(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create groups table
        console.log('Creating groups table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                avatar_url TEXT,
                created_by INTEGER NOT NULL,
                is_private BOOLEAN DEFAULT 0,
                join_permission TEXT DEFAULT 'anyone', -- anyone, invite_only, approval_required
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        `);

        // Create group_members table
        console.log('Creating group_members table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS group_members (
                group_id INTEGER,
                user_id INTEGER,
                role TEXT DEFAULT 'member', -- admin, moderator, member
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_read_message_id INTEGER,
                is_muted BOOLEAN DEFAULT 0,
                PRIMARY KEY (group_id, user_id),
                FOREIGN KEY (group_id) REFERENCES groups(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (last_read_message_id) REFERENCES messages(id)
            )
        `);

        // Create group_announcements table
        console.log('Creating group_announcements table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS group_announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER,
                user_id INTEGER,
                content TEXT NOT NULL,
                is_pinned BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create message_read_status table
        console.log('Creating message_read_status table...');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS message_read_status (
                message_id INTEGER,
                user_id INTEGER,
                read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (message_id, user_id),
                FOREIGN KEY (message_id) REFERENCES messages(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Modify conversations table to support group chats
        try {
            // Check if group_id column exists
            const tableInfo = await db.all("PRAGMA table_info(conversations)");
            const hasGroupId = tableInfo.some(col => col.name === 'group_id');
            const hasIsGroupChat = tableInfo.some(col => col.name === 'is_group_chat');

            if (!hasGroupId) {
                await db.exec('ALTER TABLE conversations ADD COLUMN group_id INTEGER REFERENCES groups(id)');
            }
            if (!hasIsGroupChat) {
                await db.exec('ALTER TABLE conversations ADD COLUMN is_group_chat BOOLEAN DEFAULT 0');
            }
        } catch (error) {
            // Column might already exist, ignore the error
            console.log('Columns might already exist in conversations table');
        }

        // Create default admin user if none exists
        const adminExists = await db.get('SELECT id FROM users WHERE is_admin = 1');
        if (!adminExists) {
            console.log('Creating default admin user...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.run(`
                INSERT INTO users (
                    name, 
                    email, 
                    password, 
                    is_admin,
                    is_verified,
                    account_status
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, ['Admin', 'admin@example.com', hashedPassword, 1, 1, 'active']);
        }

        // Add is_collaborative column if it doesn't exist
        try {
            await db.exec('ALTER TABLE conversations ADD COLUMN is_collaborative INTEGER DEFAULT 0');
        } catch (error) {
            // Column might already exist, ignore the error
            console.log('Column is_collaborative might already exist');
        }

        // Add user_name column to messages table if it doesn't exist
        try {
            await db.exec('ALTER TABLE messages ADD COLUMN user_name TEXT');
            console.log('Added user_name column to messages table');
        } catch (error) {
            // Column might already exist, ignore the error
            console.log('Column user_name might already exist in messages table');
        }

        console.log('Database setup completed successfully');

    } catch (error) {
        console.error('Error creating/migrating tables:', error);
        throw error;
    }
}

// Helper function to check if migration is needed
async function checkIfNeedsMigration() {
    try {
        // Check if user_id column exists in conversations table
        const tableInfo = await db.all("PRAGMA table_info(conversations)");
        const hasUserIdColumn = tableInfo.some(col => col.name === 'user_id');
        return !hasUserIdColumn;
    } catch (error) {
        // If table doesn't exist, migration is needed
        return true;
    }
}

// Helper functions
function extractConcepts(content) {
    const words = content.toLowerCase().split(/\W+/);
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was', 'were']);
    return words
        .filter(word => word.length > 3 && !stopWords.has(word))
        .slice(0, 10);
}

async function calculateContextRelevance(db, conversationId, concepts) {
    const existingConcepts = await db.all(
        'SELECT key_concept, relevance_score FROM context_memory WHERE conversation_id = ?',
        conversationId
    );
    
    if (existingConcepts.length === 0) return 1.0;
    
    const conceptMap = new Map(existingConcepts.map(c => [c.key_concept, c.relevance_score]));
    const relevanceScores = concepts.map(concept => conceptMap.get(concept) || 0.5);
    
    return relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length;
}

async function updateContextMemory(db, conversationId, concepts, contextRelevance) {
    for (const concept of concepts) {
        const existing = await db.get(
            'SELECT id, usage_count, relevance_score FROM context_memory WHERE conversation_id = ? AND key_concept = ?',
            conversationId, concept
        );
        
        if (existing) {
            const newRelevance = (existing.relevance_score * existing.usage_count + contextRelevance) / (existing.usage_count + 1);
            await db.run(
                'UPDATE context_memory SET usage_count = usage_count + 1, relevance_score = ?, last_used = CURRENT_TIMESTAMP WHERE id = ?',
                newRelevance, existing.id
            );
        } else {
            await db.run(
                'INSERT INTO context_memory (conversation_id, key_concept, relevance_score) VALUES (?, ?, ?)',
                conversationId, concept, contextRelevance
            );
        }
    }
}

// Initialize DB when this module is imported
const dbPromise = initDB();

// Export the database promise
export { dbPromise as db };

// Export the new functions
export {
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
};

// Database operation functions
async function createConversation(title = 'New Chat', userId) {
    const database = await dbPromise;
    const result = await database.run(
        'INSERT INTO conversations (title, user_id) VALUES (?, ?)',
        [title, userId]
    );
    return result.lastID;
}

async function addMessage(conversationId, role, content, userId) {
    const database = await dbPromise;
    try {
        // Start a transaction
        await database.run('BEGIN TRANSACTION');
        
        // Check if conversation exists and user has access
        const conversation = await database.get(
            'SELECT id FROM conversations WHERE id = ? AND (user_id = ? OR EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?))',
            [conversationId, userId, conversationId, userId]
        );
        
        if (!conversation) {
            throw new Error(`Conversation not found or unauthorized: ${conversationId}, user: ${userId}`);
        }
        
        const concepts = extractConcepts(content);
        const contextRelevance = await calculateContextRelevance(database, conversationId, concepts);
        
        // Get user information
        const user = await database.get('SELECT name FROM users WHERE id = ?', [userId]);
        const userName = user ? user.name : 'Unknown User';
        
        // Insert the message
        const result = await database.run(
            'INSERT INTO messages (conversation_id, role, content, context_relevance, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)',
            [conversationId, role, content, contextRelevance, userId, userName]
        );
        
        // Update context memory
        await updateContextMemory(database, conversationId, concepts, contextRelevance);
        
        // Update conversation last_message_at
        await database.run(
            'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
            [conversationId]
        );
        
        // Commit the transaction
        await database.run('COMMIT');
        
        return result.lastID;
    } catch (error) {
        // Rollback in case of error
        await database.run('ROLLBACK');
        console.error('Error adding message:', error);
        throw error;
    }
}

async function getConversationMessages(conversationId, userId) {
    const database = await dbPromise;
    try {
        // Check if the conversation is collaborative
        const conversation = await database.get(
            'SELECT is_collaborative FROM conversations WHERE id = ?',
            [conversationId]
        );
        
        // If conversation doesn't exist or user doesn't have access, return empty array
        if (!conversation) {
            return [];
        }
        
        // For collaborative chats, get all messages
        if (conversation.is_collaborative === 1) {
            // Check if user is a participant
            const isParticipant = await database.get(
                'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
                [conversationId, userId]
            );
            
            // Also check if user is the owner
            const isOwner = await database.get(
                'SELECT 1 FROM conversations WHERE id = ? AND user_id = ?',
                [conversationId, userId]
            );
            
            if (!isParticipant && !isOwner) {
                return []; // User is not a participant or owner
            }
            
            // Get all messages from all participants
            return await database.all(
                'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
                [conversationId]
            );
        } 
        
        // For regular chats, only get messages from this user
        return await database.all(
            'SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC',
            [conversationId, userId]
        );
    } catch (error) {
        console.error('Error getting conversation messages:', error);
        return [];
    }
}

async function getConversations(userId) {
    const database = await dbPromise;
    try {
        const conversations = await database.all(`
            SELECT 
                c.*,
                COALESCE((
                    SELECT content 
                    FROM messages 
                    WHERE conversation_id = c.id 
                    AND (user_id = ? OR user_id IS NULL)
                    ORDER BY created_at DESC 
                    LIMIT 1
                ), NULL) as last_message,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM messages 
                    WHERE conversation_id = c.id 
                    AND (user_id = ? OR user_id IS NULL)
                ), 0) as message_count
            FROM conversations c
            WHERE c.user_id = ? OR c.user_id IS NULL
            ORDER BY c.created_at DESC
        `, [userId, userId, userId]);
        
        return conversations || [];
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return [];
    }
}

async function deleteConversation(conversationId, userId) {
    const database = await dbPromise;
    await database.run('BEGIN TRANSACTION');
    try {
        // Verify ownership before deleting
        const conversation = await database.get(
            'SELECT id, is_collaborative FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, userId]
        );
        
        if (!conversation) {
            console.error(`Conversation not found or unauthorized. ID: ${conversationId}, User: ${userId}`);
            throw new Error('Conversation not found or unauthorized');
        }

        // Check if this is a collaborative chat
        if (conversation.is_collaborative) {
            console.log(`Handling collaborative chat deletion: ${conversationId}`);
            // First remove participants
            await database.run('DELETE FROM conversation_participants WHERE conversation_id = ?', [conversationId]);
        }

        console.log(`Deleting context_memory for conversation: ${conversationId}`);
        await database.run('DELETE FROM context_memory WHERE conversation_id = ?', [conversationId]);
        
        console.log(`Deleting messages for conversation: ${conversationId}`);
        await database.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
        
        console.log(`Deleting conversation record: ${conversationId}`);
        await database.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
        
        await database.run('COMMIT');
        console.log(`Successfully deleted conversation: ${conversationId}`);
        return true;
    } catch (error) {
        await database.run('ROLLBACK');
        console.error(`Error in deleteConversation. Details: ${error.message}`, error);
        throw error;
    }
}

async function getConversationContext(conversationId) {
    const database = await dbPromise;
    const messages = await database.all(`
        SELECT content, COALESCE(context_relevance, 0.0) as context_relevance, role
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 5
    `, conversationId);
    
    const concepts = await database.all(`
        SELECT key_concept, relevance_score
        FROM context_memory
        WHERE conversation_id = ?
        ORDER BY relevance_score DESC, usage_count DESC
        LIMIT 10
    `, conversationId);
    
    return { messages, concepts };
}

async function updateMessageFeedback(messageId, score) {
    const database = await dbPromise;
    await database.run(
        'UPDATE messages SET feedback_score = ? WHERE id = ?',
        score, messageId
    );
}

// Fix the duplicate export issue
// Remove the 'export' keyword from the function declaration
async function updateConversationTitle(conversationId, title, userId) {
    try {
        console.log(`Updating title for conversation ${conversationId} to "${title}"`);
        
        const database = await dbPromise;
        
        // First check if the conversation belongs to the user
        const conversation = await database.get(
            'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, userId]
        );
        
        if (!conversation) {
            console.error(`Conversation not found or unauthorized: ${conversationId}, user: ${userId}`);
            throw new Error('Conversation not found or unauthorized');
        }
        
        await database.run(
            'UPDATE conversations SET title = ? WHERE id = ?',
            [title, conversationId]
        );
        
        console.log(`Title updated successfully for conversation ${conversationId}`);
        return true;
    } catch (error) {
        console.error('Error updating conversation title:', error);
        throw error;
    }
}

// Add functions for collaborative chat
async function createCollaborativeChat(title, creatorId) {
    const database = await dbPromise;
    try {
        // Start a transaction
        await database.run('BEGIN TRANSACTION');

        // Create the conversation
        const result = await database.run(
            'INSERT INTO conversations (title, user_id, is_collaborative) VALUES (?, ?, 1)',
            [title, creatorId]
        );
        
        const conversationId = result.lastID;

        // Add creator as participant with owner role
        await database.run(
            'INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, "owner")',
            [conversationId, creatorId]
        );

        // Commit the transaction
        await database.run('COMMIT');
        
        return conversationId;
    } catch (error) {
        // Rollback in case of error
        await database.run('ROLLBACK');
        console.error('Error creating collaborative chat:', error);
        throw error;
    }
}

async function addParticipant(conversationId, userId) {
    const database = await dbPromise;
    await database.run(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
        [conversationId, userId]
    );
}

async function removeParticipant(conversationId, userId) {
    const database = await dbPromise;
    await database.run(
        'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [conversationId, userId]
    );
}

async function getConversationParticipants(conversationId) {
    const database = await dbPromise;
    return await database.all(`
        SELECT u.id, u.name, u.email, cp.role, cp.joined_at
        FROM conversation_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.conversation_id = ?
        ORDER BY cp.joined_at ASC
    `, [conversationId]);
}

async function isUserParticipant(conversationId, userId) {
    const database = await dbPromise;
    const result = await database.get(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [conversationId, userId]
    );
    return !!result;
}

async function getCollaborativeChats(userId) {
    const database = await dbPromise;
    return await database.all(`
        SELECT c.*, u.name as creator_name
        FROM conversations c
        JOIN users u ON c.user_id = u.id
        WHERE c.is_collaborative = 1
        AND EXISTS (
            SELECT 1 FROM conversation_participants cp
            WHERE cp.conversation_id = c.id
            AND cp.user_id = ?
        )
        ORDER BY c.created_at DESC
    `, [userId]);
}

// Add new group-related functions
async function createGroup(name, description, createdBy, isPrivate = false, joinPermission = 'anyone') {
    const database = await dbPromise;
    try {
        const result = await database.run(`
            INSERT INTO groups (name, description, created_by, is_private, join_permission)
            VALUES (?, ?, ?, ?, ?)
        `, [name, description, createdBy, isPrivate, joinPermission]);

        const groupId = result.lastID;
        
        // Add creator as admin
        await database.run(`
            INSERT INTO group_members (group_id, user_id, role)
            VALUES (?, ?, ?)
        `, [groupId, createdBy, 'admin']);

        return groupId;
    } catch (error) {
        console.error('Error creating group:', error);
        throw error;
    }
}

async function addGroupMember(groupId, userId, role = 'member') {
    const database = await dbPromise;
    try {
        await database.run(`
            INSERT INTO group_members (group_id, user_id, role)
            VALUES (?, ?, ?)
        `, [groupId, userId, role]);
    } catch (error) {
        console.error('Error adding group member:', error);
        throw error;
    }
}

async function removeGroupMember(groupId, userId) {
    const database = await dbPromise;
    try {
        await database.run(`
            DELETE FROM group_members
            WHERE group_id = ? AND user_id = ?
        `, [groupId, userId]);
    } catch (error) {
        console.error('Error removing group member:', error);
        throw error;
    }
}

async function updateGroupMemberRole(groupId, userId, newRole) {
    const database = await dbPromise;
    try {
        await database.run(`
            UPDATE group_members
            SET role = ?
            WHERE group_id = ? AND user_id = ?
        `, [newRole, groupId, userId]);
    } catch (error) {
        console.error('Error updating group member role:', error);
        throw error;
    }
}

async function getGroupMembers(groupId) {
    const database = await dbPromise;
    try {
        return await database.all(`
            SELECT u.id, u.name, u.email, gm.role, gm.joined_at, gm.is_muted
            FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = ?
            ORDER BY 
                CASE gm.role
                    WHEN 'admin' THEN 1
                    WHEN 'moderator' THEN 2
                    WHEN 'member' THEN 3
                END,
                gm.joined_at ASC
        `, [groupId]);
    } catch (error) {
        console.error('Error getting group members:', error);
        throw error;
    }
}

async function createGroupAnnouncement(groupId, userId, content) {
    const database = await dbPromise;
    try {
        const result = await database.run(`
            INSERT INTO group_announcements (group_id, user_id, content)
            VALUES (?, ?, ?)
        `, [groupId, userId, content]);
        return result.lastID;
    } catch (error) {
        console.error('Error creating group announcement:', error);
        throw error;
    }
}

async function markMessageAsRead(messageId, userId) {
    const database = await dbPromise;
    try {
        await database.run(`
            INSERT OR REPLACE INTO message_read_status (message_id, user_id, read_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `, [messageId, userId]);
    } catch (error) {
        console.error('Error marking message as read:', error);
        throw error;
    }
}

async function getUnreadMessageCount(groupId, userId) {
    const database = await dbPromise;
    try {
        const result = await database.get(`
            SELECT COUNT(*) as count
            FROM messages m
            LEFT JOIN message_read_status mrs ON m.id = mrs.message_id AND mrs.user_id = ?
            WHERE m.conversation_id IN (
                SELECT id FROM conversations WHERE group_id = ?
            )
            AND mrs.message_id IS NULL
            AND m.user_id != ?
        `, [userId, groupId, userId]);
        return result.count;
    } catch (error) {
        console.error('Error getting unread message count:', error);
        throw error;
    }
} 