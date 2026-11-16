import type { PermissionKey } from '@kenzo/shared';
import {
  Activity,
  Bell,
  Building2,
  CheckSquare,
  ClipboardCheck,
  FileCheck2,
  FileClock,
  Hash,
  KeyRound,
  Landmark,
  LayoutDashboard,
  List,
  Plug,
  ScrollText,
  ShieldCheck,
  Store,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user holds ANY of these (empty = every signed-in user). */
  anyOf?: PermissionKey[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * Only modules that exist are listed — future modules (procurement, finance)
 * appear when their phase ships, never as dead links.
 */
export const NAV: NavGroup[] = [
  {
    items: [
      { label: 'Overview', href: '/overview', icon: LayoutDashboard },
      { label: 'Approvals', href: '/approvals', icon: CheckSquare },
      { label: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    label: 'Vendors',
    items: [
      { label: 'Vendor overview', href: '/vendors', icon: Store, anyOf: ['vendor.read'] },
      { label: 'Directory', href: '/vendors/directory', icon: List, anyOf: ['vendor.read'] },
      { label: 'Review workspace', href: '/vendors/review', icon: ClipboardCheck, anyOf: ['vendor.approve', 'approval.task.act'] },
      { label: 'Documents', href: '/vendors/documents', icon: FileCheck2, anyOf: ['vendor.read'] },
      {
        label: 'Bank verification',
        href: '/vendors/bank-verification',
        icon: Landmark,
        anyOf: ['vendor.bank.read', 'vendor.bank.approve', 'vendor.bank.update'],
      },
      { label: 'Performance', href: '/vendors/performance', icon: Activity, anyOf: ['vendor.read'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: Users, anyOf: ['user.read'] },
      { label: 'Roles & permissions', href: '/admin/roles', icon: KeyRound, anyOf: ['role.read'] },
      { label: 'Organization', href: '/admin/organization', icon: Building2, anyOf: ['org.company.read', 'org.department.read'] },
      { label: 'Approval policies', href: '/admin/approval-policies', icon: Workflow, anyOf: ['approval.policy.read'] },
      { label: 'Numbering', href: '/admin/numbering', icon: Hash, anyOf: ['numbering.read'] },
      { label: 'Integrations', href: '/admin/integrations', icon: Plug, anyOf: ['integration.read'] },
      { label: 'Audit log', href: '/admin/audit', icon: ScrollText, anyOf: ['audit.read'] },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Security', href: '/settings/security', icon: ShieldCheck },
      { label: 'Delegations', href: '/approvals/delegations', icon: FileClock, anyOf: ['approval.delegation.manage'] },
    ],
  },
];

export function visibleNav(permissions: Record<string, string> | undefined): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.anyOf || i.anyOf.some((p) => !!permissions?.[p])) })).filter((g) => g.items.length > 0);
}
