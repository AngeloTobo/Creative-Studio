/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CREATIVE_STUDIO_ADAPTER?: "development" | "http";
  readonly VITE_CREATIVE_STUDIO_LOCAL?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
