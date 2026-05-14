import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import {
  DCA_PLAN_REPOSITORY,
  DCA_PLAN_ITEM_REPOSITORY
} from '../database/database.providers';
import { TransactionService } from '../transaction/transaction.service';
import type { CreatePlanItemDto } from './dto/create-plan-item.dto';
import type { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import type { ExecutePlanItemDto } from './dto/execute-plan-item.dto';

type DcaPlanRepository = ReturnType<typeof import('@app/db').createDcaPlanRepository>;
type DcaPlanItemRepository = ReturnType<typeof import('@app/db').createDcaPlanItemRepository>;

export type LlmPlanItem = {
  type: 'buy' | 'sell';
  targetPrice: number;
  suggestedAmount: number;
  note: string;
};

@Injectable()
export class DcaPlanService {
  constructor(
    @Inject(DCA_PLAN_REPOSITORY)
    private readonly planRepository: DcaPlanRepository,
    @Inject(DCA_PLAN_ITEM_REPOSITORY)
    private readonly itemRepository: DcaPlanItemRepository,
    private readonly transactionService: TransactionService
  ) {}

  getActivePlan(dcaConfigId: string) {
    return this.planRepository.findActiveByConfigId(dcaConfigId);
  }

  getArchivedPlans(dcaConfigId: string) {
    return this.planRepository.listArchivedByConfigId(dcaConfigId);
  }

  async createPlanWithItems(dcaConfigId: string, llmAnalysis: string, items: LlmPlanItem[]) {
    // Archive any existing active plan
    await this.planRepository.archiveActive(dcaConfigId);

    const planId = randomUUID();
    await this.planRepository.create({
      id: planId,
      dcaConfigId,
      status: 'active',
      llmAnalysis
    });

    if (items.length > 0) {
      await this.itemRepository.createMany(
        items.map((item) => ({
          id: randomUUID(),
          dcaPlanId: planId,
          type: item.type,
          targetPrice: new Decimal(item.targetPrice),
          suggestedAmount: new Decimal(item.suggestedAmount),
          note: item.note || null,
          source: 'llm',
          status: 'pending'
        }))
      );
    }

    return this.planRepository.findActiveByConfigId(dcaConfigId);
  }

  async updateAnalysis(planId: string, llmAnalysis: string) {
    return this.planRepository.updateAnalysis(planId, llmAnalysis);
  }

  // --- Plan Item CRUD ---

  async addItem(planId: string, input: CreatePlanItemDto) {
    const plan = await this.planRepository.findById(planId);
    if (!plan || plan.status !== 'active') {
      throw new NotFoundException('Active plan not found');
    }

    return this.itemRepository.create({
      id: randomUUID(),
      dcaPlanId: planId,
      type: input.type,
      targetPrice: new Decimal(input.targetPrice),
      suggestedAmount: new Decimal(input.suggestedAmount),
      note: input.note || null,
      source: 'user',
      status: 'pending'
    });
  }

  async editItem(itemId: string, input: UpdatePlanItemDto) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');

    const updateData: Record<string, unknown> = {};

    if (input.type !== undefined) updateData.type = input.type;
    if (input.note !== undefined) updateData.note = input.note;

    if (input.targetPrice !== undefined) {
      updateData.targetPrice = new Decimal(input.targetPrice);
    }
    if (input.suggestedAmount !== undefined) {
      updateData.suggestedAmount = new Decimal(input.suggestedAmount);
    }

    // Track original values on first edit of an LLM item
    if (item.source === 'llm' && !item.userModified) {
      updateData.userModified = true;
      updateData.originalTargetPrice = item.targetPrice;
      updateData.originalSuggestedAmount = item.suggestedAmount;
    }

    return this.itemRepository.update(itemId, updateData);
  }

  async deleteItem(itemId: string) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');

    if (item.source === 'llm') {
      // Soft delete — keep for LLM context
      return this.itemRepository.update(itemId, { deletedByUser: true });
    }

    // Hard delete user-created items
    return this.itemRepository.hardDelete(itemId);
  }

  async skipItem(itemId: string) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');
    return this.itemRepository.update(itemId, { status: 'skipped' });
  }

  async executeItem(
    itemId: string,
    input: ExecutePlanItemDto,
    portfolioId: string,
    coinId: string
  ) {
    const item = await this.itemRepository.findById(itemId);
    if (!item) throw new NotFoundException('Plan item not found');
    if (item.status === 'executed') {
      throw new BadRequestException('Item already executed');
    }

    const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();

    // Update plan item
    await this.itemRepository.update(itemId, {
      status: 'executed',
      executedPrice: new Decimal(input.executedPrice),
      executedAmount: new Decimal(input.executedAmount),
      executedAt
    });

    // Create portfolio transaction
    await this.transactionService.createTransaction(portfolioId, {
      coinId,
      type: item.type as 'buy' | 'sell',
      price: input.executedPrice,
      amount: input.executedAmount,
      transactedAt: executedAt.toISOString(),
      note: `DCA ${item.type} — ${item.note || 'plan item executed'}`
    });

    return this.itemRepository.findById(itemId);
  }

  /** Get all items including soft-deleted for LLM context */
  getAllItemsForLlm(planId: string) {
    return this.itemRepository.listByPlanId(planId, true);
  }
}
