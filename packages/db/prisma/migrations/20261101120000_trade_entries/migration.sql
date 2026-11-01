-- Entry log (OPEN / DCA) of every Bitget + MEXC trade with declared strategy,
-- reason, market features and matched strategies; plus the strategy catalogue.
-- CreateTable
CREATE TABLE `trade_entries` (
    `id` VARCHAR(191) NOT NULL,
    `exchange` VARCHAR(10) NOT NULL,
    `tradeKey` VARCHAR(120) NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `event` VARCHAR(5) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'recorded',
    `source` VARCHAR(20) NOT NULL,
    `orderType` VARCHAR(8) NULL,
    `orderId` VARCHAR(64) NULL,
    `enteredAt` DATETIME(3) NOT NULL,
    `price` DOUBLE NULL,
    `size` DOUBLE NULL,
    `marginUsd` DOUBLE NULL,
    `leverage` DOUBLE NULL,
    `strategyKey` VARCHAR(60) NULL,
    `strategyVersion` INTEGER NULL,
    `grade` VARCHAR(20) NULL,
    `mode` VARCHAR(10) NULL,
    `reason` TEXT NULL,
    `tags` JSON NULL,
    `features` JSON NULL,
    `featureSetVersion` INTEGER NULL,
    `matched` JSON NULL,
    `plan` JSON NULL,
    `journaledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `trade_entries_exchange_tradeKey_idx`(`exchange`, `tradeKey`),
    INDEX `trade_entries_exchange_symbol_holdSide_status_idx`(`exchange`, `symbol`, `holdSide`, `status`),
    INDEX `trade_entries_strategyKey_idx`(`strategyKey`),
    INDEX `trade_entries_enteredAt_idx`(`enteredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trade_strategies` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `version` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `mode` VARCHAR(10) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    `summary` TEXT NOT NULL,
    `rules` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trade_strategies_key_version_key`(`key`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the initial catalogue (rules mirror ENTRY_STRATEGIES in @app/core).
INSERT INTO `trade_strategies` (`id`, `key`, `version`, `name`, `mode`, `status`, `summary`, `rules`, `updatedAt`) VALUES
('seed_qqe_pullback_swing_v1', 'qqe-pullback-swing', 1, 'QQE D1 + nhịp hồi RSI H4 (SWING)', 'SWING', 'ACTIVE',
 'Long khi xu hướng D1 còn tăng (QQE D1 long) và giá đang hồi trên H4. Hạng A: RSI H4 < 40 và giá ≤ EMA89 D1 +15% (ký quỹ Setup). Hạng B: RSI H4 < 45 và ≤ EMA89 +25% (½ ký quỹ). TP alt ≥ +5%, major +3–5%; DCA alt 3×5%, major 3×3%. Không SL.',
 JSON_OBJECT('side', 'long', 'A', JSON_OBJECT('qqeD1', 'long', 'rsiH4Lt', 40, 'distEma89D1Lte', 15), 'B', JSON_OBJECT('qqeD1', 'long', 'rsiH4Lt', 45, 'distEma89D1Lte', 25)), CURRENT_TIMESTAMP(3)),
('seed_qqe_rsi1h_scalp_v1', 'qqe-rsi1h-scalp', 1, 'QQE D1 + quá bán RSI 1h (SCALP)', 'SCALP', 'ACTIVE',
 'Long khi QQE D1 long và RSI(14) 1h < 35. "Mạnh" khi thêm QQE H4 long và RSI 1h < 30. TP alt ≥ +2%, major +1–2%; DCA alt 3×5%, major 3×3%. Không SL.',
 JSON_OBJECT('side', 'long', 'normal', JSON_OBJECT('qqeD1', 'long', 'rsi1hLt', 35), 'strong', JSON_OBJECT('qqeD1', 'long', 'qqeH4', 'long', 'rsi1hLt', 30)), CURRENT_TIMESTAMP(3)),
('seed_hedge_short_v1', 'hedge-short', 1, 'Short alt phòng hộ cho long đang gồng', 'HEDGE', 'ACTIVE',
 'Chỉ short alt khi đang có long gồng lỗ cùng coin cùng sàn; size ≤ ½ size long (tính cả DCA); TP +0.6–1%; đóng theo long. BTC/ETH short không thuộc chiến lược này.',
 JSON_OBJECT('side', 'short', 'requiresOppositeLong', true, 'maxSizeRatio', 0.5, 'excludes', JSON_ARRAY('BTCUSDT', 'ETHUSDT')), CURRENT_TIMESTAMP(3)),
('seed_discretionary_v1', 'discretionary', 1, 'Cảm tính / ngoài quy tắc', 'OTHER', 'ACTIVE',
 'Lệnh vào theo cảm nhận hoặc lý do riêng, không theo chiến lược nào đã định nghĩa. Ghi lý do để so sánh với các chiến lược có quy tắc.',
 NULL, CURRENT_TIMESTAMP(3));
