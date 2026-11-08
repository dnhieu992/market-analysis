/** Shared shapes of the order-fill watcher (Bitget + MEXC futures → notifications + Telegram). */

export type FillExchange = 'bitget' | 'mexc';
export type FillSide = 'long' | 'short';
/** What the fill did to the position. `unknown` = one-way mode on Bitget (buy/sell only). */
export type FillAction = 'open' | 'close' | 'liquidation' | 'unknown';

/** One exchange fill (trade), normalised to app terms. */
export type RawFill = {
  /** Exchange trade/deal id — unique per fill. */
  id: string;
  orderId: string;
  /** App symbol, e.g. BTCUSDT. */
  symbol: string;
  side: FillSide | null;
  action: FillAction;
  price: number;
  /** Size in the BASE asset (MEXC contracts already converted). */
  size: number;
  /** Notional in USDT. */
  quote: number;
  /** Gross realised PnL of this fill (0 on opens). */
  profit: number;
  /** Signed fee: negative = paid. */
  fee: number;
  /** Fill time, ms. */
  ts: number;
};

/** Optional details of the order a fill belongs to (one extra call per new order). */
export type OrderMeta = {
  /** limit | market | … (display only). */
  orderType?: string | null;
  /** Raw exchange source / category (debug). */
  source?: string | null;
  /** What triggered the order, when the exchange says so. */
  kind?: 'tp' | 'sl' | 'liquidation' | null;
  clientOid?: string | null;
};

/** A live position right after the fills (to tell "mở mới" from DCA and show the avg). */
export type PositionSnap = { symbol: string; side: FillSide; size: number; avgPrice: number };

export interface FillSource {
  readonly exchange: FillExchange;
  isConfigured(): boolean;
  /** Every fill with `sinceMs <= ts <= untilMs`, any order. */
  fetchFills(sinceMs: number, untilMs: number): Promise<RawFill[]>;
  fetchOrderMeta(symbol: string, orderId: string): Promise<OrderMeta | null>;
  /** All live positions, or null when the lookup failed. */
  fetchPositions(): Promise<PositionSnap[] | null>;
}
