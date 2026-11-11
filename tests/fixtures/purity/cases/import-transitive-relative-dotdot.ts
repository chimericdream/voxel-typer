// Fixture: relative path that climbs through a pure folder with ".." into an impure module.
import { openStore } from "../engine/../save/store";
export const x = openStore;
