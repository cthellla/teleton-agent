import { Link, useLocation } from 'react-router-dom';
import { Shell } from './Shell';
import { AgentControl } from './AgentControl';
import { ModeSwitch } from './ModeSwitch';
import { logout } from '../lib/api';
import { CSSProperties, ReactNode } from 'react';

// ── Inline SVG icons (Lucide-style, 18×18, strokeWidth 1.5) ──────────────────

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconTools() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconPlugins() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

function IconSoul() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function IconMemory() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function IconConversations() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}

function IconWorkspace() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconMCP() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function IconHooks() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconConfig() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Nav link item ─────────────────────────────────────────────────────────────

const navLinkBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 16px',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 500,
  transition: 'background 0.18s ease, color 0.18s ease',
  cursor: 'pointer',
};

const navLinkActive: CSSProperties = {
  ...navLinkBase,
  color: 'var(--text-primary)',
  background: 'var(--accent-subtle, rgba(255, 255, 255, 0.08))',
};

const navLinkHoverClass = 'nav-link-hover';

interface NavItemProps {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}

function NavItem({ to, active, icon, label }: NavItemProps) {
  return (
    <Link
      to={to}
      className={`${navLinkHoverClass}${active ? ' active' : ''}`}
      style={active ? navLinkActive : navLinkBase}
    >
      {icon}
      {label}
    </Link>
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────

function DashboardNav() {
  const location = useLocation();
  const p = location.pathname;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  const items: { to: string; icon: ReactNode; label: string }[] = [
    { to: '/',          icon: <IconDashboard />, label: 'Dashboard' },
    { to: '/tools',     icon: <IconTools />,     label: 'Tools' },
    { to: '/plugins',   icon: <IconPlugins />,   label: 'Plugins' },
    { to: '/soul',      icon: <IconSoul />,      label: 'Soul' },
    { to: '/memory',    icon: <IconMemory />,    label: 'Memory' },
    { to: '/conversations', icon: <IconConversations />, label: 'Chats' },
    { to: '/wallet',        icon: <IconWallet />,        label: 'Wallet' },
    { to: '/workspace', icon: <IconWorkspace />, label: 'Workspace' },
    { to: '/tasks',     icon: <IconTasks />,     label: 'Tasks' },
    { to: '/mcp',       icon: <IconMCP />,       label: 'MCP' },
    { to: '/hooks',     icon: <IconHooks />,     label: 'Hooks' },
    { to: '/config',    icon: <IconConfig />,    label: 'Config' },
  ];

  return (
    <>
      {/* Hover styles injected once */}
      <style>{`
        .nav-link-hover:hover:not(.active) {
          color: var(--text-primary) !important;
          background: var(--bg-glass-hover, rgba(255, 255, 255, 0.10)) !important;
        }
        .nav-link-hover svg {
          flex-shrink: 0;
          opacity: 0.7;
          transition: opacity 0.18s ease;
        }
        .nav-link-hover.active svg,
        .nav-link-hover:hover svg {
          opacity: 1;
        }
      `}</style>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {items.map(({ to, icon, label }) => (
          <NavItem key={to} to={to} active={p === to} icon={icon} label={label} />
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <ModeSwitch />
        <div style={{ margin: '8px 0', padding: '0 4px' }}>
          <AgentControl />
        </div>

        <div style={{ padding: '0 4px 14px' }}>
          <button
            onClick={handleLogout}
            style={{ width: '100%', opacity: 0.7, fontSize: '13px' }}
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
}

export function Layout() {
  return <Shell sidebar={<DashboardNav />} />;
}
