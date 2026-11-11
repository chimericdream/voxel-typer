// Entry of hello.html (developer page): the M0-04 "hello voxel" cube, which used to be the app's
// entry point before the M2-10 shell replaced it.
import { startHelloVoxel } from "./hello-voxel";

const app = document.querySelector<HTMLDivElement>("#app");
if (app) startHelloVoxel(app, window.location.search);
