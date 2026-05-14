import { loadConfig } from "./config";
import { HttpError, jsonResponse } from "./http";
import {
  handleBootstrapRedeem,
  handleInvite,
  handleKey,
  handleParty,
  handlePartyMessages,
} from "./relay";
import { FederationStore } from "./store";

export function createServer(config = loadConfig()): {
  fetch: (request: Request) => Promise<Response>;
} {
  const store = new FederationStore(config.dataDir);
  const init = store.init();

  return {
    async fetch(request: Request): Promise<Response> {
      await init;

      const url = new URL(request.url);
      const path = url.pathname;

      try {
        if (request.method === "GET" && path === "/health") {
          return jsonResponse({ status: "ok" });
        }

        if (request.method === "GET" && path === "/api/federation/health") {
          return jsonResponse({ status: "ok" });
        }

        if (request.method === "GET" && path === "/api/federation/key") {
          return handleKey(config);
        }

        if (request.method === "POST" && path === "/api/federation/invite") {
          return await handleInvite(request, store, config);
        }

        if (
          request.method === "POST" &&
          path === "/api/federation/bootstrap/redeem"
        ) {
          return await handleBootstrapRedeem(request, store, config);
        }

        const messagesMatch = path.match(
          /^\/api\/federation\/party\/([^/]+)\/messages$/,
        );
        if (request.method === "GET" && messagesMatch) {
          return await handlePartyMessages(
            request,
            decodeURIComponent(messagesMatch[1]),
            store,
            config,
          );
        }

        const partyMatch = path.match(/^\/api\/federation\/party\/([^/]+)$/);
        if (request.method === "POST" && partyMatch) {
          return await handleParty(
            request,
            decodeURIComponent(partyMatch[1]),
            store,
            config,
          );
        }

        if (path.startsWith("/api/federation/")) {
          return jsonResponse({ error: "Not found" }, 404);
        }

        return jsonResponse({
          name: "zoiree",
          status: "ok",
          federation: "/api/federation/key",
        });
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonResponse({ error: error.message }, error.status);
        }

        console.error(error);
        return jsonResponse({ error: "Internal server error" }, 500);
      }
    },
  };
}

const isMain = import.meta.path === Bun.main;

if (isMain) {
  const port = Number(Bun.env.PORT ?? 3000);
  const server = createServer();
  Bun.serve({
    port,
    fetch: server.fetch,
  });
  console.log(`zoiree listening on http://127.0.0.1:${port}`);
}
