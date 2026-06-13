## Description
Trên trang `/tracking-coins`, mỗi dòng coin có một nút (icon AI). Trước đây nút này mở drawer chat gọi LLM tự động phân tích lệnh hiện tại. Tính năng AI đó **tạm thời bị disable** (code được giữ lại dưới dạng comment để bật lại sau).

Hành vi hiện tại: click nút → drawer trượt ra hiển thị **prompt phân tích đã được tạo sẵn** với đầy đủ chỉ báo của coin (trend D1/H4/M30, UT Bot, EMA, RSI, Volume, giá live, thời điểm scan) và nút **Copy prompt**. Người dùng copy rồi dán vào AI bên ngoài để tự phân tích.

## Main Flow
1. User vào `/tracking-coins`.
2. Click nút icon AI (tooltip "Tạo prompt") ở cột actions của một coin.
3. `setChatCoin(coin)` mở `TrackingCoinChatDrawer`.
4. Drawer gọi `buildInitialPrompt(coin, livePrice)` để dựng prompt đầy đủ chỉ báo.
5. Prompt hiển thị trong textarea read-only; user bấm **Copy prompt** → copy vào clipboard (có fallback `execCommand` cho non-secure context).
6. Nút đổi sang "✓ Đã copy prompt" trong 2 giây.
7. Đóng drawer bằng nút ✕ hoặc click backdrop.

## Edge Cases
- `coin.signal` null → prompt chỉ gồm header + danh sách yêu cầu phân tích, bỏ qua phần chỉ báo.
- `navigator.clipboard` không khả dụng (HTTP / browser cũ) → fallback tạo textarea ẩn + `document.execCommand('copy')`.
- Tính năng AI chat cũ (createConversation → sendMessage → poll reply) được comment trong file drawer; muốn bật lại thì khôi phục block comment và phần render chat gốc.

## Related Files (FE / BE / Worker)
### Frontend
- `apps/web/src/widgets/tracking-coin-chat-drawer/tracking-coin-chat-drawer.tsx` — drawer: dựng prompt + nút copy; logic AI chat cũ được comment giữ lại.
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — nút mở drawer (tooltip "Tạo prompt", `setChatCoin`).
