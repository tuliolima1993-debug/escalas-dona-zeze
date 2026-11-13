import * as React from 'react';
import * as T from '@radix-ui/react-tooltip';
import * as Tabs from '@radix-ui/react-tabs';
import * as DM from '@radix-ui/react-dropdown-menu';
import { cn, tint } from '@/lib/utils';

export const Badge = ({ className, color, children, ...p }: React.HTMLAttributes<HTMLSpanElement> & { color?: string }) => (
  <span
    className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', !color && 'bg-muted text-slate-700', className)}
    style={color ? { backgroundColor: tint(color, 0.85), color } : undefined}
    {...p}
  >
    {children}
  </span>
);

export const Dot = ({ color, className }: { color: string; className?: string }) => (
  <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />
);

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Provider delayDuration={250}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6} className="z-[60] max-w-xs rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg animate-in fade-in-0">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}

export const TabsRoot = Tabs.Root;
export const TabsContent = Tabs.Content;
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof Tabs.List>) => (
  <Tabs.List className={cn('inline-flex rounded-xl bg-slate-100 p-1', className)} {...p} />
);
export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof Tabs.Trigger>) => (
  <Tabs.Trigger className={cn('rounded-lg px-3.5 py-1.5 text-sm font-semibold text-slate-600 transition-all data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm', className)} {...p} />
);

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuContent = ({ className, ...p }: React.ComponentProps<typeof DM.Content>) => (
  <DM.Portal>
    <DM.Content sideOffset={6} align="end" className={cn('z-50 min-w-[200px] rounded-xl border border-border bg-white p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95', className)} {...p} />
  </DM.Portal>
);
export const MenuItem = ({ className, ...p }: React.ComponentProps<typeof DM.Item>) => (
  <DM.Item className={cn('flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground', className)} {...p} />
);
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ className, ...p }: React.ComponentProps<typeof DM.Label>) => (
  <DM.Label className={cn('px-2.5 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...p} />
);

export function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-50 text-forest-700">{icon}</div>
      <p className="text-base font-bold">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
