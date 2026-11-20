// Minimal Deno globals so `tsc -p tsconfig.functions.json` can typecheck the Edge Function under Node.
// Not used at runtime: Supabase runs the function on Deno, which provides the real ones.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
