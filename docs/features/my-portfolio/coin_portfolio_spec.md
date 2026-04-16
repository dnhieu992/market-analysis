# Coin Portfolio Tracker — Technical Spec
> Stack: NestJS + MySQL  
> Mục tiêu: Tracking mua/bán coin, tính giá trung bình và lợi nhuận

---

## Database Schema (MySQL)

> Dùng DECIMAL(20, 8) thay NUMERIC — MySQL syntax  
> Không dùng trigger — xử lý logic ở Service layer (NestJS)  
> ID dùng VARCHAR(36) UUID hoặc BIGINT auto increment tùy preference

### users
| Column | Type | Note |
|--------|------|------|
| id | VARCHAR(36) PK | UUID |
| email | VARCHAR(255) UNIQUE | |
| display_name | VARCHAR(100) | |
| created_at | DATETIME | DEFAULT NOW() |

### portfolios
| Column | Type | Note |
|--------|------|------|
| id | VARCHAR(36) PK | UUID |
| user_id | VARCHAR(36) FK → users | CASCADE DELETE |
| name | VARCHAR(100) | ví dụ: "Main", "Altcoin" |
| description | TEXT | nullable |
| created_at | DATETIME | DEFAULT NOW() |

### transactions
> Source of truth — không xóa record, chỉ soft delete nếu cần

| Column | Type | Note |
|--------|------|------|
| id | VARCHAR(36) PK | UUID |
| portfolio_id | VARCHAR(36) FK → portfolios | CASCADE DELETE |
| coin_id | VARCHAR(50) | ví dụ: "BTC", "ETH" — không FK |
| type | ENUM('buy', 'sell') | |
| price | DECIMAL(20, 8) | giá tại thời điểm giao dịch |
| amount | DECIMAL(20, 8) | số coin |
| total_value | DECIMAL(20, 8) | price × amount, tính sẵn ở app layer |
| fee | DECIMAL(20, 8) | DEFAULT 0 |
| note | TEXT | nullable |
| transacted_at | DATETIME | thời điểm thực hiện |
| created_at | DATETIME | DEFAULT NOW() |

### holdings
> Cache trạng thái hiện tại — được update bởi HoldingsService sau mỗi transaction  
> Nếu lệch dữ liệu, gọi recalculate() để rebuild từ transactions

| Column | Type | Note |
|--------|------|------|
| id | VARCHAR(36) PK | UUID |
| portfolio_id | VARCHAR(36) FK → portfolios | CASCADE DELETE |
| coin_id | VARCHAR(50) | |
| total_amount | DECIMAL(20, 8) | số coin đang giữ |
| total_cost | DECIMAL(20, 8) | tổng tiền đã bỏ ra |
| avg_cost | DECIMAL(20, 8) | = total_cost / total_amount |
| realized_pnl | DECIMAL(20, 8) | lãi/lỗ đã chốt |
| updated_at | DATETIME | |
> UNIQUE KEY trên (portfolio_id, coin_id)

### pnl_history
> Snapshot cuối ngày — insert bởi cron job  
> coin_id = NULL nghĩa là snapshot toàn portfolio

| Column | Type | Note |
|--------|------|------|
| id | VARCHAR(36) PK | UUID |
| portfolio_id | VARCHAR(36) FK → portfolios | CASCADE DELETE |
| coin_id | VARCHAR(50) | nullable |
| date | DATE | |
| realized_pnl | DECIMAL(20, 8) | |
| unrealized_pnl | DECIMAL(20, 8) | tính từ giá tại thời điểm snapshot |
| total_value | DECIMAL(20, 8) | |
> UNIQUE KEY trên (portfolio_id, coin_id, date)

---

## Indexes

```
transactions : (portfolio_id, coin_id), (transacted_at DESC)
holdings     : (portfolio_id), (portfolio_id, coin_id)
pnl_history  : (portfolio_id, date DESC)
```

---

## Modules & Features

### 1. AuthModule
**Mục tiêu:** Xác thực người dùng

- Đăng ký / đăng nhập bằng email + password
- JWT access token + refresh token
- Guard bảo vệ các route cần auth

---

### 2. PortfolioModule
**Mục tiêu:** Quản lý danh mục đầu tư

- Tạo / sửa / xóa portfolio
- Lấy danh sách portfolio của user
- Lấy tổng quan 1 portfolio: tổng đầu tư, realized PnL, số coin đang giữ

---

### 3. TransactionModule
**Mục tiêu:** Ghi nhận giao dịch mua/bán

- Tạo transaction (buy / sell)
  - Validate: sell không được vượt quá `total_amount` trong holdings
  - Sau khi insert → gọi HoldingsService để update holdings
- Lấy lịch sử giao dịch của 1 portfolio (filter theo coin_id, type, date range)
- Xóa transaction (soft delete) → trigger recalculate holdings

---

### 4. HoldingsModule
**Mục tiêu:** Quản lý trạng thái holdings và tính PnL

**Logic update khi BUY:**
```
total_amount += amount
total_cost   += total_value
avg_cost      = total_cost / total_amount
```

**Logic update khi SELL:**
```
realized_pnl += (price - avg_cost) × amount
total_cost   -= avg_cost × amount
total_amount -= amount
avg_cost không đổi
```

- Lấy tất cả holdings đang có của 1 portfolio
- Tính unrealized PnL theo current price (truyền vào từ caller hoặc fetch từ exchange)
- `recalculate(portfolioId)`: xóa holdings → replay toàn bộ transactions theo thứ tự thời gian → rebuild

---

### 5. PnlModule
**Mục tiêu:** Lịch sử lợi nhuận để hiển thị chart

- Cron job chạy cuối ngày: snapshot realized + unrealized PnL vào `pnl_history`
- Lấy lịch sử PnL theo portfolio (date range)
- Lấy lịch sử PnL theo từng coin

---

## Luồng Xử Lý Chính

### Tạo transaction BUY
```
Request → TransactionService.create()
  → Validate input
  → Insert vào transactions
  → HoldingsService.updateOnBuy()
  → Return transaction
```

### Tạo transaction SELL
```
Request → TransactionService.create()
  → Validate: amount <= holdings.total_amount
  → Insert vào transactions
  → HoldingsService.updateOnSell()
  → Return transaction
```

### Lấy holdings + unrealized PnL
```
Request (kèm current prices map) → HoldingsService.getByPortfolio()
  → Lấy holdings từ DB
  → Với mỗi coin: unrealized_pnl = (current_price - avg_cost) × total_amount
  → Return holdings kèm unrealized PnL
```

### Cron job cuối ngày
```
Scheduler trigger → PnlService.snapshotDaily()
  → Lấy tất cả portfolios
  → Fetch current prices từ exchange
  → Tính unrealized PnL cho từng coin
  → Insert vào pnl_history
```

---

## Lưu Ý Implement

- `total_value` tính ở application layer trước khi insert, không tính trong DB
- `unrealized_pnl` không lưu trong `holdings` — tính realtime khi có request
- Giá hiện tại fetch từ exchange API ở caller, không cache trong DB
- Khi `total_amount = 0` sau khi bán hết → giữ nguyên holdings record để bảo toàn `realized_pnl`
- Dùng **TypeORM transaction** khi insert `transactions` + update `holdings` để đảm bảo atomicity
- `recalculate()` nên chạy trong DB transaction để tránh state lỗi giữa chừng
