import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus-visible:border-accent disabled:opacity-60 aria-[invalid=true]:border-danger';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input ref={ref} type={type} className={cn(field, 'h-11', className)} {...props} />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(field, 'h-11', className)} {...props} />
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-sm font-medium', className)} {...props} />;
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-danger">
      {message}
    </p>
  );
}
