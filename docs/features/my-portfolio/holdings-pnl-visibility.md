## Description
Ẩn/hiện cột **Profit / Loss** trong bảng Holdings ở trang chi tiết portfolio (`/portfolio/<id>`). Mỗi hàng có một icon con mắt riêng, và cạnh tiêu đề **Holdings** có thêm một icon con mắt tổng để bật/tắt P/L của **tất cả** coin trong list bằng một cú click. Mặc định P/L bị ẩn (hiện `••••••`) để có thể mở dashboard nơi công cộng mà không lộ số tiền.

## Main Flow
1. `PortfolioHoldingsList` giữ state `pnlVisibleMap: Record<coinId, boolean>`; coin không có trong map coi như đang ẩn.
2. Header tính `allPnlVisible = holdings.length > 0 && holdings.every((h) => pnlVisibleMap[h.coinId] ?? false)` — chỉ "on" khi mọi hàng đang hiện.
3. Click icon con mắt cạnh tiêu đề gọi `toggleAllPnl()`:
   - đang `allPnlVisible` → set map về `{}` (ẩn hết);
   - ngược lại → set `true` cho mọi `coinId` (hiện hết).
4. Icon con mắt trên từng hàng vẫn chỉ đổi coin của hàng đó; sau khi hàng cuối cùng được mở thì icon tổng tự chuyển sang trạng thái "hiện".
5. `PnlCell` render `••••••` khi `visible === false`, và render số P/L (`+` khi dương, class `tt-pnl-positive` / `tt-pnl-negative`) khi `visible === true`.

## Edge Cases
- Danh sách rỗng (`holdings.length === 0`) → không render icon tổng (không có gì để toggle) và `allPnlVisible` là `false`.
- Một số hàng đang hiện, một số đang ẩn → icon tổng ở trạng thái "ẩn", click sẽ **hiện tất cả** thay vì ẩn phần còn lại.
- Coin đã bán hết (`totalAmount <= 0`) vẫn nằm trong bảng nên vẫn được toggle như coin thường (P/L của nó là realized PnL).
- Giá chưa load xong (`pricesLoaded === false`) → ô P/L hiện `loading…`; toggle vẫn ghi vào state và có hiệu lực ngay khi giá về.
- State chỉ nằm trong component (không persist) → reload trang thì P/L trở lại trạng thái ẩn mặc định.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — `pnlVisibleMap`, `allPnlVisible`, `toggleAllPnl`, `EyeIcon`, `PnlCell`, icon tổng cạnh `<h2>Holdings</h2>` và icon từng hàng.
- `apps/web/src/_pages/portfolio-detail-page/portfolio-detail-page.tsx` — fetch holdings/transactions và render widget.
