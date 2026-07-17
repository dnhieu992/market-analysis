import { diffLines, diffStat } from './diff-lines';

describe('diffLines', () => {
  it('marks appended lines as additions and keeps the shared prefix', () => {
    const prev = '## Bối cảnh\nBTC giữ EMA200';
    const next = '## Bối cảnh\nBTC giữ EMA200\nVào lệnh long 0.02';

    expect(diffLines(prev, next)).toEqual([
      { type: 'same', text: '## Bối cảnh' },
      { type: 'same', text: 'BTC giữ EMA200' },
      { type: 'add', text: 'Vào lệnh long 0.02' },
    ]);
  });

  it('marks an edited line as a delete plus an add', () => {
    const out = diffLines('SL 115000', 'SL 116500');
    expect(out).toEqual([
      { type: 'del', text: 'SL 115000' },
      { type: 'add', text: 'SL 116500' },
    ]);
  });

  it('treats the first save (no previous snapshot) as all additions', () => {
    expect(diffLines('', 'dòng đầu')).toEqual([
      { type: 'del', text: '' },
      { type: 'add', text: 'dòng đầu' },
    ]);
  });

  it('detects an insertion in the middle without rewriting the tail', () => {
    const out = diffLines('a\nc', 'a\nb\nc');
    expect(out).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('normalises CRLF so a paste does not read as a full rewrite', () => {
    expect(diffLines('a\r\nb', 'a\nb').every((l) => l.type === 'same')).toBe(true);
  });
});

describe('diffStat', () => {
  it('counts real lines and reports the first added line as the headline', () => {
    const prev = 'mở đầu\ncũ';
    const next = 'mở đầu\n\n**Chốt lời 1/2 vị thế**\nthêm nữa';

    expect(diffStat(prev, next)).toEqual({
      added: 2,
      removed: 1,
      firstAdded: 'Chốt lời 1/2 vị thế',
    });
  });

  it('ignores blank-line churn', () => {
    expect(diffStat('a\nb', 'a\n\n\nb')).toEqual({ added: 0, removed: 0, firstAdded: null });
  });

  it('reports nothing added when a save only removes lines', () => {
    const stat = diffStat('giữ lại\nbỏ đi', 'giữ lại');
    expect(stat.added).toBe(0);
    expect(stat.removed).toBe(1);
    expect(stat.firstAdded).toBeNull();
  });
});
