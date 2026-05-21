// Runtime-only config served as a JS payload. The layout includes this via
// `<script src="/runtime-config.js">` so window.__GATEWAY_PORT__ is set
// before any client bundle runs. Reading GATEWAY_PUBLIC_PORT here (rather
// than inlining it in the layout) keeps the rest of the app statically
// rendered — only this route is dynamic.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const port = Number(process.env.GATEWAY_PUBLIC_PORT ?? 8080);
  const body = `window.__GATEWAY_PORT__=${port};`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
