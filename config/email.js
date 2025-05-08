import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create reusable transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',  // or your email service
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

export async function sendPasswordResetEmail(email, resetToken) {
    const resetLink = `${process.env.APP_URL}/reset-password.html?token=${resetToken}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset Request',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">Password Reset Request</h2>
                <p>You requested to reset your password. Click the button below to reset it:</p>
                <div style="margin: 30px 0;">
                    <a href="${resetLink}" 
                       style="background-color: #2563eb; 
                              color: white; 
                              padding: 12px 24px; 
                              text-decoration: none; 
                              border-radius: 6px;
                              display: inline-block;">
                        Reset Password
                    </a>
                </div>
                <p>If you didn't request this, you can safely ignore this email.</p>
                <p>This link will expire in 1 hour.</p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="color: #64748b; font-size: 14px;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <span style="color: #2563eb;">${resetLink}</span>
                </p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
}

export async function sendVerificationEmail(email, verificationToken) {
    const verificationLink = `${process.env.APP_URL}/verify-email.html?token=${verificationToken}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify Your Email Address',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">Verify Your Email Address</h2>
                <p>Thank you for signing up! Please click the button below to verify your email address:</p>
                <div style="margin: 30px 0;">
                    <a href="${verificationLink}" 
                       style="background-color: #2563eb; 
                              color: white; 
                              padding: 12px 24px; 
                              text-decoration: none; 
                              border-radius: 6px;
                              display: inline-block;">
                        Verify Email
                    </a>
                </div>
                <p>If you didn't create an account, you can safely ignore this email.</p>
                <p>This link will expire in 24 hours.</p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="color: #64748b; font-size: 14px;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <span style="color: #2563eb;">${verificationLink}</span>
                </p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending verification email:', error);
        return false;
    }
} 
