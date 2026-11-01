-- Pure price-action SWING strategy (kept separate from the QQE/RSI rules).
INSERT INTO `trade_strategies` (`id`, `key`, `version`, `name`, `mode`, `status`, `summary`, `rules`, `updatedAt`) VALUES
('seed_pa_sweep_reclaim_v1', 'pa-sweep-reclaim', 1, 'PA: quét đáy H4 & lấy lại + D1 tăng (SWING)', 'SWING', 'ACTIVE',
 'Price action thuần, không indicator. Long khi D1 cấu trúc tăng (2 đỉnh và 2 đáy swing D1 gần nhất đều cao dần, pivot 3 nến) và một nến H4 quét thủng đáy swing H4 gần nhất (pivot 3 nến, ≤ 90 nến) rồi đóng lại trên đáy đó — lần thủng đầu tiên; vào trong 1–2 nến H4 sau khi giá còn trên đáy bị quét. TP alt ≥ +5%, major +3%; DCA alt 3×5%, major 3×3%. Không SL. Backtest 40 coin: 02/2025–01/2026 p10 −16%, 02–10/2026 p10 −18%, ~6 lệnh/tuần.',
 JSON_OBJECT('side', 'long', 'd1Structure', 'up', 'sweep', JSON_OBJECT('tf', '4h', 'pivotK', 3, 'lookbackBars', 90, 'firstBreakOnly', true, 'maxBarsAgo', 1)), CURRENT_TIMESTAMP(3));
