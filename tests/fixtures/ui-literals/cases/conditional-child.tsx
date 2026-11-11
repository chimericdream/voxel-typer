declare function t(key: string): string;
export const Done = (p: { ok: boolean }) => <p>{p.ok ? "Yes" : t("a.b")}</p>;
