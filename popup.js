const searchForm = document.getElementById('search-form');
const queryInput = document.getElementById('query');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

const SEARCH_PROVIDERS = [
  {
    name: 'DuckDuckGo',
    url: 'https://r.jina.ai/http://html.duckduckgo.com/html/?q='
  },
  {
    name: 'Google',
    url: 'https://r.jina.ai/http://www.google.com/search?q='
  },
  {
    name: 'Bing',
    url: 'https://r.jina.ai/http://www.bing.com/search?q='
  }
];
const ITEM_PATTERN = /^\s*\d+\.\s+(?:.*?\[(.*?)\]\((https?:\/\/[^)]+)\)|([^\s].*?))$/;
const RESULT_LINE_PATTERN = /^#{1,6}\s*\[(.*?)\]\((https?:\/\/.+)\)$/;
const SAFE_URL_REGEX = /https?:\/\/[^\s)]+/;
const BLOCKED_HOSTS = new Set([
  'duckduckgo.com',
  'www.duckduckgo.com',
  'start.duckduckgo.com',
  'duck.ai'
]);
const BLOCKED_TITLES = new Set([
  'All',
  'Images',
  'Videos',
  'News',
  'More',
  'Settings',
  'Themes',
  'Homepage',
  'Help',
  'About DuckDuckGo',
  'About Our Browser'
]);
const SKIP_TITLE_PREFIXES = ['Image', 'More Images', 'Search domain', 'Learn Python', 'Get Started'];

function cleanTitle(value) {
  return value.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

function isBlockedUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.duckduckgo.com');
  } catch (error) {
    return false;
  }
}

function decodeBingUrl(rawUrl) {
  const match = rawUrl.match(/[?&]u=([^&]+)/);
  if (!match) return rawUrl;

  let encoded = decodeURIComponent(match[1]);
  if (encoded.startsWith('a1')) {
    encoded = encoded.slice(2);
  }

  const padding = encoded.length % 4;
  if (padding) {
    encoded += '='.repeat(4 - padding);
  }

  try {
    return atob(encoded);
  } catch (error) {
    return rawUrl;
  }
}

function normalizeResultUrl(rawUrl) {
  if (!rawUrl) return '';

  const decoded = decodeBingUrl(rawUrl);
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname === 'duckduckgo.com' || parsed.hostname.endsWith('.duckduckgo.com')) {
      const target = parsed.searchParams.get('uddg') || parsed.searchParams.get('url');
      if (target) {
        return normalizeResultUrl(target);
      }
    }
    return parsed.toString();
  } catch (error) {
    return decoded;
  }
}

function parseResults(rawText) {
  const lines = rawText.split(/\r?\n/);
  const results = [];
  const seen = new Set();

  const addResult = (title, rawUrl, snippet = '') => {
    if (!title || !rawUrl) return;

    const decodedUrl = normalizeResultUrl(rawUrl);
    if (!decodedUrl.startsWith('http') || isBlockedUrl(decodedUrl)) return;

    const clean = cleanTitle(title);
    if (!clean || BLOCKED_TITLES.has(clean)) return;
    if (SKIP_TITLE_PREFIXES.some((prefix) => clean.startsWith(prefix))) return;
    if (clean.includes('Search domain')) return;
    if (clean.includes('![Image') || clean.includes('](')) return;
    if (seen.has(decodedUrl)) return;

    seen.add(decodedUrl);
    results.push({
      title: clean,
      url: decodedUrl,
      snippet: cleanTitle(snippet)
    });
  };

  const isIgnoredLine = (value) =>
    value.startsWith('Title:') ||
    value.startsWith('URL Source:') ||
    value.startsWith('Markdown Content:') ||
    value.startsWith('Search results:') ||
    value.startsWith('[](') ||
    value.startsWith('# ');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const fallbackMatch = line.match(RESULT_LINE_PATTERN);

    if (!fallbackMatch) {
      continue;
    }

    const title = fallbackMatch[1];
    const rawUrl = fallbackMatch[2];
    let snippet = '';

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next || isIgnoredLine(next)) continue;
      if (next.match(RESULT_LINE_PATTERN)) break;
      if (next.startsWith('![') || next.startsWith('[') && next.includes('](') && next.includes('http')) continue;
      if (next.startsWith('http')) continue;
      if (next.startsWith('*')) continue;
      snippet = next;
      break;
    }

    addResult(title, rawUrl, snippet);
  }

  return results;
}

function renderResults(results) {
  resultsEl.innerHTML = '';

  if (!results.length) {
    resultsEl.innerHTML = '<p>No results found.</p>';
    return;
  }

  results.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const anchor = document.createElement('a');
    anchor.href = item.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = item.title;

    const snippet = document.createElement('div');
    snippet.className = 'result-snippet';
    snippet.textContent = item.snippet;

    card.appendChild(anchor);
    card.appendChild(snippet);
    resultsEl.appendChild(card);
  });
}

async function runSearch(query) {
  statusEl.textContent = 'Searching...';
  resultsEl.innerHTML = '';

  let lastError = null;

  for (const provider of SEARCH_PROVIDERS) {
    try {
      const response = await fetch(`${provider.url}${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/plain, text/html'
        }
      });

      if (!response.ok) {
        lastError = new Error(`Request failed with status ${response.status} for ${provider.name}`);
        continue;
      }

      const text = await response.text();
      console.log(`[search:${provider.name}]`, text.slice(0, 1000));
      const results = parseResults(text);
      console.log(`[parsed:${provider.name}]`, results);

      if (results.length > 0) {
        renderResults(results);
        statusEl.textContent = `Found ${results.length} result(s) from ${provider.name}`;
        return;
      }

      lastError = new Error(`No results parsed from ${provider.name}`);
    } catch (error) {
      lastError = error;
      console.error(`[search:${provider.name}]`, error);
    }
  }

  statusEl.textContent = 'Something went wrong while searching.';
  if (lastError) {
    console.error('[search] final error:', lastError);
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;
  runSearch(query);
});
