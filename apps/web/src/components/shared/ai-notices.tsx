import { FlaskConical, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function SimulationBadge() {
  return (
    <Badge variant="warning">
      <FlaskConical className="size-3" /> Simulation
    </Badge>
  );
}

export function SimulationBanner() {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Simulation mode.</strong> The server is running the mock provider, so this image is{' '}
        <strong>not</strong> AI-generated and your photo is unchanged. It only demonstrates the
        workflow. See <code>docs/ai-integration.md</code> to connect a real model.
      </p>
    </div>
  );
}

export function FitDisclaimer() {
  return (
    <p className="flex gap-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      Virtual try-on previews how a garment may <em>look</em> on you. It does not measure or predict
      physical fit or size.
    </p>
  );
}
