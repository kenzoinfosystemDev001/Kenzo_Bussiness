'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { errorMessage, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useCursorList } from '@/lib/hooks';
import type { NotificationRow } from '@/lib/types';

export default function NotificationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const list = useCursorList<NotificationRow>(['notifications', 'list'], '/notifications', { unread: tab === 'unread' ? 'true' : undefined });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: string) => post(`/notifications/${id}/read`), onSuccess: refresh });
  const markAll = useMutation({
    mutationFn: () => post<{ updated: number }>('/notifications/read-all'),
    onSuccess: async (r) => {
      toast.success(`${r.updated} notification(s) marked as read`);
      await refresh();
    },
    onError: (e) => toast.error('Could not update notifications', errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="secondary" onClick={() => markAll.mutate()} loading={markAll.isPending}>
            <CheckCheck aria-hidden /> Mark all as read
          </Button>
        }
      />
      <Card>
        <Tabs
          className="px-4"
          value={tab}
          onChange={(v) => setTab(v as 'unread' | 'all')}
          items={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
        />
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={Bell} title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'} />
        ) : (
          <ul className="divide-y divide-border">
            {list.items.map((n) => (
              <li key={n.id} className={cn('flex items-start gap-3 px-5 py-3.5', !n.readAt && 'bg-primary-soft/40')}>
                <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} />
                <div className="min-w-0 flex-1">
                  {n.link ? (
                    <Link href={n.link} onClick={() => !n.readAt && markRead.mutate(n.id)} className="text-base font-medium text-fg hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <p className="text-base font-medium text-fg">{n.title}</p>
                  )}
                  {n.body && <p className="mt-0.5 text-sm text-fg-muted">{n.body}</p>}
                  <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-xs text-fg-subtle">
                    {relativeTime(n.createdAt)}
                  </time>
                </div>
                {!n.readAt && (
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center border-t border-border p-3">
            <Button variant="secondary" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
