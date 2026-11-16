'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '@/components/ui/form';
import { SearchInput } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { usePermission } from '@/lib/session';
import type { Page, UserRow } from '@/lib/types';

interface UserPickerProps {
  id?: string;
  value: string;
  onChange: (userId: string) => void;
  excludeIds?: string[];
  placeholder?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Search active users of the current company (requires `user.read`). */
export function UserPicker({ id, value, onChange, excludeIds = [], placeholder = 'Select a person', ...aria }: UserPickerProps) {
  const canRead = usePermission('user.read');
  const [q, setQ] = useState('');
  const users = useQuery({
    queryKey: ['users', 'picker', q],
    queryFn: () => get<Page<UserRow>>('/users', { status: 'ACTIVE', q, limit: 50 }),
    enabled: canRead,
  });
  if (!canRead) return <p className="text-sm text-fg-muted">You need permission to view users to pick a person.</p>;
  const options = (users.data?.items ?? []).filter((u) => !excludeIds.includes(u.id));
  return (
    <div className="flex flex-col gap-2">
      <SearchInput value={q} onChange={setQ} placeholder="Search by name or email" className="sm:w-full" label="Search people" />
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={users.isLoading} {...aria}>
        <option value="">{users.isLoading ? 'Loading…' : placeholder}</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName} — {u.email}
          </option>
        ))}
      </Select>
    </div>
  );
}

interface EligibleApprover {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
}

/**
 * Picks an active approver of the current company via
 * GET /approvals/eligible-approvers (requires `approval.task.act`, not `user.read`).
 */
export function ApproverPicker({ id, value, onChange, excludeIds = [], placeholder = 'Select an approver', ...aria }: UserPickerProps) {
  const canAct = usePermission('approval.task.act');
  const [q, setQ] = useState('');
  const approvers = useQuery({
    queryKey: ['approvers', 'eligible', q],
    queryFn: () => get<{ items: EligibleApprover[] }>('/approvals/eligible-approvers', { q }),
    enabled: canAct,
  });
  if (!canAct) return <p className="text-sm text-fg-muted">Only approvers can choose a delegate.</p>;
  const options = (approvers.data?.items ?? []).filter((u) => !excludeIds.includes(u.id));
  return (
    <div className="flex flex-col gap-2">
      <SearchInput value={q} onChange={setQ} placeholder="Search approvers" className="sm:w-full" label="Search approvers" />
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={approvers.isLoading} {...aria}>
        <option value="">{approvers.isLoading ? 'Loading…' : options.length ? placeholder : 'No eligible approvers found'}</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
            {u.jobTitle ? ` · ${u.jobTitle}` : ''} — {u.email}
          </option>
        ))}
      </Select>
    </div>
  );
}
