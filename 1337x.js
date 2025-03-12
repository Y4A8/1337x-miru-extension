// ==MiruExtension==
// @name 1337x Extension
// @version v0.1.0
// @author Zomey
// @webSite https://1337x.to
// @package com.miru.1337x
// @type video
// ==/MiruExtension==

export default class extends Extension {
  constructor() {
    super();
    this.baseUrl = 'https://1337x.to';
    this.rateLimitDelay = 1000; // 1 second between requests
    this.maxRetries = 3;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async makeRequest(url, retries = this.maxRetries) {
    const cacheKey = `${url}-${Date.now()}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }

    for (let i = 0; i < retries; i++) {
      try {
        const response = await this.request({
          url: this.baseUrl + url,
          method: "GET",
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: 10000 // 10 second timeout
        });

        // Validate response
        if (!response || typeof response !== 'string') {
          throw new Error('Invalid response received');
        }

        // Check for error pages or blocked access
        if (response.includes('Access Denied') || response.includes('CloudFlare')) {
          throw new Error('Access blocked by 1337x. Please try again later.');
        }

        this.cache.set(cacheKey, {
          data: response,
          timestamp: Date.now()
        });

        await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
        return response;
      } catch (error) {
        const isLastAttempt = i === retries - 1;
        const waitTime = Math.min(1000 * Math.pow(2, i), 10000);

        console.error(`Request failed (${i + 1}/${retries}):`, {
          url,
          error: error.message,
          waitTime,
          isLastAttempt
        });

        if (isLastAttempt) {
          throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // Fetch latest torrents
  async latest(page = 1) {
    try {
      const response = await this.makeRequest(`/home/${page}/`);
      
      const $ = cheerio.load(response);
      const items = [];
      
      $('tbody tr').each((index, element) => {
        const nameElement = $(element).find('.coll-1.name a:nth-child(2)');
        const title = nameElement.text().trim();
        const url = nameElement.attr('href');
        const seeds = $(element).find('.coll-2.seeds').text();
        const size = $(element).find('.coll-4.size').text();
        
        // Use a default cover image
        const cover = "https://i.imgur.com/GaAESkC.png";
        
        items.push({
          title: `${title} [Seeds: ${seeds} | Size: ${size}]`,
          url: url,
          cover: cover
        });
      });
      
      return items;
    } catch (error) {
      console.error('Error fetching latest torrents:', error);
      return [];
    }
  }

  // Enhanced search with filtering and sorting
  async search(keyword, page = 1, filters = {}) {
    try {
      let url = '';
      const category = filters.category?.toLowerCase();
      
      // Enhanced category handling
      if (category && category !== 'all') {
        url = `/category-search/${encodeURIComponent(keyword)}/${category}/${page}/`;
      } else {
        url = `/search/${encodeURIComponent(keyword)}/${page}/`;
      }
      
      // Enhanced sort parameters
      if (filters.sort) {
        const validSort = ['time', 'size', 'seeders', 'leechers'].includes(filters.sort);
        const validOrder = ['asc', 'desc'].includes(filters.order);
        
        if (validSort) {
          url += `?sort=${filters.sort}`;
          if (validOrder) {
            url += `&order=${filters.order}`;
          }
        }
      }

      const response = await this.makeRequest(url);
      const $ = cheerio.load(response);
      const items = [];
      
      // Extract pagination info with error handling
      let totalPages = 1;
      try {
        totalPages = Math.max(
          1,
          ...$('.pagination a')
            .map((_, el) => parseInt($(el).text()) || 0)
            .get()
            .filter(num => !isNaN(num))
        );
      } catch (e) {
        console.warn('Pagination extraction failed:', e);
      }

      // Enhanced torrent item extraction
      $('tbody tr').each((_, element) => {
        try {
          const nameElement = $(element).find('.coll-1.name a:nth-child(2)');
          const title = nameElement.text().trim();
          const url = nameElement.attr('href');
          const seeds = $(element).find('.coll-2.seeds').text().trim();
          const leechers = $(element).find('.coll-3.leechers').text().trim();
          const size = $(element).find('.coll-4.size').text().trim();
          const uploader = $(element).find('.coll-5.uploader').text().trim();
          
          items.push({
            title: `${title} [Seeds: ${seeds} | Leechers: ${leechers} | Size: ${size}]`,
            url: url,
            cover: "https://i.imgur.com/GaAESkC.png",
            extraInfo: {
              seeds: parseInt(seeds) || 0,
              leechers: parseInt(leechers) || 0,
              size: size,
              uploader: uploader
            }
          });
        } catch (e) {
          console.warn('Failed to parse torrent item:', e);
        }
      });
      
      return {
        items,
        hasNextPage: page < totalPages,
        currentPage: page,
        totalPages,
        // Add filter UI configuration
        filters: {
          sort: {
            options: await this.getSortOptions(),
            current: filters.sort || 'seeders'
          },
          category: {
            options: await this.getCategories(),
            current: filters.category || 'all'
          }
        }
      };
    } catch (error) {
      console.error('Search error:', error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  // Enhanced detail method
  async detail(url) {
    try {
      const response = await this.makeRequest(url);
      const $ = cheerio.load(response);
      
      // Validate page content
      if ($('.box-info-heading').length === 0 && $('.torrent-title').length === 0) {
        throw new Error('Invalid torrent page structure');
      }

      // More robust selectors
      const title = $('.box-info-heading h1, .torrent-title h1').first().text().trim();
      const cover = $('img.torrent-image, .torrent-image img').first().attr('src') || 
                   "https://i.imgur.com/GaAESkC.png";
      const description = $('.description').text().trim();
      
      // Enhanced metadata extraction
      const metadata = [];
      const infoMap = {
        'Category': ['.category-link', '.box-info-cat a'],
        'Type': ['.category-link + span', '.box-info-type'],
        'Language': ['.language-link', '.box-info-lang'],
        'Size': ['.size', '.box-info-size'],
        'Uploaded': ['.date', '.box-info-date'],
        'Downloads': ['.downloads', '.box-info-downloads'],
        'Seeds': ['.seeds', '.box-info-seeds'],
        'Leechers': ['.leechers', '.box-info-leechers']
      };

      Object.entries(infoMap).forEach(([key, selectors]) => {
        for (const selector of selectors) {
          const value = $(selector).first().text().trim();
          if (value) {
            metadata.push({ title: key, value });
            break;
          }
        }
      });
      
      // Enhanced magnet link extraction
      const magnetSelectors = [
        '.dropdown-menu li a[href^="magnet:"]',
        'a[href^="magnet:"]',
        '[title="Magnet Link"]'
      ];

      const magnetLink = magnetSelectors
        .map(selector => $(selector).attr('href'))
        .find(link => link && link.startsWith('magnet:'));
      
      const episodes = magnetLink ? [{
        title: "Download Torrent",
        url: magnetLink,
        type: "magnet"
      }] : [];
      
      return {
        title,
        cover,
        desc: description,
        metadata,
        episodes,
        // Add extra info for UI
        ui: {
          infoLayout: 'grid',
          actions: ['download', 'share'],
          shareText: `Check out "${title}" on 1337x`
        }
      };
    } catch (error) {
      console.error('Detail error:', error);
      throw new Error(`Failed to fetch torrent details: ${error.message}`);
    }
  }

  // Enhanced watch method with clipboard support and better UI feedback
  async watch(url) {
    try {
      if (url.startsWith('magnet:')) {
        return {
          type: 'torrent',
          url: url,
          headers: {
            'Content-Type': 'application/x-bittorrent',
            'X-Miru-Handler': 'magnet'
          },
          ui: {
            title: 'Download Options',
            message: 'Choose how you want to handle this torrent:',
            buttons: [
              {
                text: 'Copy Magnet Link',
                action: async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    this.notify('Success', 'Magnet link copied to clipboard!', 'success');
                  } catch (error) {
                    console.error('Failed to copy magnet link:', error);
                    this.notify('Error', 'Failed to copy magnet link. Please try again.', 'error');
                  }
                },
                style: 'primary'
              },
              {
                text: 'Open in Torrent Client',
                action: () => {
                  window.open(url, '_blank');
                },
                style: 'secondary'
              }
            ],
            instructions: [
              '🔍 Option 1: Copy Magnet Link',
              '1. Click "Copy Magnet Link" to copy to clipboard',
              '2. Open your preferred torrent client',
              '3. Use "Add Torrent from URL/Magnet"',
              '4. Paste the magnet link',
              '',
              '🚀 Option 2: Direct Open',
              '1. Click "Open in Torrent Client"',
              '2. Allow your browser to open your default torrent client'
            ]
          }
        };
      }
      return null;
    } catch (error) {
      console.error('Watch handler error:', error);
      this.notify('Error', 'Failed to process magnet link', 'error');
      return {
        error: true,
        message: 'Failed to process magnet link. Please try again.',
        details: error.message
      };
    }
  }

  // Add utility method for notifications
  notify(title, message, type = 'info', duration = 3000) {
    // Check if Miru's notification system is available
    if (typeof this.notification === 'function') {
      this.notification({
        title,
        message,
        type,
        duration
      });
    } else {
      // Fallback to console
      console.log(`${type.toUpperCase()}: ${title} - ${message}`);
    }
  }

  // Enhanced checkUpdate method
  async checkUpdate(url) {
    try {
      const response = await this.makeRequest(url);
      const $ = cheerio.load(response);
      const lastUpdate = $('.last-update').text().trim();
      return lastUpdate || "No updates available";
    } catch (error) {
      console.error('Update check error:', error);
      return "Update check failed";
    }
  }

  // Added category browsing functionality
  async category(categoryName, page = 1) {
    try {
      const categoryMap = {
        'movies': 'Movies',
        'tv': 'TV',
        'games': 'Games',
        'music': 'Music',
        'apps': 'Apps',
        'documentaries': 'Documentaries',
        'anime': 'Anime',
        'other': 'Other',
        'xxx': 'XXX'
      };
      
      const category = categoryMap[categoryName.toLowerCase()] || categoryName;
      const response = await this.makeRequest(`/category-${category}/${page}/`);
      
      const $ = cheerio.load(response);
      const items = [];
      
      $('tbody tr').each((index, element) => {
        const nameElement = $(element).find('.coll-1.name a:nth-child(2)');
        const title = nameElement.text().trim();
        const url = nameElement.attr('href');
        const seeds = $(element).find('.coll-2.seeds').text();
        const size = $(element).find('.coll-4.size').text();
        
        items.push({
          title: `${title} [Seeds: ${seeds} | Size: ${size}]`,
          url: url,
          cover: "https://i.imgur.com/GaAESkC.png"
        });
      });
      
      return items;
    } catch (error) {
      console.error(`Category browsing error for ${categoryName}:`, error);
      return [];
    }
  }

  // Added method to get trending torrents
  async trending(page = 1, category = '') {
    try {
      let url = `/trending${category ? '/' + category : ''}/${page}/`;
      const response = await this.makeRequest(url);
      
      const $ = cheerio.load(response);
      const items = [];
      
      $('tbody tr').each((index, element) => {
        const nameElement = $(element).find('.coll-1.name a:nth-child(2)');
        const title = nameElement.text().trim();
        const url = nameElement.attr('href');
        const seeds = $(element).find('.coll-2.seeds').text();
        const size = $(element).find('.coll-4.size').text();
        
        items.push({
          title: `${title} [Seeds: ${seeds} | Size: ${size}]`,
          url: url,
          cover: "https://i.imgur.com/GaAESkC.png"
        });
      });
      
      return items;
    } catch (error) {
      console.error('Error fetching trending torrents:', error);
      return [];
    }
  }

  // Added method to get top torrents
  async top(category = 'all', page = 1) {
    try {
      const categoryMap = {
        'all': '',
        'movies': 'movies',
        'television': 'television', 
        'games': 'games',
        'music': 'music',
        'applications': 'applications',
        'documentaries': 'documentaries',
        'anime': 'anime',
        'other': 'other',
        'xxx': 'xxx'
      };
      
      const categoryPath = categoryMap[category.toLowerCase()] || '';
      let url = `/top-100${categoryPath ? '-' + categoryPath : ''}`;
      url += page > 1 ? `/${page}/` : '/';
      
      const response = await this.makeRequest(url);
      const $ = cheerio.load(response);
      const items = [];
      
      $('tbody tr').each((index, element) => {
        const nameElement = $(element).find('.coll-1.name a:nth-child(2)');
        const title = nameElement.text().trim();
        const url = nameElement.attr('href');
        const seeds = $(element).find('.coll-2.seeds').text();
        const size = $(element).find('.coll-4.size').text();
        
        items.push({
          title: `${title} [Seeds: ${seeds} | Size: ${size}]`,
          url: url,
          cover: "https://i.imgur.com/GaAESkC.png"
        });
      });
      
      return items;
    } catch (error) {
      console.error(`Error fetching top torrents for ${category}:`, error);
      return [];
    }
  }

  // Get available categories for the filter UI
  async getCategories() {
    return [
      { name: "All", id: "all" },
      { name: "Movies", id: "movies" },
      { name: "TV", id: "tv" },
      { name: "Games", id: "games" },
      { name: "Music", id: "music" },
      { name: "Applications", id: "apps" },
      { name: "Documentaries", id: "documentaries" },
      { name: "Anime", id: "anime" },
      { name: "Other", id: "other" },
      { name: "XXX", id: "xxx" }
    ];
  }

  // Get available sort options for the filter UI
  async getSortOptions() {
    return [
      { name: "Seeders", id: "seeders" },
      { name: "Leechers", id: "leechers" },
      { name: "Time", id: "time" },
      { name: "Size", id: "size" },
      { name: "Name", id: "name" }
    ];
  }

  // Add background update checking
  async backgroundUpdate() {
    try {
      const latestTorrents = await this.latest(1);
      const currentTime = Date.now();
      
      // Initialize lastCheck if it doesn't exist
      if (!this.lastCheck) {
        this.lastCheck = {
          timestamp: currentTime,
          items: latestTorrents.slice(0, 5)
        };
        return true;
      }

      // Compare with previous items
      const newItems = latestTorrents.filter(newItem => {
        return !this.lastCheck.items.some(oldItem => 
          oldItem.url === newItem.url
        );
      });

      // Update lastCheck
      this.lastCheck = {
        timestamp: currentTime,
        items: latestTorrents.slice(0, 5)
      };

      // Return update info
      return {
        hasUpdates: newItems.length > 0,
        newItems,
        lastChecked: this.lastCheck.timestamp
      };
    } catch (error) {
      console.error('Background update failed:', error);
      return {
        hasUpdates: false,
        error: error.message,
        lastChecked: this.lastCheck?.timestamp
      };
    }
  }
}