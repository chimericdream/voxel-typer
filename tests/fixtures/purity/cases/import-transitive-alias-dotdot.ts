// Fixture: alias path that climbs out of a pure folder with ".." into an impure module.
import { openStore } from "@/engine/../save/store";
export const x = openStore;
