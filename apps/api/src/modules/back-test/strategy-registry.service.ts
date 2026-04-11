import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import type { IBackTestStrategy } from './strategies/strategy.interface';

@Injectable()
export class StrategyRegistryService implements OnModuleInit {
  private readonly logger = new Logger(StrategyRegistryService.name);
  private readonly registry = new Map<string, IBackTestStrategy>();
  private readonly strategiesDir = path.join(__dirname, 'strategies');

  onModuleInit(): void {
    this.loadStrategies();
  }

  private loadStrategies(): void {
    if (!fs.existsSync(this.strategiesDir)) {
      this.logger.warn(`Strategies directory not found: ${this.strategiesDir}`);
      return;
    }

    const files = fs.readdirSync(this.strategiesDir).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('strategy.interface')
    );

    for (const file of files) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(path.join(this.strategiesDir, file)) as Record<string, unknown>;
        const StrategyClass = (mod['default'] ?? Object.values(mod)[0]) as new () => IBackTestStrategy;

        if (typeof StrategyClass !== 'function') {
          this.logger.warn(`Skipping ${file}: no default or named export`);
          continue;
        }

        const instance = new StrategyClass();

        if (!instance.name || typeof instance.evaluate !== 'function') {
          this.logger.warn(`Skipping ${file}: does not implement IBackTestStrategy`);
          continue;
        }

        this.registry.set(instance.name, instance);
        this.logger.log(`Registered strategy: ${instance.name}`);
      } catch (err) {
        this.logger.error(`Failed to load strategy from ${file}`, err);
      }
    }
  }

  listStrategies(): Array<{ name: string; description: string; defaultTimeframe: string }> {
    return Array.from(this.registry.values()).map((s) => ({
      name: s.name,
      description: s.description,
      defaultTimeframe: s.defaultTimeframe
    }));
  }

  getStrategy(name: string): IBackTestStrategy | undefined {
    return this.registry.get(name);
  }
}
