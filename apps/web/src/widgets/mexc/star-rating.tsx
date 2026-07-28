'use client';

import { useState } from 'react';

/** Stars a coin can carry — 0 (none, all grey) to 5 (all yellow). */
export const MAX_PRIORITY = 5;

const STARS = Array.from({ length: MAX_PRIORITY }, (_, i) => i + 1);

/**
 * Manual 0–5 star priority picker for one coin in the /mexc Setup tab.
 * Always renders all 5 stars: filled ones are yellow, the rest stay grey.
 * Hovering previews the rating; clicking the star that is already the current
 * rating clears it back to 0 (the only way down to "no priority").
 */
export function StarRating({
  value,
  symbol,
  onChange,
}: {
  value: number;
  /** Used only for the accessible label / tooltips. */
  symbol: string;
  onChange: (next: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;

  return (
    <div
      className="bg-stars"
      role="radiogroup"
      aria-label={`Mức ưu tiên ${symbol}`}
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((star) => {
        const filled = star <= shown;
        // Clicking the current rating clears it — otherwise 1 star would be a floor.
        const next = star === value ? 0 : star;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} sao`}
            className={`bg-star ${filled ? 'bg-star--on' : ''}`}
            onMouseEnter={() => setHover(star)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(null)}
            onClick={() => onChange(next)}
            title={
              star === value
                ? `Bỏ ưu tiên ${symbol} (về 0 sao)`
                : `Đặt ưu tiên ${symbol} = ${star} sao`
            }
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
