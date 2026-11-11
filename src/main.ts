// Placeholder entry point (M0-01). M0-04 replaces it with "hello voxel"; M2-10 with the real app shell.
const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.dataset["ready"] = "1";
}
