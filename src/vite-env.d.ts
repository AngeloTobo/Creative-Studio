/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CREATIVE_STUDIO_ADAPTER?: "development" | "http";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
