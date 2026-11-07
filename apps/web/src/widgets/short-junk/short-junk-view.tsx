'use client';

import { useState } from 'react';

import type { JunkShortCoin } from '@web/shared/api/types';

import { JunkCoinsManager } from './junk-coins-manager';
import { ShortJunkAiChat } from './short-junk-ai-chat';
import styles from './junk-coins.module.css';

export function ShortJunkView({ initialCoins }: { initialCoins: JunkShortCoin[] }) {
  const [coins, setCoins] = useState(initialCoins);
  return (
    <div className={`page ${styles.page}`}>
      <h1>🗑️ Short Coin Rác</h1>
      <p className={styles.lead}>
        Skill <strong>Short Coin Rác</strong> (nút AI góc dưới) và cảnh báo Telegram <strong>chỉ scan các coin trong danh sách này</strong>.
        Coin không đạt tiêu chí nghiên cứu (vốn hoá trước pump $20–500M, ≥ 50% dưới ATH, list ≥ 90 ngày) vẫn được scan nhưng bị gắn cờ đỏ.
      </p>
      <JunkCoinsManager coins={coins} onChange={setCoins} />
      <ShortJunkAiChat coinCount={coins.length} />
    </div>
  );
}
