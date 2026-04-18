import { z } from 'zod';

// Fly Machines API v2 response schemas.
// Reference: https://fly.io/docs/machines/api/machines-resource/
// Only the fields we actually consume are modelled; unknown fields are
// permitted (Zod `passthrough` on container objects).

export const FlyRegionSchema = z.string().regex(/^[a-z0-9]{3}$/u, 'region must be a 3-char code');

export const FlyAppSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    organization: z.object({ slug: z.string() }).passthrough(),
    status: z.string(),
  })
  .passthrough();
export type FlyApp = z.infer<typeof FlyAppSchema>;

export const FlyMachineStateSchema = z.enum([
  'created',
  'starting',
  'started',
  'stopping',
  'stopped',
  'replacing',
  'destroying',
  'destroyed',
  'failed',
]);
export type FlyMachineState = z.infer<typeof FlyMachineStateSchema>;

export const FlyCheckStatusSchema = z.enum(['passing', 'warning', 'critical']);

export const FlyMachineCheckSchema = z
  .object({
    name: z.string().optional(),
    status: FlyCheckStatusSchema.optional(),
    output: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const FlyMachineSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    state: FlyMachineStateSchema,
    region: z.string(),
    instance_id: z.string().optional(),
    image_ref: z
      .object({
        registry: z.string().optional(),
        repository: z.string().optional(),
        tag: z.string().optional(),
        digest: z.string().optional(),
      })
      .passthrough()
      .optional(),
    config: z.record(z.unknown()).optional(),
    checks: z.array(FlyMachineCheckSchema).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type FlyMachine = z.infer<typeof FlyMachineSchema>;

export interface CreateAppParams {
  name: string;
  orgSlug: string;
  network?: string;
}

export interface CreateMachineParams {
  appName: string;
  name?: string;
  region: string;
  image: string;
  env?: Record<string, string>;
  services?: Array<{
    internal_port: number;
    protocol: 'tcp' | 'udp';
    ports: Array<{ port: number; handlers?: string[] }>;
  }>;
  checks?: Record<
    string,
    {
      type: 'http' | 'tcp';
      port: number;
      interval?: string;
      timeout?: string;
      grace_period?: string;
      method?: string;
      path?: string;
    }
  >;
  guest?: { cpu_kind: 'shared' | 'performance'; cpus: number; memory_mb: number };
  /** Acquire a lease on the Machine so no other process mutates while we wait. */
  leaseTtlSeconds?: number;
}

export class FlyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'FlyApiError';
  }
}
