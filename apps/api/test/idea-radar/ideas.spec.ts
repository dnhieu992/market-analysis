import { DEFAULT_CONFIG, deepMerge, resolveConfig } from '../../src/modules/idea-radar/config';
import {
  buildIdeasPrompt,
  dryRunIdeas,
  generateIdeas,
  resolveEvidence,
  slugify,
  toDrafts,
  type GeneratorInput,
  type IdeasOutput,
} from '../../src/modules/idea-radar/ideas/generator';
import { extractJson, LlmOutputError, mapLimit, RadarLlm, BudgetExceededError, type StructuredAsker } from '../../src/modules/idea-radar/llm';
import { renderReport, renderTelegramSummary, summaryLines, type ReportData } from '../../src/modules/idea-radar/report/render';
import { sendReport, telegramTarget } from '../../src/modules/idea-radar/report/telegram';

const input: GeneratorInput = {
  signals: [{ id: 'sig1', appTitle: 'Receipt Hero', store: 'app_store', signalType: 'rank_jump', value: 40, details: { country: 'us', chart: 'top_free', from: 60, to: 20 }, url: 'https://apps.apple.com/app/id1' }],
  painPoints: [
    { id: 'pp1', appTitle: 'Scanner Pro', summary: 'Quá nhiều quảng cáo', category: 'ads_too_many', frequency: 12, severity: 4, url: 'https://apps.apple.com/app/id2', source: 'review' },
    { id: 'pp2', appTitle: null, summary: 'Cần app tách hoá đơn', category: 'missing_feature', frequency: 2, severity: 4, url: 'https://reddit.com/r/x/1', source: 'post' },
  ],
  posts: [{ id: 'post1', source: 'reddit', title: 'Is there an app to split receipts?', body: 'I would pay', url: 'https://reddit.com/r/x/1', score: null, subreddit: 'AppIdeas' }],
  previous: [{ title: 'Budget Buddy', slug: 'budget-buddy' }],
  profile: DEFAULT_CONFIG.profile,
  count: 3,
};

const idea = (p: Partial<IdeasOutput['ideas'][number]> = {}): IdeasOutput['ideas'][number] => ({
  title: 'Split Snap',
  one_liner: 'Chụp hoá đơn, chia tiền trong 5 giây',
  target_users: 'Nhóm bạn đi ăn',
  problem: 'Chia tiền thủ công mất thời gian',
  solution: 'OCR + chia theo món',
  key_features: ['OCR', 'Chia theo món', 'Gửi link thanh toán'],
  monetization: { model: 'subscription', explanation: '$2.99/tháng' },
  competitors: [{ name: 'Splitwise', weakness: 'Paywall' }],
  evidence: ['P1', 'S1', 'T1'],
  repeat_of: null,
  scores: { demand: 4, competition: 3, monetization: 3, effort: 4 },
  ...p,
});

describe('idea generator', () => {
  it('slugifies Vietnamese titles', () => {
    expect(slugify('Ứng dụng Đếm Bước — PRO!')).toBe('ung-dung-dem-buoc-pro');
  });

  it('builds a prompt with refs, profile and previous ideas', () => {
    const { system, prompt } = buildIdeasPrompt(input);
    expect(system).toContain('3 concrete app ideas');
    expect(system).toContain('Flutter');
    expect(prompt).toContain('- T1 Receipt Hero (app_store): tăng 40 hạng (60 → 20) us/top_free');
    expect(prompt).toContain('- P1 [ads_too_many, 12×, mức 4] Scanner Pro: Quá nhiều quảng cáo');
    expect(prompt).toContain('- P2 [missing_feature, 2×, mức 4] (cộng đồng) Cần app tách hoá đơn');
    expect(prompt).toContain('- S1 [r/AppIdeas] Is there an app to split receipts? — I would pay');
    expect(prompt).toContain('- Budget Buddy');
  });

  it('renders empty sections', () => {
    const { prompt } = buildIdeasPrompt({ ...input, signals: [], painPoints: [], posts: [], previous: [] });
    expect(prompt).toContain('(không có)');
    expect(prompt).toContain('(chưa có)');
  });

  it('resolves refs to evidence with links and drops unknown / duplicate refs', () => {
    const ev = resolveEvidence(['P1', 'p1', 'T1', 'S1', 'X3', 'P9', 'T0'], input);
    expect(ev.map((e) => [e.type, e.id, e.url])).toEqual([
      ['pain_point', 'pp1', 'https://apps.apple.com/app/id2'],
      ['trend_signal', 'sig1', 'https://apps.apple.com/app/id1'],
      ['post', 'post1', 'https://reddit.com/r/x/1'],
    ]);
  });

  it('drops ideas without evidence and flags repeats by title or slug', () => {
    const drafts = toDrafts(
      {
        ideas: [
          idea(),
          idea({ title: 'No proof', evidence: ['Z1'] }),
          idea({ title: 'Budget Buddy 2', repeat_of: 'budget buddy' }),
          idea({ title: 'Budget Buddy', repeat_of: null }),
        ],
      },
      input,
    );
    expect(drafts.map((d) => [d.title, d.repeatOf])).toEqual([
      ['Split Snap', null],
      ['Budget Buddy 2', 'Budget Buddy'],
      ['Budget Buddy', 'Budget Buddy'],
    ]);
    expect(drafts[0]?.evidence).toHaveLength(3);
  });

  it('prefers ideas with ≥ 2 pieces of evidence', () => {
    const solid = Array.from({ length: 5 }, (_, i) => idea({ title: `Solid ${i}` }));
    const drafts = toDrafts({ ideas: [...solid, idea({ title: 'Thin', evidence: ['P1'] })] }, input);
    expect(drafts.map((d) => d.title)).not.toContain('Thin');
    // Too few solid ones → keep the thin ones.
    expect(toDrafts({ ideas: [idea({ title: 'Thin', evidence: ['P1'] })] }, input)).toHaveLength(1);
  });

  it('dry-run ideas cite a pain point plus a signal / post', async () => {
    const drafts = await generateIdeas(null, input, 'smart');
    expect(drafts.length).toBe(2);
    expect(drafts[0]?.evidence.map((e) => e.type)).toEqual(['pain_point', 'trend_signal']);
    expect(drafts[1]?.evidence.map((e) => e.type)).toEqual(['pain_point', 'post']);
    expect(dryRunIdeas({ ...input, painPoints: [] })).toEqual([]);
  });

  it('calls the smart model through RadarLlm', async () => {
    const ask: StructuredAsker = {
      askStructured: async (_s, _p, schema) => {
        expect(schema).toHaveProperty('properties.ideas');
        return { structuredOutput: { ideas: [idea()] }, text: '', costUsd: 0.2, inputTokens: 1, outputTokens: 1, model: 'smart' };
      },
    };
    const llm = new RadarLlm(ask, { monthCostUsd: async () => 0, recordUsage: async () => undefined }, 20);
    const drafts = await generateIdeas(llm, input, 'smart');
    expect(drafts[0]?.title).toBe('Split Snap');
  });
});

describe('RadarLlm', () => {
  const sink = { monthCostUsd: async () => 0, recordUsage: async () => undefined };

  it('retries once with the validation errors, then gives up', async () => {
    const prompts: string[] = [];
    const ask: StructuredAsker = {
      askStructured: async (_s, p) => {
        prompts.push(p);
        return { structuredOutput: { ideas: 'nope' }, text: '', costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'm' };
      },
    };
    await expect(generateIdeas(new RadarLlm(ask, sink, 20), input, 'm')).rejects.toBeInstanceOf(LlmOutputError);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('KHÔNG hợp lệ');
  });

  it('falls back to JSON in the text reply', async () => {
    const ask: StructuredAsker = {
      askStructured: async () => ({ structuredOutput: null, text: `Here:\n${JSON.stringify({ ideas: [idea()] })}`, costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'm' }),
    };
    expect(await generateIdeas(new RadarLlm(ask, sink, 20), input, 'm')).toHaveLength(1);
  });

  it('refuses over budget', async () => {
    const llm = new RadarLlm({ askStructured: jest.fn() }, { monthCostUsd: async () => 21, recordUsage: async () => undefined }, 20);
    await expect(llm.assertBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('extractJson / mapLimit helpers', async () => {
    expect(extractJson('x {"a":1} y')).toEqual({ a: 1 });
    expect(extractJson('no json')).toBeNull();
    expect(extractJson('{broken')).toBeNull();
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe('config', () => {
  it('merges a partial stored config over the defaults', () => {
    const cfg = resolveConfig({ scoring: { ideas_per_report: 5 }, sources: { reddit: { enabled: false } } });
    expect(cfg.scoring.ideas_per_report).toBe(5);
    expect(cfg.scoring.weights.demand).toBe(0.35);
    expect(cfg.sources.reddit.enabled).toBe(false);
    expect(cfg.sources.reddit.subreddits).toContain('SideProject');
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it('rejects bad values', () => {
    expect(() => resolveConfig({ sources: { app_store: { countries: ['USA'] } } })).toThrow();
  });

  it('replaces arrays instead of merging them', () => {
    expect(deepMerge({ a: [1, 2], b: { c: 1 } }, { a: [3] })).toEqual({ a: [3], b: { c: 1 } });
  });
});

const reportData = (p: Partial<ReportData> = {}): ReportData => ({
  runDate: '2026-11-16',
  dryRun: false,
  stats: { appsTracked: 420, snapshots: 900, reviewsAnalyzed: 3100, postsAnalyzed: 85, signals: 12, painPoints: 30, llmCostUsd: 1.234 },
  ideas: [
    {
      ...toDrafts({ ideas: [idea()] }, input)[0]!,
      scores: { demand: 4, competition: 3, monetization: 3, effort: 4, total: 3.5 },
    },
    {
      ...toDrafts({ ideas: [idea({ title: 'Budget | Buddy', repeat_of: 'Budget Buddy' })] }, input)[0]!,
      scores: { demand: 3, competition: 3, monetization: 3, effort: 3, total: 3 },
    },
  ],
  trends: [{ appTitle: 'Receipt Hero', store: 'app_store', url: 'https://apps.apple.com/app/id1', signalType: 'rank_jump', value: 40, details: { country: 'us', chart: 'top_free', from: 60, to: 20 } }],
  painPoints: [{ appTitle: 'Scanner Pro', summary: 'Quá nhiều quảng cáo', category: 'ads_too_many', frequency: 12, severity: 4, quotes: ['ads | everywhere'] }],
  errors: [{ source: 'reddit', message: 'HTTP 429' }],
  ...p,
});

describe('report', () => {
  it('renders every section in order', () => {
    const md = renderReport(reportData());
    const order = ['# App Idea Radar — 2026-11-16', '## Tóm tắt kỳ này', '## Top ý tưởng', '## Xu hướng đáng chú ý', '## Pain point lớn nhất', '## Ý tưởng lặp lại', '## Lỗi thu thập'];
    let last = -1;
    for (const h of order) {
      const i = md.indexOf(h);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
    expect(md).toContain('### 1. Split Snap');
    expect(md).toContain('**Điểm 3.50** · nhu cầu 4 · cạnh tranh 3 · kiếm tiền 3 · công sức 4');
    expect(md).toContain('- [Scanner Pro: Quá nhiều quảng cáo (12×)](https://apps.apple.com/app/id2)');
    expect(md).toContain('| [Receipt Hero](https://apps.apple.com/app/id1) | App Store | Tăng hạng | +40 hạng (#60 → #20) · US · top_free |');
    expect(md).toContain('ads \\| everywhere');
    expect(md).toContain('- **Budget | Buddy** (3 điểm) — trước đây: Budget Buddy');
    expect(md).toContain('- **reddit:** HTTP 429');
    expect(md).toContain('$1.23');
  });

  it('handles an empty run and dry-run', () => {
    const md = renderReport(reportData({ dryRun: true, ideas: [], trends: [], painPoints: [], errors: [], stats: { ...reportData().stats, llmCostUsd: 0 } }));
    expect(md).toContain('(dry-run)');
    expect(md).toContain('_Không có ý tưởng nào kỳ này._');
    expect(md).toContain('cần ít nhất 2 kỳ dữ liệu');
    expect(md).not.toContain('## Lỗi thu thập');
  });

  it('summary mentions the top idea, strongest trend and errors', () => {
    const lines = summaryLines(reportData());
    expect(lines).toHaveLength(5);
    expect(lines[2]).toContain('Split Snap');
  });

  it('telegram summary is HTML-escaped and short', () => {
    const html = renderTelegramSummary(reportData({ pageUrl: 'https://x.test/idea-radar' }));
    expect(html).toContain('<b>1. Split Snap</b> — 3.50đ');
    expect(html).toContain('🔁');
    expect(html).toContain('<a href="https://x.test/idea-radar">');
    expect(html.length).toBeLessThan(4096);
    expect(renderTelegramSummary(reportData({ ideas: [] }))).toContain('Không có ý tưởng');
  });
});

describe('telegram notifier', () => {
  it('needs its own chat id', () => {
    expect(telegramTarget({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'trading' })).toBeNull();
    expect(telegramTarget({ TELEGRAM_BOT_TOKEN: 't', IDEA_RADAR_TELEGRAM_CHAT_ID: '42' })).toEqual({ token: 't', chatId: '42' });
    expect(telegramTarget({ TELEGRAM_BOT_TOKEN: 't', IDEA_RADAR_TELEGRAM_BOT_TOKEN: 'own', IDEA_RADAR_TELEGRAM_CHAT_ID: '42' })).toEqual({ token: 'own', chatId: '42' });
  });

  it('sends the summary then the document, and hides the token on errors', async () => {
    const calls: string[] = [];
    const ok = async (url: string) => {
      calls.push(url.split('/').pop() as string);
      return new Response(JSON.stringify({ ok: true }));
    };
    await sendReport({ token: 'SECRET', chatId: '1' }, '<b>x</b>', 'r.md', '# r', ok);
    expect(calls).toEqual(['sendMessage', 'sendDocument']);

    const fail = async () => new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 });
    await expect(sendReport({ token: 'SECRET', chatId: '1' }, 'x', 'r.md', '# r', fail)).rejects.toThrow(/chat not found/);
    await expect(sendReport({ token: 'SECRET', chatId: '1' }, 'x', 'r.md', '# r', fail)).rejects.not.toThrow(/SECRET/);
  });
});
