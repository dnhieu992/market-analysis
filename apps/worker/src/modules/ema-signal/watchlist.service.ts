import { Injectable } from '@nestjs/common';

@Injectable()
export class WatchlistService {
  private readonly watchers = new Map<string, Set<string>>();
  private readonly lastSentCloseTime = new Map<string, number>();

  watch(symbol: string, chatId: string): 'added' | 'already_watching' {
    if (!this.watchers.has(symbol)) {
      this.watchers.set(symbol, new Set());
    }
    const chatIds = this.watchers.get(symbol)!;
    if (chatIds.has(chatId)) return 'already_watching';
    chatIds.add(chatId);
    return 'added';
  }

  unwatch(symbol: string, chatId: string): 'removed' | 'not_watching' {
    const chatIds = this.watchers.get(symbol);
    if (!chatIds?.has(chatId)) return 'not_watching';
    chatIds.delete(chatId);
    if (chatIds.size === 0) this.watchers.delete(symbol);
    return 'removed';
  }

  getWatchedSymbols(): string[] {
    return Array.from(this.watchers.entries())
      .filter(([, chatIds]) => chatIds.size > 0)
      .map(([symbol]) => symbol);
  }

  getChatIds(symbol: string): string[] {
    return Array.from(this.watchers.get(symbol) ?? []);
  }

  getLastSentCloseTime(symbol: string): number {
    return this.lastSentCloseTime.get(symbol) ?? 0;
  }

  updateLastSentCloseTime(symbol: string, closeTime: number): void {
    this.lastSentCloseTime.set(symbol, closeTime);
  }
}
