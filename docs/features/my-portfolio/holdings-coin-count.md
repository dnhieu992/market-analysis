## Description
Dòng đếm coin dưới tiêu đề **Holdings** trong trang chi tiết portfolio (`/portfolio/<id>`) chỉ đếm những coin **đang thực sự nắm giữ** (`totalAmount > 0`). Các coin đã bán hết vẫn được giữ lại trong bảng (để không mất realized PnL và lịch sử cycle) nhưng không còn được tính vào số lượng coin.

## Main Flow
1. `PortfolioDetailPage` fetch `holdings` từ API và truyền xuống `PortfolioHoldingsList`.
2. `PortfolioHoldingsList` tính `heldCoinCount = holdings.filter((h) => h.totalAmount > 0).length`.
3. Header render `"{heldCoinCount} coin(s)"`; nếu `holdings.length === 0` thì render `"No holdings yet."`.
4. Bảng bên dưới vẫn render **toàn bộ** holdings; hàng có `totalAmount <= 0` được làm mờ (opacity 0.45) kèm title "Không còn nắm giữ (holding = 0)".

Cách đếm này khớp với cột **Coins Holding** ở trang danh sách `/portfolio` (`PortfoliosList` đã dùng `activeHoldings = holdings.filter((h) => h.totalAmount > 0)`).

## Edge Cases
- Portfolio chỉ còn các coin đã bán hết → `heldCoinCount = 0`, header hiện `"0 coins"` (không phải "No holdings yet.", vì bảng vẫn còn dữ liệu lịch sử để xem).
- Không có holding nào → hiện `"No holdings yet."`.
- `totalAmount` âm do sai lệch dữ liệu → không được đếm (điều kiện là `> 0`).

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — tính `heldCoinCount` và render dòng đếm trong header.
- `apps/web/src/widgets/portfolios-list/portfolios-list.tsx` — cột "Coins Holding" ở trang danh sách, dùng cùng quy tắc lọc.
- `apps/web/src/_pages/portfolio-detail-page/portfolio-detail-page.tsx` — fetch holdings/transactions và truyền vào widget.
