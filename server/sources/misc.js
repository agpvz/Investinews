// Crypto (CoinGecko) and FX reference rates (Frankfurter / ECB).
import { getJSON } from '../lib/http.js';
import { cached } from '../lib/cache.js';

export async function cryptoMarkets() {
  return cached('crypto:markets', 60_000, async () => {
    const data = await getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=25&page=1&sparkline=true&price_change_percentage=1h%2C24h%2C7d');
    return data.map((c) => ({
      symbol: c.symbol.toUpperCase(), name: c.name, last: c.current_price, pct1h: c.price_change_percentage_1h_in_currency, pct: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h,
      pct7d: c.price_change_percentage_7d_in_currency, mcap: c.market_cap, volume: c.total_volume, high24: c.high_24h, low24: c.low_24h, spark: c.sparkline_in_7d?.price || [],
    }));
  });
}

export async function fxRates(base = 'USD') {
  return cached(`fx:${base}`, 600_000, async () => {
    const data = await getJSON(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`);
    return { base: data.base, date: data.date, rates: data.rates };
  });
}
