import { describe, expect, it } from "vitest";
import { loadConfig } from "../../apps/api/src/config";

const prod = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.internal:5432/app",
  ENCRYPTION_KEY: "a".repeat(44),
};

describe("email links on screen", () => {
  it("are shown in development", () => {
    expect(loadConfig({ NODE_ENV: "development" }).showEmailLinks).toBe(true);
  });

  it("are never shown in production", () => {
    expect(loadConfig({ ...prod, PUBLIC_API_URL: "https://api.example.com" }).showEmailLinks).toBe(false);
  });

  it("are shown on staging when the API address is a staging address", () => {
    const config = loadConfig({ ...prod, APP_ENV: "staging", PUBLIC_API_URL: "https://api-staging-production-1a2b.up.railway.app" });
    expect(config.showEmailLinks).toBe(true);
  });

  it("refuse to start when APP_ENV=staging is set on a non-staging address", () => {
    expect(() => loadConfig({ ...prod, APP_ENV: "staging", PUBLIC_API_URL: "https://api.example.com" })).toThrow(/staging/);
    expect(() => loadConfig({ ...prod, APP_ENV: "staging", PUBLIC_API_URL: "https://notstaging.example.com" })).toThrow(/staging/);
  });
});
