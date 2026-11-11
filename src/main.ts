// Entry point. For now it shows "hello voxel" (M0-04); M2-10 replaces it with the real app shell.
import { startHelloVoxel } from "./dev/hello-voxel";

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  startHelloVoxel(app, window.location.search);
}
