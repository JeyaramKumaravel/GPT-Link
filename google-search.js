import { google } from 'googleapis';
import dotenv from 'dotenv';
import axios from 'axios';
import { JSDOM } from 'jsdom';

dotenv.config();

const customsearch = google.customsearch('v1');

/**
 * Performs a Google search and returns the results
 * @param {string} query - The search query
 * @param {number} num - Number of results to return (max 10)
 * @returns {Promise<Array>} - Array of search results
 */
export async function googleSearch(query, num = 5) {
  try {
    // Enhance the query for better results
    const enhancedQuery = enhanceSearchQuery(query);
    console.log(`Enhanced search query: ${enhancedQuery}`);
    
    const response = await customsearch.cse.list({
      q: enhancedQuery,
      cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
      key: process.env.GOOGLE_SEARCH_API_KEY,
      num: num,
      dateRestrict: 'y1', // Restrict to results from the past year for recency
      sort: 'date', // Sort by date for most recent results first
    });

    if (response.data.items && response.data.items.length > 0) {
      // Process and enhance search results
      const enhancedResults = await Promise.all(
        response.data.items.map(async (item, index) => {
          // Basic result info
          const result = {
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            date: item.pagemap?.metatags?.[0]?.['article:published_time'] || 
                  item.pagemap?.metatags?.[0]?.['og:updated_time'] || null,
            source: item.displayLink || new URL(item.link).hostname
          };
          
          // For the top 2 results, try to fetch more detailed content
          if (index < 2) {
            try {
              const additionalContent = await fetchAdditionalContent(item.link);
              if (additionalContent) {
                result.additionalContent = additionalContent;
              }
            } catch (err) {
              console.log(`Could not fetch additional content for ${item.link}: ${err.message}`);
            }
          }
          
          return result;
        })
      );
      
      return enhancedResults;
    }
    
    return [];
  } catch (error) {
    console.error('Error performing Google search:', error);
    return [];
  }
}

/**
 * Enhances the search query for better results
 * @param {string} query - The original search query
 * @returns {string} - Enhanced search query
 */
function enhanceSearchQuery(query) {
  // Remove question words and add context terms
  let enhancedQuery = query
    .replace(/^(what|who|when|where|why|how|is|are|was|were|do|does|did|can|could|will|would|should|has|have)\s+/i, '')
    .replace(/\?$/, '');
  
  // Add time context for queries that seem to need current information
  if (/current|latest|recent|today|now|update|news/i.test(query)) {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = currentDate.toLocaleString('en-US', { month: 'long' });
    
    enhancedQuery += ` ${month} ${year} latest information`;
  }
  
  // Add India context for location-specific queries
  if (/weather|event|festival|holiday|government|policy|law|regulation/i.test(query)) {
    if (!/india|indian/i.test(enhancedQuery)) {
      enhancedQuery += ' India';
    }
  }
  
  return enhancedQuery;
}

/**
 * Fetches additional content from a webpage
 * @param {string} url - The URL to fetch content from
 * @returns {Promise<string>} - Extracted content
 */
async function fetchAdditionalContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    
    // Try to find the main content
    const contentSelectors = [
      'article', 
      '.article-content', 
      '.post-content', 
      '.entry-content', 
      'main',
      '#content',
      '.content'
    ];
    
    let contentElement = null;
    
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        contentElement = element;
        break;
      }
    }
    
    if (!contentElement) {
      // Fallback to body if no content element found
      contentElement = document.body;
    }
    
    // Extract paragraphs
    const paragraphs = Array.from(contentElement.querySelectorAll('p'))
      .map(p => p.textContent.trim())
      .filter(text => text.length > 100) // Only substantial paragraphs
      .slice(0, 3); // Take up to 3 paragraphs
    
    return paragraphs.join('\n\n');
  } catch (error) {
    console.error(`Error fetching additional content from ${url}:`, error.message);
    return null;
  }
}

/**
 * Formats search results into a readable string for the AI
 * @param {Array} results - Search results from googleSearch
 * @returns {string} - Formatted search results
 */
export function formatSearchResults(results) {
  if (!results || results.length === 0) {
    return "No search results found.";
  }
  
  return results.map((result, index) => {
    const date = result.date ? `(${new Date(result.date).toLocaleDateString()})` : '';
    const source = result.source ? `Source: ${result.source}` : '';
    
    let formattedResult = `[${index + 1}] ${result.title} ${date}\n${source}\nURL: ${result.link}\n${result.snippet}\n`;
    
    if (result.additionalContent) {
      formattedResult += `\nAdditional content:\n${result.additionalContent}\n`;
    }
    
    return formattedResult;
  }).join('\n---\n\n');
} 