import { describe, it, expect, beforeEach } from "vitest";
import { handleRequest, resetStore, type Request } from "../../solution.js";

const validHeaders = { authorization: "Bearer valid-token" };

function makeReq(
  overrides: Partial<Request> & { method: string }
): Request {
  return {
    headers: validHeaders,
    params: {},
    ...overrides,
  } as Request;
}

describe("Handler - Edge Cases", () => {
  beforeEach(() => {
    resetStore();
  });

  it("returns 400 when POST body is missing", () => {
    const res = handleRequest(makeReq({ method: "POST" }));
    expect(res.status).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toContain("body");
  });

  it("returns 409 when creating item with duplicate ID", () => {
    handleRequest(
      makeReq({ method: "POST", body: { id: "dup", name: "First" } })
    );
    const res = handleRequest(
      makeReq({ method: "POST", body: { id: "dup", name: "Second" } })
    );
    expect(res.status).toBe(409);
    const body = res.body as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it("supports partial update on PUT (only name)", () => {
    handleRequest(
      makeReq({ method: "POST", body: { id: "p1", name: "Original" } })
    );
    const res = handleRequest(
      makeReq({
        method: "PUT",
        params: { id: "p1" },
        body: { status: "archived" },
      })
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      data: { name: string; status: string };
    };
    expect(body.data.name).toBe("Original");
    expect(body.data.status).toBe("archived");
  });

  it("returns 404 when deleting non-existent item", () => {
    const res = handleRequest(
      makeReq({ method: "DELETE", params: { id: "ghost" } })
    );
    expect(res.status).toBe(404);
    const body = res.body as { success: boolean };
    expect(body.success).toBe(false);
  });
});
