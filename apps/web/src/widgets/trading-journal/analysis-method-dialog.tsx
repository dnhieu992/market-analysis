'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { renderMarkdown } from '@web/shared/lib/markdown';

/**
 * Read-only explainer of how the daily BTC/macro analysis is produced — the method
 * behind the 🤖 Claude entries. Opened from the "View" button next to the page title.
 *
 * Portals to `document.body` for the same reason as JournalEntryDialog: the fixed
 * backdrop must cover the viewport, not just the journal content column.
 */

const METHOD_MD = `
Mỗi sáng **07:30 (giờ VN)** một phiên Claude tự động sinh một bản phân tích BTC + vĩ mô rồi lưu vào
đúng ngày trên trang này, đánh dấu **🤖 Claude**. Bạn đọc lại, chỉnh sửa và bấm **Cập nhật** —
sau khi lưu nó chuyển thành **✍️ Bạn**. Dưới đây là cách bản phân tích đó được dựng.

## Nguồn dữ liệu
- **Giá BTC** D1 + H4 và **ETH** D1 từ nến công khai Binance (không dùng chỉ báo nhiễu khung nhỏ).
- **Dominance & dòng tiền:** BTC.D / USDT.D / ETH.D và vốn hoá TOTAL / TOTAL2 / TOTAL3.
- **Fear & Greed Index** (alternative.me) làm lớp tâm lý bổ trợ.
- Toàn bộ số liệu được thu thập sẵn — bản phân tích **không bịa số**.

## Khung phân tích (các mục trong bài)
1. **Bitcoin** — vị thế giá so với **EMA34/89/200 (bộ Sonic R)** trên D1 & H4, RSI, ATR, vùng
   đỉnh/đáy gần. EMA34 = hỗ trợ động, EMA89/200 = trend nền.
2. **Dominance & dòng tiền** — tiền đang rời stablecoin vào coin hay ngược lại, về BTC hay sang alt.
3. **Nhận định** — risk-on hay risk-off, tiền mặt còn nhiều hay cạn, kèm **Fear & Greed** (chỉ cảnh
   báo thận trọng khi *Extreme Greed*, xem là vùng mua tốt khi *Extreme Fear* — không dùng để đảo lệnh).
4. **Kế hoạch** — 2-3 kịch bản kèm mốc giá kích hoạt; kịch bản tăng nêu **mục tiêu breakout** (đo range
   + Fib) và đối chiếu **vùng cung/kháng cự phía trên**.

## Vùng mua lại (theo kinh nghiệm) — quy tắc mới
Ngoài các mốc kỹ thuật, bài viết có một mục dựa trên **backtest 9 năm BTC**:

> Trong xu hướng tăng, BTC **hiếm khi chỉnh đủ sâu để mua lại**. Muốn đợi nhịp chỉnh **≥15%** thì
> median giá đã chạy **+29%**, và **82%** số sóng chạy hơn +20% mà không hề cho cú chỉnh 15%. Nhịp
> chỉnh sâu (≥15%) vừa **hiếm** vừa **~50% là đảo trend**, không phải dip để mua.

Cách áp dụng, gắn cổng theo **EMA200**:
- **Bull (giá > EMA200):** ưu tiên **mua nhịp chỉnh nông −5÷−10%** từ đỉnh sóng gần nhất, hoặc mua
  rải đều — **không đứng ngoài đợi chỉnh sâu**. Chỉ khi thủng −15% mới xét khả năng đảo trend.
- **Bear (giá < EMA200):** **tắt** quy tắc mua nông — nhịp hồi trong downtrend thất bại > 50% số lần,
  ưu tiên đứng ngoài / chờ đóng nến lại trên EMA200.

## Ảnh đính kèm
Mỗi bản tự kèm **chart BTC D1** (nến + EMA34/89/200) và **gauge Fear & Greed** của ngày hôm đó
(ảnh được đóng băng theo ngày, không đổi theo giá trị hiện tại).
`;

export function AnalysisMethodDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide tj-view" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">📊 Cách phân tích hiện tại</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="dialog-body tj-view-body">
          <div className="tj-view-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(METHOD_MD) }} />
        </div>

        <div className="tj-view-actions">
          <button type="button" className="tj-btn tj-btn-primary" onClick={onClose}>Đã hiểu</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
