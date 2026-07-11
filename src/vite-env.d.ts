// Minimal typing for the single Vite import.meta feature we use. Referencing
// "vite/client" instead would re-declare the `*?url` modules already defined
// in globe/vite-env.d.ts.
interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { import?: string; eager?: boolean },
  ): Record<string, () => Promise<T>>;
}
