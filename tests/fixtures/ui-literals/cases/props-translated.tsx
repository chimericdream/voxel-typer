declare function t(key: string): string;
export const Pic = () => (
  <img
    alt={t("pic.fox")}
    title={t("pic.title")}
    aria-label={t("pic.label")}
    className="hero-image"
    data-testid="fox"
    src="fox.png"
  />
);
