'use client';

import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

/** Two-step destructive button: first click arms it, second click within 4s confirms. */
export function ConfirmButton({
  onConfirm,
  confirmLabel = 'Confirm?',
  children,
  disabled,
  ...props
}: Omit<ButtonProps, 'onClick'> & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <Button
      {...props}
      disabled={disabled}
      variant={armed ? 'danger' : (props.variant ?? 'outline')}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
