import { describe, expect, it } from 'vitest';
import { activePayers, hasUnknownPeople, isStale, payerFilterOptions } from './members';
import type { Member, Role } from './types';

const member = (user_id: string, role: Role, removed = false, id = `m-${user_id}`): Member => ({
  id, user_id, role, joined_at: '2026-11-01T00:00:00Z', removed_at: removed ? '2026-11-10T00:00:00Z' : null,
  profile: { display_name: user_id, email: `${user_id}@example.com` },
});

const owner = member('owner', 'owner');
const roommate = member('roommate', 'member');
const viewer = member('viewer', 'viewer');
const gone = member('gone', 'member', true);

describe('people lists', () => {
  it('offers every active Owner/Member as a payer, not Viewers or removed people', () => {
    expect(activePayers([owner, roommate, viewer, gone]).map((m) => m.user_id)).toEqual(['owner', 'roommate']);
  });

  it('lists a new roommate in the "Paid by" filter before they have paid for anything', () => {
    const options = payerFilterOptions([owner, roommate, viewer], [{ paid_by: 'owner' }]);
    expect(options.map((m) => m.user_id)).toEqual(['owner', 'roommate']);
  });

  it('keeps a removed member in the filter for months they paid in, once each', () => {
    const rejoined = member('gone', 'member', false, 'm-gone-2');
    const options = payerFilterOptions([owner, gone, rejoined], [{ paid_by: 'gone' }, { paid_by: 'gone' }]);
    expect(options.map((m) => m.user_id)).toEqual(['owner', 'gone']);
    expect(payerFilterOptions([owner, gone], []).map((m) => m.user_id)).toEqual(['owner']);
  });

  it('spots expenses from someone the loaded list does not know yet', () => {
    expect(hasUnknownPeople([owner], [{ paid_by: 'owner', logged_by: 'owner' }])).toBe(false);
    expect(hasUnknownPeople([owner], [{ paid_by: 'roommate', logged_by: 'roommate' }])).toBe(true);
    expect(hasUnknownPeople([owner], [{ paid_by: 'owner', logged_by: 'roommate' }])).toBe(true);
  });

  it('treats the list as stale after the max age, and a never-loaded list as stale', () => {
    expect(isStale(1_000, 5_000, 10_000)).toBe(false);
    expect(isStale(1_000, 11_000, 10_000)).toBe(true);
    expect(isStale(0, Date.now())).toBe(true);
  });
});
