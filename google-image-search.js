import dotenv from 'dotenv';
dotenv.config();

/**
 * Search for images using Google Custom Search API
 * @param {string} query - Search query
 * @returns {Promise<string>} - URL of the first image result
 */
export async function googleImageSearch(query) {
    try {
        const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
        const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
        
        if (!apiKey || !searchEngineId) {
            throw new Error('Google API credentials not configured');
        }

        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&searchType=image&num=1`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items[0].link;
        }
        
        return null;
    } catch (error) {
        console.error('Error performing image search:', error);
        return null;
    }
} 