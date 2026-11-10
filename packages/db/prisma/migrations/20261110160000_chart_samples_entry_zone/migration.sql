-- Entry zone as the user writes it ("150-152", "quanh 0.42", "DCA 3 lần 1.2/1.15/1.1").
ALTER TABLE `chart_samples` ADD COLUMN `entryZone` VARCHAR(120) NULL;
