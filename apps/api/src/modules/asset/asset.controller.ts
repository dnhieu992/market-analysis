import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AssetService } from './asset.service';
import { CreateAssetCategoryDto } from './dto/create-asset-category.dto';
import { CreateAssetTransactionDto } from './dto/create-asset-transaction.dto';
import { UpdateAssetCategoryDto } from './dto/update-asset-category.dto';

@ApiTags('My Asset')
@ApiCookieAuth('market_analysis_session')
@Controller('asset')
export class AssetController {
  constructor(
    @Inject(AssetService)
    private readonly service: AssetService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Total USDT, per-category balances and the recent ledger' })
  getSummary() {
    return this.service.getSummary();
  }

  @Post('categories')
  @ApiOperation({ summary: 'Add an asset category (bucket)' })
  createCategory(@Body() body: CreateAssetCategoryDto) {
    return this.service.createCategory(body);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Rename or reorder an asset category' })
  updateCategory(@Param('id') id: string, @Body() body: UpdateAssetCategoryDto) {
    return this.service.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Delete an asset category (only when it has no transactions)' })
  deleteCategory(@Param('id') id: string) {
    return this.service.deleteCategory(id);
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Record a deposit, withdrawal or transfer in USDT' })
  createTransaction(@Body() body: CreateAssetTransactionDto) {
    return this.service.createTransaction(body);
  }

  @Delete('transactions/:id')
  @ApiOperation({ summary: 'Delete a ledger entry and revert its effect on the balances' })
  deleteTransaction(@Param('id') id: string) {
    return this.service.deleteTransaction(id);
  }
}
