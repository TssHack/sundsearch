/**
 * SoundCloud Search API
 *
 * A simple Express API to search for tracks on SoundCloud using soundcloud-scraper.
 * Developer: Ehsan Fazeli (with optimizations)
 *
 * WARNING: This API relies on web scraping (soundcloud-scraper).
 * SoundCloud can change its website structure or implement anti-scraping measures
 * at any time, which will likely break this API without notice.
 * Use with caution and consider this dependency fragile.
 * Official SoundCloud APIs for general search are largely unavailable.
 *
 * Additionally, making many requests (especially fetching details for many tracks)
 * might lead to your server's IP being rate-limited or blocked by SoundCloud.
 */

const express = require('express');
const cors = require('cors');
const { Client } = require('soundcloud-scraper');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50; // Set a reasonable max limit to prevent abuse/performance issues

// CORS Configuration: Be specific in production!
// Example: Allow only your frontend domain
// const allowedOrigins = ['https://your-frontend-app.com', 'http://localhost:8080'];
// For development or simple cases, '*' might be okay, but less secure.
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*';

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins === '*' || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200 // For legacy browser support
};

// --- Initialization ---
const app = express();
const client = new Client(); // You might need an API key if the library supports it and anonymous access fails: new Client('YOUR_API_KEY')

app.use(cors(corsOptions)); // Use configured CORS
app.use(express.json()); // Middleware to parse JSON request bodies

// --- Routes ---

// Root route: Basic API information
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the SoundCloud Search API.',
    status: 'OK',
    developer: 'Ehsan Fazeli',
    usage: `/search?q={search_query}&limit={number_of_results_up_to_${MAX_SEARCH_LIMIT}}`,
    warning: 'This API relies on unofficial scraping and may break at any time.'
  });
});

// Search route: Performs the track search
app.get('/search', async (req, res) => {
  const query = req.query.q;
  const rawLimit = req.query.limit;

  // --- Input Validation ---
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({
      error: 'Bad Request: Missing or invalid search query. Please provide a non-empty "q" parameter.'
    });
  }

  let limit = parseInt(rawLimit, 10);
  if (isNaN(limit) || limit <= 0) {
    limit = DEFAULT_SEARCH_LIMIT;
  } else if (limit > MAX_SEARCH_LIMIT) {
    limit = MAX_SEARCH_LIMIT;
    console.log(`Requested limit (${rawLimit}) exceeded maximum (${MAX_SEARCH_LIMIT}). Clamping to max.`);
  }
  // --- End Input Validation ---

  console.log(`Processing search: query="${query}", limit=${limit}`);

  try {
    // Step 1: Perform the initial search
    // NOTE: The 'limit' parameter here tells the *scraper* how many results to TRY to fetch.
    // SoundCloud itself or limitations in the scraper might return FEWER results than requested.
    console.log(`Calling client.search with query="${query}", type='track', limit=${limit}`);
    const searchResults = await client.search(query, 'track', limit);
    console.log(`client.search returned ${searchResults.length} raw results.`);

    if (!searchResults || searchResults.length === 0) {
      return res.json({
        query: query,
        requested_limit: rawLimit,
        processed_limit: limit,
        actual_result_count: 0,
        developer: 'Ehsan Fazeli',
        results: [],
        message: 'No tracks found for this query.'
      });
    }

    // Step 2: Fetch detailed information for each track concurrently
    // NOTE: This makes N additional requests (N = number of searchResults).
    // This can be slow and might hit SoundCloud rate limits if searchResults is large.
    const detailedResultsPromises = searchResults.map(async (track) => {
      try {
        // Make sure track.url exists before trying to fetch details
        if (!track || !track.url) {
           console.warn('Search result item missing URL, skipping detail fetch:', track);
           // Return basic info available from the search result itself
           return {
             title: track?.title || 'Unknown Title (URL missing)',
             url: null,
             author: track?.author?.name || 'Unknown Artist',
             thumbnail: track?.thumbnail || null,
             duration_seconds: track?.duration ? Math.floor(track.duration / 1000) : 0,
             genre: 'Unknown',
             publishedAt: 'Unknown',
             fetchError: true,
             errorMessage: 'Missing track URL in search result'
           };
        }

        const songInfo = await client.getSongInfo(track.url);

        // Structure the result, providing defaults for missing fields
        return {
          title: songInfo.title || 'Unknown Title',
          url: songInfo.url || track.url, // Use original URL as fallback
          author: songInfo.author?.name || 'Unknown Artist',
          thumbnail: songInfo.thumbnail || null,
          duration_seconds: songInfo.duration ? Math.floor(songInfo.duration / 1000) : 0,
          genre: songInfo.genre || 'Unknown',
          publishedAt: songInfo.publishedAt || 'Unknown',
          fetchError: false
        };
      } catch (err) {
        // Log the specific error for this track but don't fail the whole request
        console.warn(`Failed to get details for track: ${track.url}. Error: ${err.message}`);
        // Return placeholder data based on the initial search result if possible
        return {
          title: track.title || 'Unknown Title (fetch failed)',
          url: track.url || null,
          author: track.author?.name || 'Unknown Artist',
          thumbnail: track.thumbnail || null,
          duration_seconds: track.duration ? Math.floor(track.duration / 1000) : 0,
          genre: 'Unknown',
          publishedAt: 'Unknown',
          fetchError: true, // Flag that fetching details failed
          errorMessage: err.message // Optionally include the error message
        };
      }
    });

    // Wait for all detail fetches to complete (or fail individually)
    const detailedResults = await Promise.all(detailedResultsPromises);

    // Final response
    res.json({
      query: query,
      requested_limit: rawLimit, // Show what the user initially asked for
      processed_limit: limit,    // Show the limit actually used after validation/clamping
      actual_result_count: detailedResults.length, // The final number of items returned
      developer: 'Ehsan Fazeli',
      results: detailedResults
    });

  } catch (error) {
    // Catch errors from the initial client.search or other unexpected issues
    console.error('FATAL ERROR during SoundCloud search processing:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred while processing the SoundCloud search.',
      // Avoid sending detailed internal error messages to the client in production
      // details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      developer: 'Ehsan Fazeli'
    });
  }
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`SoundCloud Search API server running on port ${PORT}`);
  console.log(`CORS configured for origins: ${allowedOrigins === '*' ? 'All Origins (*)' : allowedOrigins}`);
  if (allowedOrigins === '*') {
      console.warn("CORS WARNING: Allowing all origins ('*'). This is insecure for production environments. Set the ALLOWED_ORIGINS environment variable.");
  }
  console.log(`Default search limit: ${DEFAULT_SEARCH_LIMIT}, Max search limit: ${MAX_SEARCH_LIMIT}`);
});
