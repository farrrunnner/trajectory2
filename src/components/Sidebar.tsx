import { Link, useLocation } from 'react-router-dom';

import { useUiStateStore } from '@/store/useUiStateStore';

type NavSection = 'dashboard' | 'activities' | 'heatmap' | 'analytics' | 'settings';

const navItems: Array<{ section: NavSection; defaultPath: string; label: string }> = [
  { section: 'dashboard', defaultPath: '/', label: 'Dashboard' },
  { section: 'activities', defaultPath: '/activities', label: 'Activities' },
  { section: 'heatmap', defaultPath: '/heatmap', label: 'Heatmap' },
  { section: 'analytics', defaultPath: '/analytics', label: 'Advanced Analytics' },
  { section: 'settings', defaultPath: '/settings', label: 'Settings' }
];

function sectionForPath(pathname: string): NavSection | null {
  if (pathname === '/') {
    return 'dashboard';
  }

  if (pathname === '/heatmap') {
    return 'heatmap';
  }

  if (pathname === '/settings') {
    return 'settings';
  }

  if (pathname === '/analytics') {
    return 'analytics';
  }

  if (pathname === '/activities' || pathname.startsWith('/activities/')) {
    return 'activities';
  }

  return null;
}

export function Sidebar() {
  const location = useLocation();
  const lastSectionRoutes = useUiStateStore((state) => state.lastSectionRoutes);
  const activeSection = sectionForPath(location.pathname);

  const pathForSection = (item: (typeof navItems)[number]) => {
    if (item.section === 'activities') {
      return item.defaultPath;
    }

    return lastSectionRoutes[item.section] ?? item.defaultPath;
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-gradient-to-b from-panel to-bg px-5 py-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-muted">Trajectory</p>
        <h1 className="text-2xl font-semibold text-foreground">Trajectory</h1>
      </div>
      <nav className="space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.section}
            to={pathForSection(item)}
            className={
              `block rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                activeSection === item.section
                  ? 'bg-accent text-white'
                  : 'text-muted hover:bg-white/5 hover:text-foreground'
              }`
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
