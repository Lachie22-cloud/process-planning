/** Typed theme map for programmatic access to design tokens */
export const defaultTheme = {
  colors: {
    background: "var(--color-background)",
    foreground: "var(--color-foreground)",
    primary: "var(--color-primary)",
    secondary: "var(--color-secondary)",
    muted: "var(--color-muted)",
    accent: "var(--color-accent)",
    destructive: "var(--color-destructive)",
    border: "var(--color-border)",
  },
  status: {
    unscheduled: "var(--color-status-unscheduled)",
    scheduled: "var(--color-status-scheduled)",
    inProgress: "var(--color-status-in-progress)",
    qcHold: "var(--color-status-qc-hold)",
    qcPass: "var(--color-status-qc-pass)",
    completed: "var(--color-status-completed)",
    onHold: "var(--color-status-on-hold)",
    cancelled: "var(--color-status-cancelled)",
  },
  radius: {
    card: "var(--radius-card)",
    input: "var(--radius-input)",
    button: "var(--radius-button)",
    modal: "var(--radius-modal)",
  },
  shadows: {
    card: "var(--shadow-card)",
    dropdown: "var(--shadow-dropdown)",
    modal: "var(--shadow-modal)",
  },
} as const;
