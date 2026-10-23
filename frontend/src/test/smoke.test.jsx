import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { execFileSync } from "node:child_process";
import i18n, { setLanguage } from "../i18n";
import { fmtMoney, dayName } from "../lib/format";
import { mobileTabs, visibleNav } from "../nav";

vi.mock("../lib/api", () => {
  const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { default: api, errorText: (e) => String(e), download: vi.fn(), setTokens: vi.fn(), clearTokens: vi.fn(), hasToken: () => false };
});
import api from "../lib/api";

function fakeAuth(roles, modules = ["fees", "transport", "communication", "attendance", "homework", "grades", "pickup", "exams", "admissions", "substitutes", "timetable"]) {
  const r = new Set(roles);
  const m = new Set(modules);
  return { hasRole: (...x) => x.some((y) => r.has(y)), hasModule: (x) => !x || m.has(x) };
}

describe("translations", () => {
  it("every on-screen string has an Arabic translation", () => {
    const out = execFileSync("node", ["scripts/i18n-check.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/0 missing/);
  });

  it("Arabic switches the page to right-to-left", () => {
    setLanguage("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(i18n.t("Students")).toBe("الطلاب");
    setLanguage("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("formats money in JOD with 3 decimals and Sunday as day 7", () => {
    setLanguage("en");
    expect(fmtMoney("12.5", "JOD")).toMatch(/12\.500/);
    expect(dayName(7)).toBe("Sunday");
  });
});

describe("navigation per role", () => {
  const paths = (auth) => visibleNav(auth).flatMap((s) => s.items.map((i) => i.to));

  it("parents see their children, bus and fees but never admin pages", () => {
    const p = paths(fakeAuth(["parent"]));
    expect(p).toEqual(expect.arrayContaining(["/children", "/bus", "/my-fees", "/pickup"]));
    for (const forbidden of ["/students", "/fees", "/settings", "/audit", "/transport", "/attendance"]) expect(p).not.toContain(forbidden);
  });

  it("drivers only get their route and the calendar", () => {
    expect(paths(fakeAuth(["driver"]))).toEqual(["/driver", "/calendar"]);
    expect(mobileTabs(fakeAuth(["driver"])).map((t) => t.to)).toEqual(["/driver", "/calendar"]);
  });

  it("plan modules hide whole features", () => {
    const p = paths(fakeAuth(["admin"], ["communication", "attendance"]));
    expect(p).toContain("/attendance");
    expect(p).not.toContain("/fees");
    expect(p).not.toContain("/transport");
  });
});

describe("screens", () => {
  beforeEach(() => {
    setLanguage("en");
    vi.clearAllMocks();
  });

  it("login posts the credentials", async () => {
    const { AuthProvider } = await import("../auth/AuthContext");
    const { Login } = await import("../pages/auth");
    api.post.mockResolvedValue({ data: { access: "a", refresh: "r" } });
    api.get.mockResolvedValue({ data: { email: "x@y.z", schools: [] } });
    render(<AuthProvider><MemoryRouter><Login /></MemoryRouter></AuthProvider>);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Admin@Demo.com " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Log in" })[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/token/", { username: "admin@demo.com", password: "secret" }));
  });

  it("generic list page renders rows and opens the form", async () => {
    vi.doMock("../auth/AuthContext", () => ({ useAuth: () => ({ base: "/schools/1" }) }));
    const { default: ResourcePage } = await import("../components/ResourcePage");
    api.get.mockResolvedValue({ data: [{ id: 1, name: "Room 101", capacity: 32 }] });
    render(<MemoryRouter><ResourcePage title="Rooms" path="classrooms" columns={[{ key: "name", label: "Name" }, { key: "capacity", label: "Seats" }]}
                                       fields={[{ name: "name", label: "Name" }]} /></MemoryRouter>);
    expect((await screen.findAllByText("Room 101")).length).toBeGreaterThan(0);
    expect(api.get).toHaveBeenCalledWith("/schools/1/classrooms/", { params: {} });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    vi.doUnmock("../auth/AuthContext");
  });
});
