declare module 'mjml-browser' {
  const compile: (source: string, options?: Record<string, unknown>) => { html: string; errors: unknown[] };
  export default compile;
}
