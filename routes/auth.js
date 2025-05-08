import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import crypto from 'crypto';
import { sendPasswordResetEmail, sendVerificationEmail } from '../config/email.js';

const router = express.Router();

// Add this at the top of the file after imports
const DEBUG = true;

function log(...args) {
    if (DEBUG) {
        console.log('[Auth Debug]', ...args);
    }
}

// Create users table if it doesn't exist
async function initUsersTable() {
    try {
        const database = await db;
        await database.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_verified BOOLEAN DEFAULT 0,
                verification_token TEXT,
                verification_expires TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add password reset tokens table
        await database.exec(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        
        console.log('Database tables ready');
    } catch (error) {
        console.error('Error creating tables:', error);
        throw error;
    }
}

// Initialize users table
initUsersTable().catch(console.error);

// Login route
router.post('/login', async (req, res) => {
    try {
        const database = await db;
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Get user from database
        const user = await database.get('SELECT * FROM users WHERE email = ?', [email]);
        
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Check if email is verified
        if (!user.is_verified) {
            return res.status(401).json({ 
                message: 'Please verify your email address before logging in' 
            });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Create token
        const token = jwt.sign(
            { userId: user.id, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            token, 
            user: { 
                id: user.id, 
                name: user.name, 
                email: user.email 
            } 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// Signup route
router.post('/signup', async (req, res) => {
    try {
        const database = await db;
        const { name, email, password } = req.body;

        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Name, email, and password are required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if user already exists
        const existingUser = await database.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Set expiration to 24 hours from now
        const verificationExpires = new Date();
        verificationExpires.setHours(verificationExpires.getHours() + 24);

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert user with verification token
        await database.run(
            `INSERT INTO users (
                name, email, password, verification_token, verification_expires
            ) VALUES (?, ?, ?, ?, datetime(?))`,
            [name, email, hashedPassword, verificationToken, verificationExpires.toISOString()]
        );

        // Send verification email
        const emailSent = await sendVerificationEmail(email, verificationToken);
        
        if (!emailSent) {
            return res.status(500).json({ 
                message: 'Failed to send verification email. Please try again.' 
            });
        }

        res.status(201).json({ 
            message: 'Account created successfully. Please check your email to verify your account.' 
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'Server error during signup' });
    }
});

// Add this helper function
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Update the forgot password route
router.post('/forgot-password', async (req, res) => {
    try {
        const database = await db;
        const { email } = req.body;

        // Validate input
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if user exists
        const user = await database.get('SELECT id, email FROM users WHERE email = ?', [email]);
        
        if (!user) {
            return res.status(404).json({ 
                message: 'No account found with this email address' 
            });
        }

        try {
            // Delete any existing reset tokens for this user
            await database.run('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
            
            // Generate new reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            
            // Set expiration to 1 hour from now
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 1);
            
            // Save reset token
            await database.run(`
                INSERT INTO password_resets (user_id, token, expires_at) 
                VALUES (?, ?, datetime(?))`,
                [user.id, resetToken, expiresAt.toISOString()]
            );

            // Send password reset email
            const emailSent = await sendPasswordResetEmail(user.email, resetToken);
            
            if (!emailSent) {
                return res.status(500).json({ 
                    message: 'Failed to send reset email. Please try again later.' 
                });
            }

            // Log for development
            if (process.env.NODE_ENV === 'development') {
                console.log('Reset token for testing:', resetToken);
                console.log('Reset link:', `${process.env.APP_URL}/reset-password.html?token=${resetToken}`);
            }

            res.json({
                message: 'Password reset instructions have been sent to your email.'
            });

        } catch (error) {
            console.error('Error in password reset process:', error);
            res.status(500).json({ 
                message: 'An error occurred while processing your request' 
            });
        }

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ 
            message: 'An error occurred while processing your request' 
        });
    }
});

// Add logging to the reset password route
router.post('/reset-password', async (req, res) => {
    log('Received reset password request');
    try {
        const database = await db;
        const { token, newPassword } = req.body;

        // Validate input
        if (!token || !newPassword) {
            return res.status(400).json({ message: 'Token and new password are required' });
        }

        // Find valid reset token
        const resetEntry = await database.get(`
            SELECT pr.user_id, pr.expires_at, u.email
            FROM password_resets pr
            JOIN users u ON u.id = pr.user_id
            WHERE pr.token = ? 
            AND datetime(pr.expires_at) > datetime('now')
        `, [token]);

        if (!resetEntry) {
            return res.status(400).json({ message: 'Invalid or expired reset token' });
        }

        console.log('Reset entry found:', resetEntry);

        try {
            // Start transaction
            await database.run('BEGIN TRANSACTION');

            // Hash new password
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, salt);

            // Update password
            await database.run(
                'UPDATE users SET password = ? WHERE id = ?',
                [hashedPassword, resetEntry.user_id]
            );

            // Delete used reset token
            await database.run('DELETE FROM password_resets WHERE token = ?', [token]);

            // Commit transaction
            await database.run('COMMIT');

            console.log('Password reset successful for user:', resetEntry.email);
            res.json({ message: 'Password has been reset successfully' });
        } catch (error) {
            await database.run('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'An error occurred while resetting your password' });
    }
});

// Add email verification route
router.get('/verify-email/:token', async (req, res) => {
    try {
        const database = await db;
        const { token } = req.params;

        // Find user with valid verification token
        const user = await database.get(`
            SELECT id 
            FROM users 
            WHERE verification_token = ? 
            AND datetime(verification_expires) > datetime('now')
            AND is_verified = 0
        `, [token]);

        if (!user) {
            return res.status(400).json({ 
                message: 'Invalid or expired verification token' 
            });
        }

        // Update user as verified
        await database.run(`
            UPDATE users 
            SET is_verified = 1, 
                verification_token = NULL, 
                verification_expires = NULL 
            WHERE id = ?
        `, [user.id]);

        res.json({ message: 'Email verified successfully. You can now log in.' });
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ 
            message: 'An error occurred while verifying your email' 
        });
    }
});

export default router; 