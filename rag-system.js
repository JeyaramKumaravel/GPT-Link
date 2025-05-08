import { googleSearch, formatSearchResults } from './google-search.js';
import { db } from './db.js';

/**
 * RAG (Retrieval-Augmented Generation) system
 * Combines database knowledge with web search results
 */
export async function retrieveRelevantContext(query, userId, conversationId) {
    console.log(`RAG: Retrieving context for query: "${query}"`);
    
    // Step 1: Determine if the query needs real-time information
    const needsRecentInfo = /current|when|latest|recent|today|now|yesterday|this week|this month|news|weather|stock|price|update|trend|forecast|prediction|market|election|event|covid|pandemic|2025|happening|live|breaking/i.test(query);
    
    // Step 2: Retrieve information from multiple sources
    const [webResults, dbResults] = await Promise.all([
        // Only perform web search if needed
        needsRecentInfo ? getWebSearchResults(query) : Promise.resolve(""),
        // Always retrieve from database
        getDatabaseContext(query, userId, conversationId)
    ]);
    
    // Step 3: Combine the results
    const combinedContext = formatRagContext(webResults, dbResults, needsRecentInfo);
    
    return {
        context: combinedContext,
        hasWebResults: !!webResults
    };
}

/**
 * Get web search results for a query
 */
async function getWebSearchResults(query) {
    try {
        console.log(`RAG: Performing web search for: "${query}"`);
        const results = await googleSearch(query, 4); // Get 4 results for better coverage
        return formatSearchResults(results);
    } catch (error) {
        console.error('RAG: Error getting web search results:', error);
        return "";
    }
}

/**
 * Get relevant context from the database
 */
async function getDatabaseContext(query, userId, conversationId) {
    try {
        console.log(`RAG: Retrieving database context for: "${query}"`);
        const database = await db;
        
        // 1. Get similar messages from user's past conversations
        const similarMessages = await database.all(`
            SELECT 
                m.content, 
                c.title as conversation_title,
                m.created_at
            FROM 
                messages m
            JOIN 
                conversations c ON m.conversation_id = c.id
            WHERE 
                m.user_id = ? 
                AND m.role = 'assistant'
                AND m.conversation_id != ?
                AND m.content LIKE ?
            ORDER BY 
                m.created_at DESC
            LIMIT 3
        `, [userId, conversationId || 0, `%${getKeywords(query).join('%')}%`]);
        
        // 2. Get key concepts from current conversation
        const concepts = await database.all(`
            SELECT 
                key_concept, 
                relevance_score
            FROM 
                context_memory
            WHERE 
                conversation_id = ?
            ORDER BY 
                relevance_score DESC
            LIMIT 5
        `, [conversationId || 0]);
        
        // Format the results
        let dbContext = "";
        
        if (similarMessages.length > 0) {
            dbContext += "Related information from your previous conversations:\n\n";
            similarMessages.forEach((msg, i) => {
                const date = new Date(msg.created_at).toLocaleDateString();
                dbContext += `[${i+1}] From "${msg.conversation_title}" (${date}):\n${truncateText(msg.content, 300)}\n\n`;
            });
        }
        
        if (concepts.length > 0) {
            dbContext += "Key concepts from this conversation:\n";
            concepts.forEach(c => {
                dbContext += `- ${c.key_concept} (relevance: ${c.relevance_score.toFixed(2)})\n`;
            });
        }
        
        return dbContext;
    } catch (error) {
        console.error('RAG: Error getting database context:', error);
        return "";
    }
}

/**
 * Format the combined RAG context
 */
function formatRagContext(webResults, dbResults, needsRecentInfo) {
    let context = "";
    
    // Add web results first if they exist
    if (webResults) {
        context += "Recent web search results:\n" + webResults + "\n\n";
        
        if (needsRecentInfo) {
            context += `IMPORTANT INSTRUCTIONS FOR USING SEARCH RESULTS:
1. For questions about current events, news, or time-sensitive information, ALWAYS use the web search results above.
2. Synthesize information from ALL search results to provide a comprehensive answer.
3. Include specific details, facts, figures, and dates from the search results.
4. Cite sources by mentioning the source name or URL when providing specific information.
5. If search results contain conflicting information, acknowledge this and present multiple perspectives.
6. If the search results don't fully answer the question, clearly state what information is missing.
7. NEVER say your knowledge is limited or outdated when search results are available.
8. NEVER make up information - if the search results don't contain certain details, acknowledge this gap.\n\n`;
        }
    }
    
    // Add database results if they exist
    if (dbResults) {
        context += dbResults;
    }
    
    return context;
}

/**
 * Extract keywords from a query
 */
function getKeywords(query) {
    const words = query.toLowerCase().split(/\W+/);
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was', 'were', 'what', 'when', 'where', 'why', 'how']);
    
    return words
        .filter(word => word.length > 3 && !stopWords.has(word))
        .slice(0, 5);
}

/**
 * Truncate text to a specified length
 */
function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
} 