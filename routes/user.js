import express from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const user = await database.get(
            'SELECT id, name, email FROM users WHERE id = ?',
            [req.user.userId]
        );
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Name is required' });
        }

        await database.run(
            'UPDATE users SET name = ? WHERE id = ?',
            [name, req.user.userId]
        );

        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update password
router.put('/password', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const { currentPassword, newPassword } = req.body;

        // Get user with password
        const user = await database.get(
            'SELECT password FROM users WHERE id = ?',
            [req.user.userId]
        );

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        await database.run(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, req.user.userId]
        );

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Add this route to handle preferences
router.put('/preferences', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const { theme, fontSize } = req.body;

        // Validate input
        const validThemes = ['dark', 'light'];
        const validFontSizes = ['small', 'medium', 'large'];

        if (!validThemes.includes(theme) || !validFontSizes.includes(fontSize)) {
            return res.status(400).json({ message: 'Invalid theme or font size' });
        }

        // Update or insert preferences
        await database.run(`
            INSERT INTO user_preferences (user_id, theme, font_size)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
            theme = excluded.theme,
            font_size = excluded.font_size,
            updated_at = CURRENT_TIMESTAMP
        `, [req.user.userId, theme, fontSize]);

        res.json({ message: 'Preferences updated successfully' });
    } catch (error) {
        console.error('Error updating preferences:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Add this route to get preferences
router.get('/preferences', authenticateToken, async (req, res) => {
    try {
        const database = await db;
        const prefs = await database.get(
            'SELECT theme, font_size FROM user_preferences WHERE user_id = ?',
            [req.user.userId]
        );

        res.json(prefs || { theme: 'dark', font_size: 'medium' });
    } catch (error) {
        console.error('Error fetching preferences:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router; 