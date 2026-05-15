import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Inject, Param, Patch, Post, Req
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { MarketDataService } from '../market/market-data.service';
import { DcaService } from './dca.service';
import { DcaPlanService } from './dca-plan.service';
import { DcaLlmService } from './dca-llm.service';
import { CreateDcaConfigDto } from './dto/create-dca-config.dto';
import { UpdateDcaConfigDto } from './dto/update-dca-config.dto';
import { CreatePlanItemDto } from './dto/create-plan-item.dto';
import { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import { ExecutePlanItemDto } from './dto/execute-plan-item.dto';

@ApiTags('DCA')
@ApiCookieAuth('market_analysis_session')
@Controller('dca')
export class DcaController {
  constructor(
    @Inject(DcaService)
    private readonly dcaService: DcaService,
    @Inject(DcaPlanService)
    private readonly planService: DcaPlanService,
    @Inject(DcaLlmService)
    private readonly llmService: DcaLlmService,
    @Inject(MarketDataService)
    private readonly marketDataService: MarketDataService
  ) {}

  // --- Config CRUD ---

  @Get('config')
  @ApiOperation({ summary: 'List all DCA configs with plan summary' })
  async listConfigs(@Req() req: AuthenticatedRequest) {
    const configs = await this.dcaService.listConfigs(req.authUser!.id);
    return Promise.all(
      configs.map(async (config) => {
        try {
          const [plan, capital] = await Promise.all([
            this.planService.getActivePlan(config.id),
            this.dcaService.getCapitalState(config)
          ]);
          const pendingItems = plan?.items.filter((i) => i.status === 'pending') ?? [];
          return {
            ...config,
            planId: plan?.id ?? null,
            pendingBuyCount: pendingItems.filter((i) => i.type === 'buy').length,
            pendingSellCount: pendingItems.filter((i) => i.type === 'sell').length,
            capital
          };
        } catch {
          return {
            ...config,
            planId: null,
            pendingBuyCount: 0,
            pendingSellCount: 0,
            capital: {
              totalBudget: Number(config.totalBudget),
              deployedAmount: 0,
              remaining: Number(config.totalBudget),
              runnerAmount: 0,
              runnerAvgCost: 0
            }
          };
        }
      })
    );
  }

  @Post('config')
  @ApiOperation({ summary: 'Create a DCA config for a coin' })
  createConfig(@Req() req: AuthenticatedRequest, @Body() body: CreateDcaConfigDto) {
    return this.dcaService.createConfig(req.authUser!.id, body);
  }

  @Patch('config/:id')
  @ApiOperation({ summary: 'Update DCA config (totalBudget or portfolioId)' })
  updateConfig(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateDcaConfigDto
  ) {
    return this.dcaService.updateConfig(id, req.authUser!.id, body);
  }

  // --- Plan ---

  @Get('config/:configId/plan/active')
  @ApiOperation({ summary: 'Get active plan + items' })
  async getActivePlan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const plan = await this.planService.getActivePlan(config.id);
    const capital = await this.dcaService.getCapitalState(config);
    return { config, plan, capital };
  }

  @Get('config/:configId/plan/history')
  @ApiOperation({ summary: 'List archived plans' })
  async getPlanHistory(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    return this.planService.getArchivedPlans(config.id);
  }

  @Delete('config/:configId/plan/active')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard delete the active plan and all its items' })
  async deleteActivePlan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const plan = await this.planService.getActivePlan(config.id);
    if (!plan) return { error: 'No active plan' };
    return this.planService.deletePlan(plan.id);
  }

  @Post('config/:configId/plan/generate')
  @ApiOperation({ summary: 'Generate first plan (LLM)' })
  async generatePlan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const capital = await this.dcaService.getCapitalState(config);
    const symbol = `${config.coin}USDT`;

    const [dailyCandles, weeklyCandles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 90),
      this.marketDataService.getCandles(symbol, '1w', 26)
    ]);

    const result = await this.llmService.generatePlan(
      config.coin, capital, dailyCandles, weeklyCandles
    );

    if (!result) {
      return { error: 'LLM generation failed. Try again.' };
    }

    return this.planService.createPlanWithItems(config.id, result.llmAnalysis, result.items);
  }

  @Post('config/:configId/plan/replan')
  @ApiOperation({ summary: 'Archive current plan + generate improved plan' })
  async replan(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const capital = await this.dcaService.getCapitalState(config);
    const symbol = `${config.coin}USDT`;

    const activePlan = await this.planService.getActivePlan(config.id);
    const currentItems = activePlan
      ? (await this.planService.getAllItemsForLlm(activePlan.id)).map(mapItemToContext)
      : [];

    const archivedPlans = (await this.planService.getArchivedPlans(config.id)).map((p) => ({
      createdAt: p.createdAt.toISOString(),
      archivedAt: p.archivedAt?.toISOString() ?? null,
      executedItems: p.items
        .filter((i) => i.status === 'executed')
        .map(mapItemToContext)
    }));

    const [dailyCandles, weeklyCandles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 90),
      this.marketDataService.getCandles(symbol, '1w', 26)
    ]);

    const result = await this.llmService.replan(
      config.coin, capital, dailyCandles, weeklyCandles, currentItems, archivedPlans
    );

    if (!result) {
      return { error: 'LLM re-plan failed. Try again.' };
    }

    return this.planService.createPlanWithItems(config.id, result.llmAnalysis, result.items);
  }

  @Post('config/:configId/plan/reanalyze')
  @ApiOperation({ summary: 'Update LLM analysis only, keep plan unchanged' })
  async reanalyze(
    @Param('configId') configId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const config = await this.dcaService.getConfig(configId, req.authUser!.id);
    const capital = await this.dcaService.getCapitalState(config);
    const symbol = `${config.coin}USDT`;

    const activePlan = await this.planService.getActivePlan(config.id);
    if (!activePlan) {
      return { error: 'No active plan to re-analyze' };
    }

    const currentItems = (await this.planService.getAllItemsForLlm(activePlan.id)).map(mapItemToContext);

    const [dailyCandles, weeklyCandles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 90),
      this.marketDataService.getCandles(symbol, '1w', 26)
    ]);

    const result = await this.llmService.reanalyze(
      config.coin, capital, dailyCandles, weeklyCandles, currentItems
    );

    if (!result) {
      return { error: 'LLM re-analyze failed. Try again.' };
    }

    await this.planService.updateAnalysis(activePlan.id, result.llmAnalysis);
    return this.planService.getActivePlan(config.id);
  }

  // --- Plan Items ---

  @Post('plan/:planId/items')
  @ApiOperation({ summary: 'Add item manually' })
  async addItem(
    @Param('planId') planId: string,
    @Body() body: CreatePlanItemDto,
    @Req() req: AuthenticatedRequest
  ) {
    const plan = await this.planService.getPlanById(planId);
    if (!plan) return { error: 'Plan not found' };
    await this.dcaService.getConfig(plan.dcaConfigId, req.authUser!.id);
    return this.planService.addItem(planId, body);
  }

  @Patch('plan/:planId/items/:itemId')
  @ApiOperation({ summary: 'Edit item' })
  async editItem(
    @Param('itemId') itemId: string,
    @Body() body: UpdatePlanItemDto,
    @Req() req: AuthenticatedRequest
  ) {
    const plan = await this.planService.getPlanByItemId(itemId);
    if (!plan) return { error: 'Plan not found' };
    await this.dcaService.getConfig(plan.dcaConfigId, req.authUser!.id);
    return this.planService.editItem(itemId, body);
  }

  @Delete('plan/:planId/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete item (soft for LLM, hard for user)' })
  async deleteItem(
    @Param('itemId') itemId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const plan = await this.planService.getPlanByItemId(itemId);
    if (!plan) return { error: 'Plan not found' };
    await this.dcaService.getConfig(plan.dcaConfigId, req.authUser!.id);
    return this.planService.deleteItem(itemId);
  }

  @Post('plan/:planId/items/:itemId/execute')
  @ApiOperation({ summary: 'Mark item as executed + create Portfolio transaction' })
  async executeItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() body: ExecutePlanItemDto,
    @Req() req: AuthenticatedRequest
  ) {
    // Resolve config from plan → config chain
    const plan = await this.planService.getPlanById(planId);
    if (!plan) return { error: 'Plan not found' };

    const config = await this.dcaService.getConfig(plan.dcaConfigId, req.authUser!.id);

    return this.planService.executeItem(itemId, body, config.portfolioId, config.coin);
  }

  @Patch('plan/:planId/items/:itemId/skip')
  @ApiOperation({ summary: 'Mark item as skipped' })
  async skipItem(
    @Param('itemId') itemId: string,
    @Req() req: AuthenticatedRequest
  ) {
    const plan = await this.planService.getPlanByItemId(itemId);
    if (!plan) return { error: 'Plan not found' };
    await this.dcaService.getConfig(plan.dcaConfigId, req.authUser!.id);
    return this.planService.skipItem(itemId);
  }
}

function mapItemToContext(item: {
  type: string;
  targetPrice: { toNumber?: () => number } | number;
  suggestedAmount: { toNumber?: () => number } | number;
  note: string | null;
  status: string;
  source: string;
  userModified: boolean;
  deletedByUser: boolean;
  originalTargetPrice?: { toNumber?: () => number } | number | null;
  originalSuggestedAmount?: { toNumber?: () => number } | number | null;
  executedPrice?: { toNumber?: () => number } | number | null;
  executedAmount?: { toNumber?: () => number } | number | null;
}) {
  const toNum = (v: { toNumber?: () => number } | number | null | undefined) =>
    v == null ? null : typeof v === 'number' ? v : v.toNumber?.() ?? Number(v);

  return {
    type: item.type,
    targetPrice: toNum(item.targetPrice)!,
    suggestedAmount: toNum(item.suggestedAmount)!,
    note: item.note,
    status: item.status,
    source: item.source,
    userModified: item.userModified,
    deletedByUser: item.deletedByUser,
    originalTargetPrice: toNum(item.originalTargetPrice),
    originalSuggestedAmount: toNum(item.originalSuggestedAmount),
    executedPrice: toNum(item.executedPrice),
    executedAmount: toNum(item.executedAmount)
  };
}
