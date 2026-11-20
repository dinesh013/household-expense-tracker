import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  collectSources, dataRange, generateInsight, InsightError, requestParams, summarise, validateInsight,
  type InsightInput,
} from '../supabase/functions/ai-insight/insight.ts';

const cats = [{ id: 'g', name: 'Groceries' }, { id: 'r', name: 'Rent' }, { id: 'd', name: 'Dining & Takeaway' }];
const good = {
  category: 'Groceries', headline: 'Groceries ₹3,000 over a typical Velachery flat',
  tips: ['Buy veggies at Velachery market', 'Plan meals weekly'], funny: 'Your fridge eats better than most of Velachery.',
  benchmark_note: 'Typical 2-person Chennai grocery spend ~₹8,000/month (2025)',
};
const msg = (stop: string, content: unknown[]) => ({ stop_reason: stop, content }) as unknown as Anthropic.Beta.BetaMessage;
const input = { categories: [] } as unknown as InsightInput;

describe('AI insight data', () => {
  it('loads the 3 months before plus the chosen month', () => {
    expect(dataRange({ year: 2026, month: 2 })).toEqual({ from: '2025-11-01', to: '2026-03-01' });
  });

  it('summarises this month against the household average, in rupees, biggest first', () => {
    const s = summarise([
      { amount: '1000.50', category_id: 'g', expense_date: '2026-11-03' },
      { amount: 500, category_id: 'g', expense_date: '2026-11-10' },
      { amount: 15000, category_id: 'r', expense_date: '2026-11-01' },
      { amount: 1200, category_id: 'g', expense_date: '2026-10-05' },
      { amount: 800, category_id: 'g', expense_date: '2026-09-05' },
    ], cats, { year: 2026, month: 11 }, 2, '2026-11-20');
    expect(s.categories).toEqual([
      { name: 'Rent', this_month: 15000, avg_previous_months: 0 },
      { name: 'Groceries', this_month: 1500.5, avg_previous_months: 1000 },
    ]);
    expect([s.month, s.days_of_data, s.days_in_month, s.people_sharing, s.total_this_month]).toEqual(['November 2026', 20, 30, 2, 16500.5]);
  });

  it('a past month counts every day; no history means no average', () => {
    const s = summarise([{ amount: 10, category_id: 'd', expense_date: '2026-10-01' }], cats, { year: 2026, month: 10 }, 3, '2026-11-20');
    expect([s.days_of_data, s.categories]).toEqual([31, [{ name: 'Dining & Takeaway', this_month: 10, avg_previous_months: null }]]);
  });
});

describe('AI insight output', () => {
  it('accepts a complete insight and trims spacing', () => {
    expect(validateInsight({ ...good, funny: '  Your fridge   eats well. ' })?.funny).toBe('Your fridge eats well.');
  });

  it('rejects missing, empty or oversized fields', () => {
    expect(validateInsight({ ...good, tips: [] })).toBeNull();
    expect(validateInsight({ ...good, tips: ['a', 'b', 'c', 'd'] })).toBeNull();
    expect(validateInsight({ ...good, headline: 'x'.repeat(200) })).toBeNull();
    expect(validateInsight({ ...good, funny: '' })).toBeNull();
    expect(validateInsight('nope')).toBeNull();
  });

  it('keeps only https sources from successful searches, at most 3', () => {
    const s = collectSources([
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      { type: 'web_search_tool_result', content: [
        { url: 'javascript:alert(1)', title: 'bad' }, { url: 'http://plain.example', title: 'http' },
        { url: 'https://a.example/x', title: 'A' }, { url: 'https://a.example/x', title: 'dup' },
        { url: 'https://b.example', title: '' }, { url: 'https://c.example', title: 'C' }, { url: 'https://d.example', title: 'D' },
      ] },
    ]);
    expect(s).toEqual([{ url: 'https://a.example/x', title: 'A' }, { url: 'https://b.example', title: 'b.example' }, { url: 'https://c.example', title: 'C' }]);
  });

  it('asks for web search near Chennai and the submit tool, with refusal fallback on', () => {
    const p = requestParams();
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.fallbacks).toBe('default');
    expect(JSON.stringify(p.tools)).toContain('"city":"Chennai"');
    expect(p.tools?.map((t) => t.name)).toEqual(['web_search', 'submit_insight']);
  });
});

describe('AI insight conversation', () => {
  it('continues a paused web search, then returns the submitted insight with sources', async () => {
    const calls: number[] = [];
    const replies = [
      msg('pause_turn', [{ type: 'web_search_tool_result', content: [{ url: 'https://stats.example', title: 'Chennai costs' }] }]),
      msg('tool_use', [{ type: 'tool_use', id: 't1', name: 'submit_insight', input: good }]),
    ];
    const out = await generateInsight(async (p) => { calls.push(p.messages.length); return replies.shift()!; }, input);
    expect(calls).toEqual([1, 2]); // the paused assistant turn was sent back
    expect(out.sources).toEqual([{ url: 'https://stats.example', title: 'Chennai costs' }]);
    expect(out.category).toBe('Groceries');
  });

  it('nudges once if it ends without the tool, then gives up', async () => {
    let n = 0;
    await expect(generateInsight(async () => { n++; return msg('end_turn', [{ type: 'text', text: 'hi' }]); }, input))
      .rejects.toBeInstanceOf(InsightError);
    expect(n).toBe(2);
  });

  it('a refusal or a bad insight becomes a friendly error', async () => {
    await expect(generateInsight(async () => msg('refusal', []), input)).rejects.toThrow(/couldn't write/);
    await expect(generateInsight(async () => msg('tool_use', [{ type: 'tool_use', id: 't', name: 'submit_insight', input: { category: 'x' } }]), input))
      .rejects.toThrow(/incomplete/);
  });
});
