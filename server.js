const express = require('express');
const cors = require('cors');
const { Client } = require('soundcloud-scraper');

const app = express();
const client = new Client();

app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the SoundCloud Search API.',
    developer: 'Ehsan Fazeli',
    usage: '/search?q={query}&limit={number_of_results}'
  });
});

// Search route
app.get('/search', async (req, res) => {
  const query = req.query.q;
  const limit = parseInt(req.query.limit) || 10;

  if (!query) {
    return res.status(400).json({
      error: 'Missing search query. Please provide a "q" parameter.'
    });
  }

  try {
    const searchResults = await client.search(query, 'track', limit);

    // Now for each track, fetch detailed info
    const detailedResults = await Promise.all(
      searchResults.map(async (track) => {
        try {
          const songInfo = await client.getSongInfo(track.url);
          return {
            title: songInfo.title || 'Unknown Title',
            url: songInfo.url || null,
            author: songInfo.author?.name || 'Unknown Artist',
            thumbnail: songInfo.thumbnail || null,
            duration_seconds: songInfo.duration ? Math.floor(songInfo.duration / 1000) : 0,
            genre: songInfo.genre || 'Unknown',
            publishedAt: songInfo.publishedAt || 'Unknown'
          };
        } catch (err) {
          // اگر خطایی بود روی ترک خاص، بیخیالش میشیم و اطلاعات پایه‌ای میدیم
          return {
            title: 'Unknown Title',
            url: track.url || null,
            author: 'Unknown Artist',
            thumbnail: null,
            duration_seconds: 0,
            genre: 'Unknown',
            publishedAt: 'Unknown'
          };
        }
      })
    );

    res.json({
      query: query,
      total_results: detailedResults.length,
      developer: 'Ehsan Fazeli',
      results: detailedResults
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Internal server error while searching SoundCloud.',
      developer: 'Ehsan Fazeli'
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SoundCloud Search API server running on port ${PORT}`);
});
