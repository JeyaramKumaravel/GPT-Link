import express from 'express';
import { db } from '../db.js';
import bcrypt from 'bcrypt';
import { authenticateToken } from '../middleware/auth.js';
import { sendVerificationEmail } from '../config/email.js';

const router = express.Router();

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
    try {
        const database = await db;
        const user = await database.get(
            'SELECT is_admin FROM users WHERE id = ?',
            [req.user.userId]
        );

        if (!user?.is_admin) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        next();
    } catch (error) {
        console.error('Admin check error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Apply admin check to all routes
router.use(authenticateToken, isAdmin);

// Get all users
router.get('/users', async (req, res) => {
    try {
        const database = await db;
        const { search } = req.query;
        
        let query = `
            SELECT id, name, email, is_verified, account_status, created_at
            FROM users
            WHERE id != ?
        `;
        let params = [req.user.userId];

        if (search) {
            query += ' AND (name LIKE ? OR email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY created_at DESC';
        const users = await database.all(query, params);
        
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
});

// Get single user
router.get('/users/:id', async (req, res) => {
    try {
        const database = await db;
        const user = await database.get(
            'SELECT id, name, email, is_verified, account_status FROM users WHERE id = ?',
            [req.params.id]
        );
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Failed to fetch user' });
    }
});

// Create new user
router.post('/users', async (req, res) => {
    try {
        const database = await db;
        const { name, email, password, is_verified, account_status } = req.body;

        // Generate verification token if not verified
        const verificationToken = !is_verified ? crypto.randomBytes(32).toString('hex') : null;
        const verificationExpires = !is_verified ? new Date(Date.now() + 24*60*60*1000) : null;

        // Hash password
        const hashedPassword = await bcrypt.hash(password || 'temppass123', 10);

        const result = await database.run(`
            INSERT INTO users (
                name, email, password, is_verified, account_status,
                verification_token, verification_expires
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            name, email, hashedPassword, is_verified ? 1 : 0, 
            account_status || 'active', verificationToken,
            verificationExpires?.toISOString()
        ]);

        if (!is_verified && verificationToken) {
            await sendVerificationEmail(email, verificationToken);
        }

        res.status(201).json({ 
            message: 'User created successfully',
            userId: result.lastID
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'Failed to create user' });
    }
});

// Update user
router.put('/users/:id', async (req, res) => {
    try {
        const database = await db;
        const { name, email, account_status, is_verified } = req.body;

        await database.run(`
            UPDATE users 
            SET name = ?, email = ?, account_status = ?, is_verified = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [name, email, account_status, is_verified ? 1 : 0, req.params.id]);

        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Failed to update user' });
    }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
    try {
        const database = await db;
        await database.run('BEGIN TRANSACTION');

        try {
            // Delete user's data in order due to foreign key constraints
            await database.run('DELETE FROM user_preferences WHERE user_id = ?', [req.params.id]);
            await database.run('DELETE FROM user_activity_log WHERE user_id = ?', [req.params.id]);
            await database.run('DELETE FROM messages WHERE user_id = ?', [req.params.id]);
            await database.run('DELETE FROM conversations WHERE user_id = ?', [req.params.id]);
            await database.run('DELETE FROM users WHERE id = ?', [req.params.id]);

            await database.run('COMMIT');
            res.json({ message: 'User deleted successfully' });
        } catch (error) {
            await database.run('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'Failed to delete user' });
    }
});

// Get chats
router.get('/chats', async (req, res) => {
    try {
        const database = await db;
        const { search, filter } = req.query;

        let query = `
            SELECT 
                c.id, c.title, c.is_archived, c.last_message_at,
                u.name as user_name,
                COUNT(m.id) as message_count,
                MAX(CASE WHEN m.is_flagged = 1 THEN 1 ELSE 0 END) as is_flagged
            FROM conversations c
            JOIN users u ON c.user_id = u.id
            LEFT JOIN messages m ON c.id = m.conversation_id
            WHERE 1=1
        `;
        let params = [];

        if (search) {
            query += ' AND (c.title LIKE ? OR u.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        if (filter === 'flagged') {
            query += ' AND m.is_flagged = 1';
        } else if (filter === 'archived') {
            query += ' AND c.is_archived = 1';
        }

        query += ' GROUP BY c.id ORDER BY c.last_message_at DESC';

        const chats = await database.all(query, params);
        res.json(chats);
    } catch (error) {
        console.error('Error fetching chats:', error);
        res.status(500).json({ message: 'Failed to fetch chats' });
    }
});

// Get activity log
router.get('/activity', async (req, res) => {
    try {
        const database = await db;
        const { search, date } = req.query;

        let query = `
            SELECT 
                a.*, u.name as user_name
            FROM user_activity_log a
            JOIN users u ON a.user_id = u.id
            WHERE 1=1
        `;
        let params = [];

        if (search) {
            query += ' AND (a.activity_type LIKE ? OR a.description LIKE ? OR u.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (date) {
            query += ' AND DATE(a.created_at) = DATE(?)';
            params.push(date);
        }

        query += ' ORDER BY a.created_at DESC LIMIT 100';

        const activities = await database.all(query, params);
        res.json(activities);
    } catch (error) {
        console.error('Error fetching activity log:', error);
        res.status(500).json({ message: 'Failed to fetch activity log' });
    }
});

export default router; 