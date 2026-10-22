/**
 * Paper strategy fed by the Scalping chat skill: no engine signal — every trade is a setup the
 * trader accepted in /skills/scalping. ScalpSkillPaperService fills and manages them on 1m candles.
 */
export const SCALP_SKILL_STRATEGY_ID = 'scalping-skill';

export const SCALP_SKILL_STRATEGY = {
  id: SCALP_SKILL_STRATEGY_ID,
  name: 'Scalping Skill (AI)',
  timeframe: '5m',
  rr: 2,
  rules:
    'Setup do skill Scalping đề xuất, bạn bấm Accept trong chat · MARKET khớp ngay, LIMIT/STOP chờ giá (hết hạn sau 60 phút) · ' +
    'TP1 chốt 50% rồi dời SL về hoà vốn, TP2 chốt phần còn lại · theo dõi bằng nến 1m tới khi chạm TP hoặc SL',
  tpNote: 'TP1 50% + TP2',
} as const;

/** A setup older than this can't be accepted any more — scalping levels go stale fast. */
export const SCALP_SETUP_MAX_AGE_MS = 60 * 60 * 1000;
/** Unfilled LIMIT/STOP orders expire after this. */
export const SCALP_PENDING_TTL_MS = 60 * 60 * 1000;

export const SCALP_SKILL_DOC = `## Scalping Skill (AI)

**Nguồn lệnh**
- Không có máy tự vào lệnh. Mỗi lệnh là một setup do skill **Scalping** (trang /skills) đề xuất, và **bạn bấm Accept** trong chat.
- Claude đọc nến 30m / 15m / 5m, rồi đưa ra hướng, loại lệnh, entry, SL, TP1, TP2.

**Khi bấm Accept**
- Kiểm tra lại giá hiện tại:
  - **MARKET** → khớp ngay ở giá hiện tại.
  - **LIMIT / STOP** mà giá đã tới entry → khớp ngay ở giá hiện tại.
  - **LIMIT / STOP** chưa tới entry → lệnh **chờ khớp**; quá **60 phút** chưa khớp thì **hết hạn**.
- Nếu giá hiện tại đã vượt SL hoặc TP1 → từ chối, không vào lệnh.
- Setup cũ hơn 60 phút không accept được nữa — hỏi lại để có setup mới.

**Quản lý lệnh (mỗi phút, nến 1m)**
- Chạm **TP1** → chốt **50%**, dời cắt lỗ về **giá vào** (hoà vốn).
- Chạm **TP2** → chốt phần còn lại.
- Chạm cắt lỗ → đóng hết (sau TP1 thì là hoà vốn cho nửa còn lại).
- Cùng một nến chạm cả SL lẫn TP → tính là **SL** (giả định xấu nhất).
- Không có giới hạn thời gian giữ lệnh — theo dõi tới khi chạm TP hoặc SL.

**Vốn**
- Rủi ro mỗi lệnh = "rủi ro" của chiến lược (mặc định 10$). Khối lượng tính ngược từ khoảng cắt lỗ. Phí 0.05%/chiều.

**Lưu ý**
- Paper trade trên giá Binance spot, **không đặt lệnh thật trên sàn**.
`;
