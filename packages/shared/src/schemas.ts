import { z } from "zod";
import { UNITS } from "./text";

export const HealthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  uptime: z.number(),
});
export type Health = z.infer<typeof HealthSchema>;

// ---------- Entidades (lo que devuelve la API) ----------
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["admin", "member"]),
  avatarColor: z.string(),
  avatarEmoji: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const HouseholdSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(UserSchema),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  position: z.number(),
});
export type Category = z.infer<typeof CategorySchema>;

export const ListSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  archived: z.boolean(),
  /** Plantilla: lista modelo que se copia para empezar una nueva. */
  template: z.boolean(),
  total: z.number(),
  checked: z.number(),
  updatedAt: z.number(),
});
export type ListSummary = z.infer<typeof ListSummarySchema>;

export const ItemSchema = z.object({
  id: z.string(),
  listId: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
  categoryId: z.string(),
  assigneeId: z.string().nullable(),
  checkedAt: z.number().nullable(),
  checkedBy: z.string().nullable(),
  createdBy: z.string(),
  /** Orden manual dentro de la lista (menor = antes). */
  position: z.number(),
  /** Euros pagados por esta línea (opcional; se apunta al comprar). */
  price: z.number().nullable(),
  updatedAt: z.number(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ListDetailSchema = z.object({ list: ListSummarySchema, items: z.array(ItemSchema) });
export type ListDetail = z.infer<typeof ListDetailSchema>;

export const CatalogProductSchema = z.object({
  name: z.string(),
  stem: z.string(),
  categoryId: z.string(),
  defaultUnit: z.string().nullable(),
  useCount: z.number(),
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export const SuggestionSchema = z.object({
  name: z.string(),
  categoryId: z.string(),
  defaultUnit: z.string().nullable(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

// ---------- Entradas ----------
const password = z.string().min(8, "Mínimo 8 caracteres").max(200);
const name = z.string().trim().min(1, "Escribe un nombre").max(60);

export const RegisterInput = z.object({
  name,
  email: z.string().trim().toLowerCase().pipe(z.email("Email no válido")),
  password,
  inviteCode: z.string().trim().toUpperCase().optional(),
  setupCode: z.string().trim().optional(),
  householdName: z.string().trim().min(1).max(60).optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z.object({
  current: z.string().min(1).max(200),
  next: password,
});

export const ResetInput = z.object({
  code: z.string().trim().toUpperCase().min(4).max(16),
  password,
});

export const SessionInfoSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  device: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const ProfileInput = z.object({
  name: name.optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarEmoji: z.string().min(1).max(8).optional(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ListInput = z.object({
  /** Id generado en el cliente (crear listas sin conexión). */
  id: z.uuid().optional(),
  name,
  emoji: z.string().min(1).max(8).optional(),
});
export const ListPatch = z.object({
  name: name.optional(),
  emoji: z.string().min(1).max(8).optional(),
  archived: z.boolean().optional(),
});

const unit = z.enum(UNITS).nullable();
/** Un producto ya interpretado por el cliente (permite crear ítems sin conexión con su propio id). */
export const NewItemInput = z.object({
  id: z.uuid().optional(),
  name,
  qty: z.number().positive().max(100000).optional(),
  unit: unit.optional(),
  note: z.string().trim().max(200).nullable().optional(),
  categoryId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
});
export type NewItemInput = z.infer<typeof NewItemInput>;

export const AddItemsInput = z.object({
  /** Texto libre, admite varios: "leche, huevos x12, pan". */
  text: z.string().trim().min(1).max(1000).optional(),
  name: name.optional(),
  qty: z.number().positive().max(100000).optional(),
  unit: unit.optional(),
  note: z.string().trim().max(200).nullable().optional(),
  categoryId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  /** Forma estructurada, la que usa la app. */
  items: z.array(NewItemInput).min(1).max(50).optional(),
}).refine((v) => v.text || v.name || v.items, "Falta el nombre del producto");
export type AddItemsInput = z.infer<typeof AddItemsInput>;

export const ItemPatch = z.object({
  name: name.optional(),
  qty: z.number().positive().max(100000).optional(),
  unit: unit.optional(),
  note: z.string().trim().max(200).nullable().optional(),
  categoryId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  checked: z.boolean().optional(),
  position: z.number().finite().optional(),
  /** Euros pagados por la línea (null la borra). */
  price: z.number().min(0).max(100000).nullable().optional(),
  /** Tienda donde se compra: el precio y la compra se apuntan a esa tienda. */
  storeId: z.string().optional(),
});
export type ItemPatch = z.infer<typeof ItemPatch>;

export const DuplicateInput = z.object({
  /** true: guardar como plantilla. false/omitido: lista normal (usar una plantilla o copiar). */
  template: z.boolean().optional(),
  name: name.optional(),
});

export const CHAINS = ["mercadona", "familycash", "dumbo"] as const;
export type Chain = (typeof CHAINS)[number];
export const CHAIN_NAMES: Record<Chain, string> = { mercadona: "Mercadona", familycash: "Family Cash", dumbo: "Super Dumbo" };

export const StoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Cadena a la que pertenece (para saber de dónde llegan sus precios). */
  chain: z.enum(CHAINS).nullable(),
  /** Ids de categoría en el orden en que aparecen los pasillos de esa tienda. */
  order: z.array(z.string()),
});
export type Store = z.infer<typeof StoreSchema>;

const chain = z.enum(CHAINS).nullable();
export const StoreInput = z.object({ name, order: z.array(z.string()).max(100).optional(), chain: chain.optional() });
export const StorePatch = z.object({ name: name.optional(), order: z.array(z.string()).max(100).optional(), chain: chain.optional() });

export const PurchaseSchema = z.object({
  id: z.string(),
  listId: z.string().nullable(),
  listName: z.string(),
  name: z.string(),
  categoryId: z.string(),
  qty: z.number(),
  unit: z.string().nullable(),
  userId: z.string().nullable(),
  /** Euros pagados, si se apuntaron. */
  price: z.number().nullable(),
  storeId: z.string().nullable(),
  at: z.number(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const SuggestedProductSchema = z.object({
  name: z.string(),
  categoryId: z.string(),
  /** Cada cuántos días suele comprarse. */
  everyDays: z.number(),
  /** Días desde la última vez. */
  daysSince: z.number(),
});
export type SuggestedProduct = z.infer<typeof SuggestedProductSchema>;

/** Precio vigente de un producto en una tienda (una fila del "libro de precios"). */
export const PriceEntrySchema = z.object({
  /** Raíz del producto genérico de la app ("leche"). */
  stem: z.string(),
  storeId: z.string(),
  storeProductId: z.string(),
  /** Nombre del producto concreto en esa tienda. */
  name: z.string(),
  /** Euros de un envase (o de una unidad). */
  price: z.number(),
  packQty: z.number().nullable(),
  packUnit: z.enum(["kg", "l", "ud"]).nullable(),
  /** Euros por kg, l o unidad: lo que permite comparar tamaños distintos. */
  unitPrice: z.number().nullable(),
  refUnit: z.enum(["kg", "l", "ud"]).nullable(),
  updatedAt: z.number(),
  /** true = lo eligió o lo pagó la familia; false = emparejado automáticamente. */
  confirmed: z.boolean(),
  source: z.enum(["catalog", "ticket", "manual"]),
});
export type PriceEntry = z.infer<typeof PriceEntrySchema>;

/** Precio apuntado a mano: `price` euros por `qty` `unit` (p. ej. 2,99 € por 1 kg). */
export const ManualPriceInput = z.object({
  name,
  storeId: z.string(),
  price: z.number().min(0).max(100000),
  qty: z.number().positive().max(100000).optional(),
  unit: unit.optional(),
});
export type ManualPriceInput = z.infer<typeof ManualPriceInput>;

export const RestoreInput = z.object({ ids: z.array(z.string()).min(1).max(500) });

/** Quién está haciendo la compra ahora mismo y en qué lista. */
export interface ShoppingPresence {
  userId: string;
  listId: string;
}

/** Mensajes del canal en tiempo real (servidor → cliente). */
export type RealtimeMessage =
  | { type: "changed"; listId?: string }
  | { type: "ready" }
  | { type: "presence"; shopping: ShoppingPresence[] };

/** Mensajes del cliente al servidor: el primero debe ser `auth`. */
export type ClientMessage = { type: "auth"; token: string } | { type: "shopping"; listId: string | null };
