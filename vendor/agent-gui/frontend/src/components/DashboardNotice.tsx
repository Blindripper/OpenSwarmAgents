import type { ReactNode } from "react";

export function dashboardOfflineMessage(feature: string): string {
  return `${feature} needs the live OSA backend. This dashboard is showing a safe setup view with the next useful step.`;
}

export function isBackendUnavailable(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause || "");
  return /404|not\s*found|failed\s*to\s*fetch|network\s*error|load\s*failed/i.test(text);
}

export function safeDashboardError(cause: unknown, fallback: string): string {
  if (isBackendUnavailable(cause)) return dashboardOfflineMessage(fallback);
  const text = cause instanceof Error ? cause.message : String(cause || "");
  return text.replace(/\b404\b|not\s*found/gi, "unavailable").trim() || `${fallback} unavailable`;
}

export function DashboardNotice({
  eyebrow = "Setup state",
  title,
  children,
  tone = "warn",
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  tone?: "warn" | "info" | "success";
}) {
  return (
    <div role="status" className="osa-dashboard-card osa-notice-card" data-tone={tone}>
      <div className="osa-notice-eyebrow">{eyebrow}</div>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}
