// Fixture: relative import of an impure module; resolves outside the pure zones from every pure file.
import { openStore } from "../save/store";
export const x = openStore;
