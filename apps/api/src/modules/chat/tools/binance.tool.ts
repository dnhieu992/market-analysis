import type { ChatTool } from '../contracts/chat-tool';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

const VALID_INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];

type KlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error ${res.status}`);
  return res.json() as Promise<T>;
}

export const getKlinesTool: ChatTool<{ symbol: string; interval: string; limit?: number }, string> = {
  name: 'get_klines',
  description:
    'Fetch OHLCV candlestick data from Binance for a trading pair. ' +
    'Use this when you need to analyze price action, trends, or indicators for a specific timeframe.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol:   { type: 'string', description: 'Trading pair symbol, e.g. BTCUSDT' },
      interval: { type: 'string', description: 'Candlestick interval: 1m,5m,15m,30m,1h,4h,1d,1w' },
      limit:    { type: 'number', description: 'Number of candles to fetch (default 50, max 200)' }
    },
    required: ['symbol', 'interval']
  },
  async execute(input) {
    const symbol   = input.symbol.toUpperCase();
    const interval = VALID_INTERVALS.includes(input.interval) ? input.interval : '1h';
    const limit    = Math.min(input.limit ?? 50, 200);

    const rows = await fetchJson<KlineRow[]>(
      `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    // Return compact format to save tokens
    const candles = rows.map((r) => ({
      t: new Date(r[0]).toISOString(),
      o: r[1], h: r[2], l: r[3], c: r[4], v: r[5]
    }));

    return JSON.stringify({ symbol, interval, candles });
  }
};

export const getTickerPriceTool: ChatTool<{ symbol: string }, string> = {
  name: 'get_ticker_price',
  description: 'Get the current spot price of a trading pair from Binance.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Trading pair symbol, e.g. BTCUSDT' }
    },
    required: ['symbol']
  },
  async execute(input) {
    const symbol = input.symbol.toUpperCase();
    const data = await fetchJson<{ symbol: string; price: string }>(
      `${BASE}/api/v3/ticker/price?symbol=${symbol}`
    );
    return JSON.stringify(data);
  }
};

export const get24hTickerTool: ChatTool<{ symbol: string }, string> = {
  name: 'get_24h_ticker',
  description: 'Get 24-hour price change statistics for a trading pair (open, high, low, close, volume, % change).',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Trading pair symbol, e.g. BTCUSDT' }
    },
    required: ['symbol']
  },
  async execute(input) {
    const symbol = input.symbol.toUpperCase();
    const data = await fetchJson<Record<string, unknown>>(
      `${BASE}/api/v3/ticker/24hr?symbol=${symbol}`
    );
    // Return only relevant fields
    return JSON.stringify({
      symbol: data.symbol,
      priceChange: data.priceChange,
      priceChangePercent: data.priceChangePercent,
      highPrice: data.highPrice,
      lowPrice: data.lowPrice,
      lastPrice: data.lastPrice,
      volume: data.volume,
      quoteVolume: data.quoteVolume
    });
  }
};
