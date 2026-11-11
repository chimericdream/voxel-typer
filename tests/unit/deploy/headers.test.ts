/**
 * Guards the container's server config (deploy/nginx.conf) and image (Dockerfile), so an edit
 * can't silently drop a cache or security header. The CI `docker` job checks the live responses;
 * this test checks the rules behind them, including the nginx add_header inheritance trap.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(root + path, "utf8");

interface Directive {
  name: string;
  args: string[];
  block?: Directive[];
}

/** Tokenizes nginx config: quoted strings, bare words, `;`, `{`, `}`; drops `#` comments. */
function tokenize(src: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === ";" || c === "{" || c === "}") {
      tokens.push(c);
      i++;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        value += src[j];
        j++;
      }
      if (j >= src.length) throw new Error(`unterminated string at offset ${i}`);
      tokens.push(`\u0000${value}`); // marks a quoted token so `"{"` isn't read as a brace
      i = j + 1;
    } else {
      let j = i;
      while (j < src.length && !/[\s;{}]/.test(src.charAt(j))) j++;
      tokens.push(src.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

const unquote = (t: string): string => (t.startsWith("\u0000") ? t.slice(1) : t);

function parseNginx(src: string): Directive[] {
  const tokens = tokenize(src);
  let pos = 0;
  function parseBlock(nested: boolean): Directive[] {
    const out: Directive[] = [];
    while (pos < tokens.length) {
      if (tokens[pos] === "}") {
        if (!nested) throw new Error("unexpected }");
        pos++;
        return out;
      }
      const words: string[] = [];
      while (pos < tokens.length && tokens[pos] !== ";" && tokens[pos] !== "{") {
        if (tokens[pos] === "}") throw new Error(`missing ; after ${words.join(" ")}`);
        words.push(unquote(tokens[pos] ?? ""));
        pos++;
      }
      const end = tokens[pos++];
      const [name, ...args] = words;
      if (name === undefined || end === undefined) throw new Error("truncated config");
      if (end === "{") out.push({ name, args, block: parseBlock(true) });
      else out.push({ name, args });
    }
    if (nested) throw new Error("missing }");
    return out;
  }
  return parseBlock(false);
}

/** The single item that `toHaveLength(1)` just checked for. */
function only(found: Directive[], what: string): Directive {
  const [first] = found;
  if (!first) throw new Error(`no ${what}`);
  return first;
}

const all = (ds: Directive[], name: string): Directive[] => ds.filter((d) => d.name === name);
function one(ds: Directive[], name: string, ...args: string[]): Directive {
  const found = ds.filter((d) => d.name === name && args.every((a, i) => d.args[i] === a));
  expect(found, `${name} ${args.join(" ")}`).toHaveLength(1);
  return only(found, name);
}
function walk(
  ds: Directive[],
  visit: (d: Directive, path: string[]) => void,
  path: string[] = [],
): void {
  for (const d of ds) {
    visit(d, path);
    if (d.block) walk(d.block, visit, [...path, `${d.name} ${d.args.join(" ")}`.trim()]);
  }
}

/** nginx `map` semantics: exact keys first, then regex keys in order, then `default`. */
function evalMap(map: Directive, input: string): string | undefined {
  const entries = map.block ?? [];
  const exact = entries.find(
    (e) => !e.name.startsWith("~") && e.name !== "default" && e.name === input,
  );
  if (exact) return exact.args[0];
  for (const e of entries) {
    if (e.name.startsWith("~*") && new RegExp(e.name.slice(2), "i").test(input)) return e.args[0];
    if (
      e.name.startsWith("~") &&
      !e.name.startsWith("~*") &&
      new RegExp(e.name.slice(1)).test(input)
    )
      return e.args[0];
  }
  return entries.find((e) => e.name === "default")?.args[0];
}

const conf = parseNginx(read("deploy/nginx.conf"));
const http = one(conf, "http").block ?? [];
const server = one(http, "server").block ?? [];
const headers = all(server, "add_header");
const header = (name: string): Directive => {
  const found = headers.filter((h) => h.args[0]?.toLowerCase() === name.toLowerCase());
  expect(found, `add_header ${name}`).toHaveLength(1);
  return only(found, name);
};
const location = (...args: string[]): Directive[] => one(server, "location", ...args).block ?? [];

const IMMUTABLE = "public, max-age=31536000, immutable";

const cspDirectives = (csp: string): string[] =>
  csp
    .split(";")
    .map((d) => d.trim().replace(/\s+/g, " "))
    .filter(Boolean);

describe("deploy/nginx.conf", () => {
  it("listens on 8080 and writes only under /tmp (read-only root filesystem)", () => {
    expect(one(server, "listen", "8080").args).toEqual(["8080"]);
    expect(one(conf, "pid").args[0]).toMatch(/^\/tmp\//);
    for (const t of ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"]) {
      expect(one(http, `${t}_temp_path`).args[0]).toMatch(/^\/tmp\//);
    }
  });

  it("sets every add_header at server level, none in http or a location", () => {
    // A location with its own add_header drops ALL inherited ones, security headers included.
    const misplaced: string[] = [];
    walk(conf, (d, path) => {
      if (d.name === "add_header" && path.join(" > ") !== "http > server") {
        misplaced.push(`${path.join(" > ")}: add_header ${d.args[0]}`);
      }
    });
    expect(misplaced).toEqual([]);
  });

  it("sends the security headers on every response, errors included", () => {
    expect(header("X-Content-Type-Options").args.slice(1)).toEqual(["nosniff", "always"]);
    expect(header("Referrer-Policy").args.slice(1)).toEqual(["no-referrer", "always"]);
    expect(header("Cross-Origin-Opener-Policy").args.slice(1)).toEqual(["same-origin", "always"]);
    const pp = header("Permissions-Policy").args;
    expect(pp[2]).toBe("always");
    const features = (pp[1] ?? "").split(",").map((f) => f.trim());
    for (const f of ["camera", "microphone", "geolocation"]) expect(features).toContain(`${f}=()`);
    expect(header("Content-Security-Policy").args[2]).toBe("always");
  });

  it("mirrors index.html's CSP <meta> in the CSP header, plus frame-ancestors 'none'", () => {
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
      read("index.html"),
    );
    expect(meta, "CSP <meta> in index.html").not.toBeNull();
    expect(cspDirectives(header("Content-Security-Policy").args[1] ?? "")).toEqual([
      ...cspDirectives(meta?.[1] ?? ""),
      "frame-ancestors 'none'",
    ]);
  });

  it("caches hashed /assets/* for a year and revalidates everything else", () => {
    const cc = header("Cache-Control").args;
    // No `always`: a 404 for a missing asset must not be cached as immutable.
    expect(cc).toHaveLength(2);
    const variable = cc[1] ?? "";
    expect(variable).toMatch(/^\$\w+$/);
    const map = all(http, "map").find((m) => m.args[1] === variable);
    expect(map?.args[0], "Cache-Control map keyed on $uri").toBe("$uri");
    if (!map) throw new Error("no Cache-Control map");
    const at = (path: string): string | undefined => evalMap(map, path);
    expect(at("/assets/index-LKrDk2Dr.js")).toBe(IMMUTABLE);
    expect(at("/assets/index-Bx9_a1c2.css")).toBe(IMMUTABLE);
    for (const path of ["/", "/index.html", "/sw.js", "/manifest.webmanifest", "/fonts/x.woff2"]) {
      expect(at(path), path).toBe("no-cache");
    }
  });

  it("falls back to index.html for app routes, but 404s missing assets", () => {
    const spa = one(location("/"), "try_files").args;
    expect(spa.at(-1)).toBe("/index.html");
    expect(one(location("/assets/"), "try_files").args).toEqual(["$uri", "=404"]);
  });

  it("serves the web app manifest with its MIME type", () => {
    expect(one(location("=", "/manifest.webmanifest"), "default_type").args).toEqual([
      "application/manifest+json",
    ]);
  });

  it("compresses text and keeps redirects relative behind tailscale serve", () => {
    expect(one(http, "gzip").args).toEqual(["on"]);
    const types = one(http, "gzip_types").args;
    for (const t of [
      "text/css",
      "application/javascript",
      "application/json",
      "application/manifest+json",
    ]) {
      expect(types).toContain(t);
    }
    expect(one(http, "server_tokens").args).toEqual(["off"]);
    expect(one(server, "absolute_redirect").args).toEqual(["off"]);
  });

  it("keeps unhashed static files out of /assets/ (that path is cached immutably)", () => {
    expect(existsSync(`${root}public/assets`)).toBe(false);
  });
});

describe("Dockerfile", () => {
  const lines = read("Dockerfile")
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const lastFrom = lines.findLastIndex((l) => /^FROM\s/i.test(l));
  const final = lines.slice(lastFrom);

  it("builds with node:26-alpine and serves from unprivileged nginx", () => {
    expect(lines.find((l) => /^FROM\s/i.test(l))).toMatch(/\bnode:26-alpine\b/);
    expect(final[0]).toMatch(/^FROM\s+nginxinc\/nginx-unprivileged:alpine\b/);
    expect(final).toContain("COPY deploy/nginx.conf /etc/nginx/nginx.conf");
  });

  it("runs as non-root, exposes 8080 and health-checks /", () => {
    const user = final.find((l) => /^USER\s/i.test(l))?.split(/\s+/)[1];
    expect(user).toBeDefined();
    expect(["root", "0"]).not.toContain(user?.split(":")[0]);
    expect(final).toContain("EXPOSE 8080");
    expect(final.find((l) => /^HEALTHCHECK\s/i.test(l))).toContain("http://127.0.0.1:8080/");
  });

  it("has no RUN in the final stage (so arm64 builds need no emulation)", () => {
    expect(final.filter((l) => /^RUN\s/i.test(l))).toEqual([]);
  });

  it("builds from an allowlisted context", () => {
    const ignore = read(".dockerignore")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(ignore[0]).toBe("*");
    expect(ignore).toContain("!deploy/nginx.conf");
  });
});
