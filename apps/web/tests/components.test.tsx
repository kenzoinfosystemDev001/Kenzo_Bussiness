import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/data-table/data-table';
import { fuzzyScore } from '@/components/layout/command-palette';
import { visibleNav } from '@/components/layout/nav-config';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { Can } from '@/lib/session';
import { makeSession, renderWithProviders } from './utils';

type Row = { id: string; name: string };
const columns = [{ key: 'name', header: 'Name', cell: (r: Row) => r.name }];

describe('StatusBadge', () => {
  it('conveys status with text and an icon, never colour alone', () => {
    const { container } = render(<StatusBadge status="PENDING" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('accepts a custom label and unknown statuses', () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText('Something new')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  it('renders skeleton rows while loading', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} isLoading />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
  });

  it('renders the empty state', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={{ title: 'No users yet' }} />);
    expect(screen.getByText('No users yet')).toBeInTheDocument();
  });

  it('renders an error with the correlation id and retries', async () => {
    const retry = vi.fn();
    const error = new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Boom', correlationId: 'corr-42' });
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} error={error} onRetry={retry} />);
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.getByText('corr-42')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('renders a permission-denied state for FORBIDDEN errors', () => {
    const error = new ApiError({ status: 403, code: 'FORBIDDEN', message: 'No' });
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} error={error} />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
  });

  it('renders rows, supports keyboard row activation and load more', async () => {
    const onRow = vi.fn();
    const more = vi.fn();
    render(<DataTable columns={columns} rows={[{ id: '1', name: 'Asha' }]} rowKey={(r) => r.id} onRowClick={onRow} hasNextPage onLoadMore={more} />);
    const cell = screen.getByText('Asha');
    cell.closest('tr')!.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRow).toHaveBeenCalledWith({ id: '1', name: 'Asha' });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(more).toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason before confirming and passes it trimmed', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => undefined} title="Deactivate user?" requireReason confirmLabel="Deactivate" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Reason is required')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), '  Left the company  ');
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledWith('Left the company');
  });
});

describe('permission gating', () => {
  it('<Can> renders children only with the permission', () => {
    renderWithProviders(
      <>
        <Can permission="user.invite">invite-button</Can>
        <Can permission="audit.read" fallback={<span>no-audit</span>}>
          audit-link
        </Can>
      </>,
      { session: makeSession({ 'user.invite': 'COMPANY' }) },
    );
    expect(screen.getByText('invite-button')).toBeInTheDocument();
    expect(screen.queryByText('audit-link')).toBeNull();
    expect(screen.getByText('no-audit')).toBeInTheDocument();
  });

  it('respects minimum scope', () => {
    renderWithProviders(
      <Can permission="user.read" minScope="COMPANY" fallback={<span>scoped-out</span>}>
        all-users
      </Can>,
      { session: makeSession({ 'user.read': 'DEPARTMENT' }) },
    );
    expect(screen.getByText('scoped-out')).toBeInTheDocument();
  });

  it('only shows navigation for modules the user can access', () => {
    const labels = visibleNav({ 'audit.read': 'COMPANY' }).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Audit log');
    expect(labels).toContain('Overview');
    expect(labels).not.toContain('Users');
    expect(labels).not.toContain('Delegations');
  });
});

describe('command palette search', () => {
  it('ranks direct matches before fuzzy ones and rejects non-matches', () => {
    expect(fuzzyScore('audit', 'Audit log')).toBe(0);
    expect(fuzzyScore('adlg', 'Audit log')).toBeGreaterThan(100);
    expect(fuzzyScore('xyz', 'Audit log')).toBe(-1);
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});
