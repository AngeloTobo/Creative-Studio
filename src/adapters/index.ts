import { createDevelopmentAdapter } from "./developmentAdapter";
import { createHttpAdapter } from "./httpAdapter";
import type { StudioAdapter } from "./types";
import { resolveStudioAdapterMode } from "../config/runtime";

export function createStudioAdapter(): StudioAdapter {
  const mode = resolveStudioAdapterMode(import.meta.env.VITE_CREATIVE_STUDIO_ADAPTER, import.meta.env.DEV);
  return mode === "development" ? createDevelopmentAdapter() : createHttpAdapter();
}

export type { StudioAdapter } from "./types";
