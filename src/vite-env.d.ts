/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CREATIVE_STUDIO_ADAPTER?: "development" | "http";
  readonly VITE_CREATIVE_STUDIO_LOCAL?: "true" | "false";
  readonly VITE_CREATIVE_STUDIO_PC_HOST?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
