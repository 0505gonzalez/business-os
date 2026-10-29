import React from "react";
import { Icon, type IconName } from "./icons.js";
export const pages: { name: string; icon: IconName }[] = [
  { name: "Workflows", icon: "workflow" },
  { name: "Payments", icon: "card" },
  { name: "Memory", icon: "book" },
  { name: "Team", icon: "users" },
];
export function Sidebar({
  page,
  onNavigate,
  taskCount,
  workspaceName,
  workspacePicker,
}: {
  page: string;
  onNavigate: (page: string) => void;
  taskCount: number;
  workspaceName: string;
  workspacePicker?: React.ReactNode;
}) {
  return (
    <aside className="sidebar card">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="logo" size={18} />
        </span>
        <span className="brand-name">Business OS</span>
      </div>
      <div className="workspace-switcher">
        {workspacePicker ?? (
          <span className="workspace-static">
            <Icon name="building" size={16} />
            <span>{workspaceName}</span>
          </span>
        )}
      </div>
      <nav className="nav" aria-label="Sections">
        {pages.map(({ name, icon }) => (
          <button
            key={name}
            className={"nav-item" + (page === name ? " selected" : "")}
            aria-current={page === name ? "page" : undefined}
            onClick={() => onNavigate(name)}
          >
            <Icon name={icon} />
            <span>{name}</span>
            {name === "Workflows" && taskCount > 0 && (
              <span
                className="nav-badge"
                aria-hidden="true"
                title={`${taskCount} assigned to you`}
              >
                {taskCount}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button
          className={"nav-item" + (page === "Settings" ? " selected" : "")}
          aria-label="Workspace settings"
          aria-current={page === "Settings" ? "page" : undefined}
          onClick={() => onNavigate("Settings")}
        >
          <Icon name="sliders" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
export function WorkspaceSwitcher({
  workspaces,
  value,
  onChange,
  onJoin,
}: {
  workspaces: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  onJoin: () => void;
}) {
  return (
    <span className="workspace-select">
      <Icon name="building" size={16} />
      <select
        aria-label="Workspace"
        value={value}
        onChange={(e) =>
          e.target.value === "__join" ? onJoin() : onChange(e.target.value)
        }
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
        <option value="__join">Join another workspace…</option>
      </select>
      <Icon name="chevron-down" size={14} className="workspace-chevron" />
    </span>
  );
}
export function Avatar({
  name,
  size = "md",
}: {
  name?: string;
  size?: "sm" | "md";
}) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span className={"avatar " + size} aria-hidden="true">
      {initials || <Icon name="user" size={size === "sm" ? 14 : 16} />}
    </span>
  );
}
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
export function EmptyState({
  icon,
  title,
  children,
  role,
}: {
  icon: IconName;
  title: string;
  children?: React.ReactNode;
  role?: string;
}) {
  return (
    <article className="card empty" role={role}>
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      {children}
    </article>
  );
}
