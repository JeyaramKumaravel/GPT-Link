# GPT-Link: AI Assistant with Collaborative Features

GPT-Link is a full-stack AI assistant application built with Node.js, Express.js, and SQLite3. It leverages the OpenAI API for AI responses and integrates a Retrieval-Augmented Generation (RAG) system for enhanced context and real-time information. The application supports individual and collaborative chat, file uploads, user authentication, and an admin panel.

## Features

-   **User Authentication:** Secure login, registration, password reset, and email verification.
-   **Personal Chat:** Engage in one-on-one conversations with the AI assistant.
-   **Collaborative Chat:** Create and manage group chats, invite participants, and share conversations.
-   **File Upload & Analysis:** Upload various file types (PDF, DOCX, CSV, TXT, JSON, Images) for AI analysis and summarization.
-   **Retrieval-Augmented Generation (RAG):**
    -   **Web Search Integration:** Utilizes Google Custom Search API to fetch real-time information for current events and time-sensitive queries.
    -   **Database Context:** Retrieves relevant information from past conversations and key concepts stored in the SQLite database to provide personalized and consistent responses.
-   **User Preferences:** Customize theme (dark/light) and font size.
-   **Admin Panel:** Manage users, view chat logs, and monitor activity.
-   **Responsive UI:** Modern and intuitive user interface built with HTML, CSS, and JavaScript.
-   **WebSocket Support:** Real-time updates for new messages and conversation changes.

## Technologies Used

**Backend:**
-   **Node.js:** JavaScript runtime environment.
-   **Express.js:** Web application framework for Node.js.
-   **SQLite3:** Lightweight, file-based relational database.
-   **OpenAI API:** For AI model interactions (e.g., `gpt-4o-mini`).
-   **Google Custom Search API:** For web search capabilities.
-   **Nodemailer:** For sending emails (password resets, email verification).
-   **bcrypt:** For password hashing.
-   **jsonwebtoken (JWT):** For user authentication.
-   **Langchain.js:** For document loading and text splitting (PDF, DOCX, CSV, TXT, JSON).
-   **ws:** WebSocket library for real-time communication.
-   **multer:** Middleware for handling file uploads.
-   **jsdom, cheerio, axios:** For web scraping and content extraction from search results.

**Frontend:**
-   **HTML5**
-   **CSS3** (with custom properties for theming)
-   **JavaScript (ES6+)**
-   **Font Awesome:** For icons.
-   **Marked.js:** For rendering Markdown content.
-   **Highlight.js:** For syntax highlighting in code blocks.

## Setup and Installation

To set up the project locally, follow these steps:

### 1. Clone the repository

```bash
git clone <repository_url>
cd GPT-Link
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory of the project and add the following environment variables:

```env
PORT=3000
JWT_SECRET=your_jwt_secret_key_here
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_SEARCH_API_KEY=your_google_custom_search_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_google_custom_search_engine_id_here
EMAIL_USER=your_email@gmail.com # For Nodemailer (e.g., Gmail address)
EMAIL_APP_PASSWORD=your_email_app_password # Generate an App Password for Gmail
APP_URL=http://localhost:3000 # Or your deployed app URL
```

**Note on Google Custom Search API:**
-   You need to enable the Custom Search API in your Google Cloud project.
-   Create a Custom Search Engine and link it to your website or specify `searchType=image` for image search.
-   Obtain an API Key and a Search Engine ID (CX).

**Note on Email App Password:**
-   If you are using Gmail, you will need to generate an App Password instead of using your regular Gmail password, especially if you have 2-Factor Authentication enabled. You can do this in your Google Account security settings.

### 4. Database Initialization

The SQLite database (`chat.db`) will be automatically initialized and tables created on the first run of the application. A default admin user will also be created if one doesn't exist (`admin@example.com` with password `admin123`).

## Usage

### Development Mode

To run the application in development mode with `nodemon` for automatic restarts:

```bash
npm run dev
```

The server will typically run on `http://localhost:3000`.

### Production Mode

To run the application in production mode:

```bash
npm start
```

### Accessing the Application

Open your web browser and navigate to `http://localhost:3000` (or the `APP_URL` you configured).

-   **Login/Signup:** You will be redirected to the login page. Create a new account or use the default admin credentials (`admin@example.com`, `admin123`).
-   **Email Verification:** New sign-ups require email verification. Check your console in development mode for the verification link if email sending is not fully configured.
-   **Chat Interface:** Start new conversations, upload files, and interact with the AI.
-   **Settings:** Access user profile, security, and preferences from the sidebar.

## API Endpoints (Overview)

The application exposes a RESTful API. Here's a brief overview of key endpoints:

-   `POST /api/auth/signup`: Register a new user.
-   `POST /api/auth/login`: Authenticate user and get JWT token.
-   `GET /api/auth/verify-email/:token`: Verify user email.
-   `POST /api/auth/forgot-password`: Request password reset.
-   `POST /api/auth/reset-password`: Reset password with token.
-   `GET /api/user/profile`: Get user profile.
-   `PUT /api/user/profile`: Update user profile.
-   `PUT /api/user/password`: Change user password.
-   `GET /api/user/preferences`: Get user preferences.
-   `PUT /api/user/preferences`: Update user preferences.
-   `GET /api/conversations`: Get user's conversations.
-   `POST /api/conversations`: Create a new conversation.
-   `GET /api/conversations/:id/messages`: Get messages for a conversation.
-   `DELETE /api/conversations/:id`: Delete a conversation.
-   `PUT /api/conversations/:id/title`: Update conversation title.
-   `POST /api/conversations/:id/auto-name`: Auto-name a conversation based on content.
-   `PUT /api/conversations/:id/favorite`: Toggle conversation favorite status.
-   `POST /api/chat`: Send a message to the AI assistant.
-   `POST /api/messages/:id/feedback`: Provide feedback on a message.
-   `DELETE /api/messages/:id`: Delete a message.
-   `POST /api/upload`: Upload a file for AI analysis.
-   `POST /api/collaborative-chats`: Create a new collaborative chat.
-   `GET /api/collaborative-chats`: Get user's collaborative chats.
-   `POST /api/collaborative-chats/:id/participants`: Add participant to collaborative chat.
-   `DELETE /api/collaborative-chats/:id/participants/:userId`: Remove participant from collaborative chat.
-   `GET /api/collaborative-chats/:id/participants`: Get participants of a collaborative chat.
-   `GET /shared/:conversationId`: Publicly view a shared conversation.

**Admin Endpoints (requires admin role and authentication):**
-   `GET /api/admin/users`: Get all users.
-   `POST /api/admin/users`: Create a new user.
-   `PUT /api/admin/users/:id`: Update a user.
-   `DELETE /api/admin/users/:id`: Delete a user.
-   `GET /api/admin/chats`: Get all chats (for moderation).
-   `GET /api/admin/activity`: Get user activity logs.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
