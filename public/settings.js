document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    const menuItems = document.querySelectorAll('.settings-menu li');
    const sections = document.querySelectorAll('.settings-section');
    const profileForm = document.getElementById('profileForm');
    const passwordForm = document.getElementById('passwordForm');
    const preferencesForm = document.getElementById('preferencesForm');

    // Load user data
    loadUserData();
    
    // Load user preferences
    loadUserPreferences();

    // Handle menu switching
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetSection = item.dataset.section;
            
            // Update active states
            menuItems.forEach(i => i.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            item.classList.add('active');
            document.getElementById(targetSection).classList.add('active');
        });
    });

    // Handle profile update
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('name').value;

        try {
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name })
            });

            const data = await response.json();

            if (response.ok) {
                showNotification('Profile updated successfully', 'success');
            } else {
                showNotification(data.message || 'Failed to update profile', 'error');
            }
        } catch (error) {
            showNotification('An error occurred', 'error');
        }
    });

    // Handle password change
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (newPassword !== confirmPassword) {
            showNotification('New passwords do not match', 'error');
            return;
        }

        try {
            const response = await fetch('/api/user/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await response.json();

            if (response.ok) {
                showNotification('Password updated successfully', 'success');
                passwordForm.reset();
            } else {
                showNotification(data.message || 'Failed to update password', 'error');
            }
        } catch (error) {
            showNotification('An error occurred', 'error');
        }
    });

    // Handle preferences update
    preferencesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const theme = document.querySelector('input[name="theme"]:checked').value;
        const fontSize = document.getElementById('fontSize').value;

        try {
            const response = await fetch('/api/user/preferences', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ theme, fontSize })
            });

            const data = await response.json();

            if (response.ok) {
                showNotification('Preferences updated successfully', 'success');
                // Save preferences to localStorage for immediate use
                localStorage.setItem('userPreferences', JSON.stringify({ theme, fontSize }));
                applyPreferences({ theme, fontSize });
            } else {
                showNotification(data.message || 'Failed to update preferences', 'error');
            }
        } catch (error) {
            showNotification('An error occurred', 'error');
        }
    });

    async function loadUserData() {
        try {
            const response = await fetch('/api/user/profile', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (response.ok) {
                document.getElementById('name').value = data.name;
                document.getElementById('email').value = data.email;
            }
        } catch (error) {
            showNotification('Failed to load user data', 'error');
        }
    }

    async function loadUserPreferences() {
        try {
            const response = await fetch('/api/user/preferences', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (response.ok) {
                // Set form values
                document.querySelector(`input[name="theme"][value="${data.theme}"]`).checked = true;
                document.getElementById('fontSize').value = data.font_size || 'medium';
                
                // Apply preferences
                applyPreferences({ 
                    theme: data.theme, 
                    fontSize: data.font_size || 'medium' 
                });
                
                // Save to localStorage for use across pages
                localStorage.setItem('userPreferences', JSON.stringify({
                    theme: data.theme,
                    fontSize: data.font_size || 'medium'
                }));
            }
        } catch (error) {
            console.error('Failed to load preferences:', error);
        }
    }

    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
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

    // Add this at the end of the DOMContentLoaded event handler
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('authToken');
        window.location.href = '/login.html';
    });
}); 