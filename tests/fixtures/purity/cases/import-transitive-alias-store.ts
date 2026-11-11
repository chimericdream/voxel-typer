// Fixture: alias import of an impure module that pulls in idb (check-boundaries allow-list).
import { openStore } from "@/save/store";
export const x = openStore;
