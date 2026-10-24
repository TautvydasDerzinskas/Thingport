import type { ProviderTrending } from "../types";
import { fetchMakerworldTrending } from "./api";

export const makerworldTrending: ProviderTrending = { fetch: (_userId, limit) => fetchMakerworldTrending(limit) };

export { makerworldLists } from "./lists";
