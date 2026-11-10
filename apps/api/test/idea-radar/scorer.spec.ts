import { adjustCompetition, adjustDemand, rankByScore, scoreIdea, weightedTotal, type ScoreEvidence } from '../../src/modules/idea-radar/ideas/scorer';

const W = { demand: 0.35, competition: 0.25, monetization: 0.25, effort: 0.15 };
const ev = (p: Partial<ScoreEvidence> = {}): ScoreEvidence => ({ painPoints: [], signalCount: 0, postCount: 0, competitors: [], ...p });

describe('scorer', () => {
  it('weights the four scores', () => {
    expect(weightedTotal({ demand: 5, competition: 5, monetization: 5, effort: 5 }, W)).toBe(5);
    expect(weightedTotal({ demand: 4, competition: 3, monetization: 2, effort: 1 }, W)).toBe(2.8);
  });

  describe('demand', () => {
    it('penalises thin evidence', () => {
      expect(adjustDemand(3, ev({ signalCount: 1 }))).toBe(2.5);
    });
    it('rewards many refs and a high review frequency', () => {
      const e = ev({ painPoints: [{ frequency: 15, severity: 4 }, { frequency: 10, severity: 3 }], signalCount: 1, postCount: 1 });
      expect(adjustDemand(3, e)).toBe(4);
    });
    it('gives a small bonus for medium frequency', () => {
      expect(adjustDemand(3, ev({ painPoints: [{ frequency: 9, severity: 2 }], postCount: 1 }))).toBe(3.25);
    });
    it('clamps to 1–5', () => {
      expect(adjustDemand(5, ev({ painPoints: Array(5).fill({ frequency: 30, severity: 5 }) }))).toBe(5);
      expect(adjustDemand(1, ev())).toBe(1);
    });
  });

  describe('competition', () => {
    it('is unchanged without known competitors', () => {
      expect(adjustCompetition(3, ev())).toBe(3);
      expect(adjustCompetition(3, ev({ competitors: [{ rating: null, ratingCount: null, ratingDrop: false }] }))).toBe(3);
    });
    it('drops for a strong incumbent', () => {
      expect(adjustCompetition(3, ev({ competitors: [{ rating: 4.7, ratingCount: 2_000_000, ratingDrop: false }] }))).toBe(2);
    });
    it('rises when all competitors are weak or one is dropping', () => {
      expect(adjustCompetition(3, ev({ competitors: [{ rating: 3.2, ratingCount: 5000, ratingDrop: false }] }))).toBe(3.5);
      expect(adjustCompetition(3, ev({ competitors: [{ rating: 4.2, ratingCount: 5000, ratingDrop: true }] }))).toBe(3.5);
    });
  });

  it('scoreIdea clamps raw scores and totals them', () => {
    const s = scoreIdea({ demand: 4, competition: 9, monetization: 0, effort: 5 }, ev({ signalCount: 1, postCount: 1 }), W);
    expect(s).toEqual({ demand: 4, competition: 5, monetization: 1, effort: 5, total: 3.65 });
  });

  it('ranks by total then demand, and limits', () => {
    const mk = (id: string, total: number, demand: number) => ({ id, scores: { total, demand, competition: 0, monetization: 0, effort: 0 } });
    const out = rankByScore([mk('a', 3, 3), mk('b', 4, 2), mk('c', 3, 4), mk('d', 1, 1)], 3);
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});
