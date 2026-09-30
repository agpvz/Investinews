// Curated free RSS feeds grouped into Bloomberg-style news categories (NI codes).
import { getText, settleAll } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseFeed } from '../lib/rss.js';
import { toHeadline, mergeHeadlines } from '../lib/news.js';

const GN = (section) => `https://news.google.com/rss/headlines/section/topic/${section}?hl=en-US&gl=US&ceid=US:en`;
const GNQ = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const CNBC = (id) => `https://www.cnbc.com/id/${id}/device/rss/rss.html`;

export const FEEDS = {
  cnbc_top: { name: 'CNBC', url: CNBC(100003114) },
  cnbc_markets: { name: 'CNBC', url: CNBC(20910258) },
  cnbc_investing: { name: 'CNBC', url: CNBC(15839069) },
  cnbc_econ: { name: 'CNBC', url: CNBC(20910258) },
  cnbc_earnings: { name: 'CNBC', url: CNBC(15839135) },
  cnbc_tech: { name: 'CNBC', url: CNBC(19854910) },
  cnbc_energy: { name: 'CNBC', url: CNBC(19836768) },
  cnbc_politics: { name: 'CNBC', url: CNBC(10000113) },
  cnbc_world: { name: 'CNBC', url: CNBC(100727362) },
  cnbc_asia: { name: 'CNBC', url: CNBC(19832390) },
  cnbc_europe: { name: 'CNBC', url: CNBC(19794221) },
  cnbc_finance: { name: 'CNBC', url: CNBC(10000664) },
  cnbc_health: { name: 'CNBC', url: CNBC(10000108) },
  cnbc_realestate: { name: 'CNBC', url: CNBC(10000115) },
  mw_top: { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  mw_realtime: { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines' },
  mw_pulse: { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
  mw_bulletins: { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_bulletins' },
  wsj_markets: { name: 'WSJ', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain' },
  wsj_world: { name: 'WSJ', url: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews' },
  wsj_business: { name: 'WSJ', url: 'https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness' },
  wsj_tech: { name: 'WSJ', url: 'https://feeds.content.dowjones.io/public/rss/RSSWSJD' },
  yahoo_top: { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
  bbc_business: { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  bbc_world: { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  ft_home: { name: 'FT', url: 'https://www.ft.com/rss/home' },
  gn_business: { name: '', url: GN('BUSINESS') },
  gn_tech: { name: '', url: GN('TECHNOLOGY') },
  gn_world: { name: '', url: GN('WORLD') },
  gn_reuters: { name: '', url: GNQ('site:reuters.com business OR markets') },
  gn_bloomberg: { name: '', url: GNQ('site:bloomberg.com markets') },
  gn_ap_business: { name: '', url: GNQ('site:apnews.com business') },
  gn_ma: { name: '', url: GNQ('merger OR acquisition OR "to acquire" OR takeover') },
  gn_ipo: { name: '', url: GNQ('IPO OR "initial public offering"') },
  fed: { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  ecb: { name: 'ECB', url: 'https://www.ecb.europa.eu/rss/press.html' },
  boe: { name: 'Bank of England', url: 'https://www.bankofengland.co.uk/rss/news' },
  bls: { name: 'BLS', url: 'https://www.bls.gov/feed/bls_latest.rss' },
  bea: { name: 'BEA', url: 'https://apps.bea.gov/rss/rss.xml' },
  politico: { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml' },
  techcrunch: { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  verge: { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  ars: { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  oilprice: { name: 'OilPrice', url: 'https://oilprice.com/rss/main' },
  coindesk: { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  cointelegraph: { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  prn: { name: 'PR Newswire', url: 'https://www.prnewswire.com/rss/news-releases-list.rss' },
  gnw: { name: 'GlobeNewswire', url: 'https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20Releases' },
  nikkei: { name: 'Nikkei Asia', url: 'https://asia.nikkei.com/rss/feed/nar' },
  scmp: { name: 'SCMP', url: 'https://www.scmp.com/rss/92/feed' },
  sec_8k: { name: 'SEC', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom&count=40' },
  guardian_biz: { name: 'Guardian', url: 'https://www.theguardian.com/uk/business/rss' },
  aljazeera_econ: { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  seekingalpha: { name: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml' },
  investing: { name: 'Investing.com', url: 'https://www.investing.com/rss/news.rss' },
};

// Category (NI code) -> feed keys. First entry in each list is the canonical label.
export const CATEGORIES = {
  TOP: { label: 'Top News', feeds: ['cnbc_top', 'mw_top', 'yahoo_top', 'wsj_markets', 'bbc_business', 'gn_business', 'gn_reuters', 'ft_home', 'gn_bloomberg', 'gn_ap_business'] },
  MKT: { label: 'Markets', feeds: ['mw_realtime', 'mw_pulse', 'mw_bulletins', 'wsj_markets', 'cnbc_markets', 'cnbc_investing', 'yahoo_top', 'seekingalpha', 'investing'] },
  ECO: { label: 'Economy', feeds: ['cnbc_econ', 'bls', 'bea', 'fed', 'ecb', 'boe', 'gn_business'] },
  CEN: { label: 'Central Banks', feeds: ['fed', 'ecb', 'boe'] },
  TECH: { label: 'Technology', feeds: ['cnbc_tech', 'wsj_tech', 'techcrunch', 'verge', 'ars', 'gn_tech'] },
  ENR: { label: 'Energy & Commodities', feeds: ['cnbc_energy', 'oilprice'] },
  CRYPTO: { label: 'Crypto', feeds: ['coindesk', 'cointelegraph'] },
  POL: { label: 'Politics', feeds: ['cnbc_politics', 'politico'] },
  WLD: { label: 'World', feeds: ['bbc_world', 'gn_world', 'cnbc_world', 'wsj_world', 'aljazeera_econ'] },
  ASIA: { label: 'Asia', feeds: ['cnbc_asia', 'nikkei', 'scmp'] },
  EUR: { label: 'Europe', feeds: ['cnbc_europe', 'ft_home', 'bbc_business', 'guardian_biz', 'ecb', 'boe'] },
  EARN: { label: 'Earnings', feeds: ['cnbc_earnings', 'seekingalpha'] },
  CORP: { label: 'Corporate Releases', feeds: ['prn', 'gnw', 'sec_8k'] },
  MNA: { label: 'M&A', feeds: ['gn_ma'] },
  IPO: { label: 'IPOs', feeds: ['gn_ipo'] },
  FIN: { label: 'Financials', feeds: ['cnbc_finance'] },
  HLTH: { label: 'Health Care', feeds: ['cnbc_health'] },
  REAL: { label: 'Real Estate', feeds: ['cnbc_realestate'] },
};

export const CATEGORY_ALIASES = {
  N: 'TOP', NEWS: 'TOP', MARKETS: 'MKT', MARKET: 'MKT', STK: 'MKT', ECON: 'ECO', ECONOMY: 'ECO', FED: 'CEN', CB: 'CEN', CENTRAL: 'CEN',
  TECHNOLOGY: 'TECH', ENERGY: 'ENR', CMD: 'ENR', OIL: 'ENR', COMMODITIES: 'ENR', CRYP: 'CRYPTO', BTC: 'CRYPTO', COIN: 'CRYPTO',
  POLITICS: 'POL', GOV: 'POL', WORLD: 'WLD', INTL: 'WLD', ASIAX: 'ASIA', EUROPE: 'EUR', EU: 'EUR', EARNINGS: 'EARN', ERN: 'EARN',
  PR: 'CORP', WIRE: 'CORP', 'M&A': 'MNA', MA: 'MNA', MERGER: 'MNA', IPOS: 'IPO', BNK: 'FIN', BANKS: 'FIN', HEALTH: 'HLTH', PHARMA: 'HLTH',
  ESTATE: 'REAL', RE: 'REAL',
};

export function resolveCategory(code = '') {
  const c = code.toUpperCase();
  if (CATEGORIES[c]) return c;
  if (CATEGORY_ALIASES[c]) return CATEGORY_ALIASES[c];
  return null;
}

export async function fetchFeed(key) {
  const f = FEEDS[key];
  if (!f) throw new Error(`unknown feed ${key}`);
  return cached(`feed:${key}`, 90_000, async () => {
    const xml = await getText(f.url, { timeout: 10_000 });
    const parsed = parseFeed(xml, f.name ? { feedTitle: f.name } : {});
    return parsed.items.map((it) => toHeadline(it, { source: f.name || it.source, category: key }));
  });
}

export async function categoryNews(code, limit = 150) {
  const cat = resolveCategory(code);
  if (!cat) return null;
  const jobs = {};
  for (const k of CATEGORIES[cat].feeds) jobs[k] = () => fetchFeed(k);
  const { items, health } = await settleAll(jobs);
  return { category: cat, label: CATEGORIES[cat].label, items: mergeHeadlines([items], limit).map((h) => ({ ...h, topic: cat })), health };
}
