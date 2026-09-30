## Description
Bộ lọc coin dạng **ô nhập text có gợi ý tự động** (`SymbolSearchFilter`) trên cả `/bitget` và `/mexc` — tab Vị thế, Lịch sử và Setup. Thay cho hàng chip (`SymbolChipFilter`, 2026-09-30) vì khi nhiều coin, hàng chip dài và khó tìm, nhất là trên mobile. Portfolio holdings vẫn dùng chip.

## Main Flow
1. Focus vào ô "Gõ tên coin…" → dropdown hiện tất cả coin chưa chọn, A→Z theo tên rút gọn (bỏ `USDT`).
2. Gõ chữ → dropdown thu hẹp: coin **bắt đầu** bằng chuỗi gõ đứng trước, coin **chứa** chuỗi gõ đứng sau (không phân biệt hoa thường).
3. Bấm/tap một gợi ý hoặc ↑/↓ + Enter → coin thành **tag** trong ô, bảng lọc theo các coin đã chọn (chọn nhiều, cộng dồn). Ô nhập tự xoá chữ, vẫn giữ focus để chọn tiếp.
4. Bỏ một coin: bấm ✕ trên tag, hoặc Backspace khi ô trống (bỏ tag cuối). "✕ Xoá lọc" bỏ tất cả.
5. Khi có ≥1 coin được chọn, hiện "N kết quả" cạnh ô.

## Edge Cases
- Không có tag nào = xem tất cả coin (giữ nguyên ngữ nghĩa `matchesSymbolSelection`).
- Gõ chuỗi không khớp → dropdown hiện "Không có coin khớp"; Enter không làm gì.
- Coin đã chọn không xuất hiện lại trong gợi ý.
- Bấm ra ngoài / Escape → đóng dropdown.
- Chọn gợi ý dùng `mousedown` + `preventDefault` để input không mất focus (bàn phím mobile không bị đóng giữa các lần chọn).
- Trên mobile ô nhập hiển thị 16px (rule chống iOS auto-zoom trong `globals.css`).

## Related Files (FE / BE / Worker)
- `apps/web/src/shared/ui/symbol-search-filter/symbol-search-filter.tsx` — component input + dropdown gợi ý + tag.
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx`, `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx`, `apps/web/src/widgets/bitget-history/bitget-history-feed.tsx` — tab /bitget dùng `SymbolSearchFilter`.
- `apps/web/src/widgets/mexc/mexc-setup-feed.tsx`, `apps/web/src/widgets/mexc-positions/mexc-positions-feed.tsx`, `apps/web/src/widgets/mexc-history/mexc-history-feed.tsx` — tab /mexc dùng `SymbolSearchFilter`.
- `apps/web/src/widgets/{bitget,mexc}/symbol-filter-input.tsx` — `matchesSymbolSelection`; bản bitget còn giữ `SymbolChipFilter` cho Portfolio.
- `apps/web/src/app/globals.css` — style `.ssf-*`.
- BE / Worker: không thay đổi.
