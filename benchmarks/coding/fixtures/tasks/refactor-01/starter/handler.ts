export interface Item {
  id: string;
  name: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface Request {
  method: "GET" | "POST" | "PUT" | "DELETE" | string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: unknown;
}

export interface Response {
  status: number;
  body: unknown;
}

const store = new Map<string, Item>();

export function resetStore(): void {
  store.clear();
}

export function getStore(): Map<string, Item> {
  return store;
}

export function handleRequest(req: Request): Response {
  if (req.headers["authorization"]) {
    const token = req.headers["authorization"];
    if (token === "Bearer valid-token") {
      if (req.method === "GET") {
        if (req.params["id"]) {
          const item = store.get(req.params["id"]);
          if (item) {
            return {
              status: 200,
              body: { success: true, data: item },
            };
          } else {
            return {
              status: 404,
              body: { success: false, error: "Item not found" },
            };
          }
        } else {
          const items = Array.from(store.values());
          return {
            status: 200,
            body: { success: true, data: items },
          };
        }
      } else if (req.method === "POST") {
        if (req.body) {
          const data = req.body as Record<string, unknown>;
          if (data["name"] && typeof data["name"] === "string") {
            const id = data["id"] as string | undefined;
            if (id && store.has(id)) {
              return {
                status: 409,
                body: { success: false, error: "Item already exists" },
              };
            }
            const newId = id || `item-${Date.now()}`;
            const now = Date.now();
            const item: Item = {
              id: newId,
              name: data["name"] as string,
              status: "active",
              createdAt: now,
              updatedAt: now,
            };
            store.set(newId, item);
            return {
              status: 201,
              body: { success: true, data: item },
            };
          } else {
            return {
              status: 400,
              body: {
                success: false,
                error: "Validation failed: name is required",
              },
            };
          }
        } else {
          return {
            status: 400,
            body: {
              success: false,
              error: "Request body is required",
            },
          };
        }
      } else if (req.method === "PUT") {
        if (req.body) {
          const data = req.body as Record<string, unknown>;
          if (req.params["id"]) {
            const item = store.get(req.params["id"]);
            if (item) {
              const updated: Item = {
                ...item,
                updatedAt: Date.now(),
              };
              if (data["name"] && typeof data["name"] === "string") {
                updated.name = data["name"] as string;
              }
              if (
                data["status"] &&
                (data["status"] === "active" || data["status"] === "archived")
              ) {
                updated.status = data["status"] as "active" | "archived";
              }
              store.set(req.params["id"], updated);
              return {
                status: 200,
                body: { success: true, data: updated },
              };
            } else {
              return {
                status: 404,
                body: { success: false, error: "Item not found" },
              };
            }
          } else {
            return {
              status: 400,
              body: {
                success: false,
                error: "Validation failed: id parameter is required",
              },
            };
          }
        } else {
          return {
            status: 400,
            body: {
              success: false,
              error: "Request body is required",
            },
          };
        }
      } else if (req.method === "DELETE") {
        if (req.params["id"]) {
          const item = store.get(req.params["id"]);
          if (item) {
            store.delete(req.params["id"]);
            return {
              status: 200,
              body: { success: true, data: { deleted: req.params["id"] } },
            };
          } else {
            return {
              status: 404,
              body: { success: false, error: "Item not found" },
            };
          }
        } else {
          return {
            status: 400,
            body: {
              success: false,
              error: "Validation failed: id parameter is required",
            },
          };
        }
      } else {
        return {
          status: 405,
          body: { success: false, error: "Method not allowed" },
        };
      }
    } else {
      return {
        status: 401,
        body: { success: false, error: "Invalid token" },
      };
    }
  } else {
    return {
      status: 401,
      body: { success: false, error: "Authorization required" },
    };
  }
}
