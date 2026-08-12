import { z } from "zod";

export const cleanerRegionSchema = z.object({
  id: z.string(),
  kind: z.enum(["rect", "poly", "brush"]),
  role: z.enum(["remove", "protect"]),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  size: z.number().optional(),
  grow: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  track: z.boolean().optional(),
  enabled: z.boolean().optional(),
  label: z.string().optional(),
  score: z.number().optional(),
});