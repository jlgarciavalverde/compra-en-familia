import { useAuth } from "../lib/auth";
import { usePresence } from "../lib/presence";
import { Avatar } from "./ui";

/** Personas (que no soy yo) que están comprando esta lista ahora mismo. */
export function useShoppers(listId: string) {
  const { user, household } = useAuth();
  const shopping = usePresence();
  return shopping
    .filter((p) => p.listId === listId && p.userId !== user?.id)
    .map((p) => household?.members.find((m) => m.id === p.userId))
    .filter((m): m is NonNullable<typeof m> => !!m);
}

const names = (n: string[]) => (n.length <= 1 ? n[0] ?? "" : `${n.slice(0, -1).join(", ")} y ${n.at(-1)}`);

export function Shoppers({ listId }: { listId: string }) {
  const people = useShoppers(listId);
  if (people.length === 0) return null;
  return (
    <div role="status" className="flex items-center gap-2 rounded-full bg-sage/15 py-1.5 pl-2 pr-4 text-sm font-bold">
      <span className="flex -space-x-2">{people.map((p) => <Avatar key={p.id} user={p} size={24} ring />)}</span>
      <span>{names(people.map((p) => p.name))} {people.length === 1 ? "está comprando" : "están comprando"}</span>
      <span className="size-2 animate-pulse rounded-full bg-sage" aria-hidden />
    </div>
  );
}
