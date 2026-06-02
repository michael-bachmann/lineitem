interface Env {
  YNAB_CLIENT_ID: string;
  YNAB_CLIENT_SECRET: string;
}

export default {
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response("ok", { status: 200 });
  },
};
