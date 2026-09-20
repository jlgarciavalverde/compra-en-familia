import type { Item, ListSummary, User } from "@compra/shared";
import type { Row } from "./db";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AuthUser extends User {
  householdId: string;
}

export const toUser = (r: Row): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  avatarColor: r.avatar_color,
  avatarEmoji: r.avatar_emoji,
});

export const toItem = (r: Row): Item => ({
  id: r.id,
  listId: r.list_id,
  name: r.name,
  qty: r.qty,
  unit: r.unit,
  note: r.note,
  categoryId: r.category_id,
  assigneeId: r.assignee_id,
  checkedAt: r.checked_at,
  checkedBy: r.checked_by,
  createdBy: r.created_by,
  position: r.position,
  price: r.price ?? null,
  updatedAt: r.updated_at,
});

export const toList = (r: Row): ListSummary => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  archived: r.archived_at != null,
  template: r.is_template === 1,
  total: r.total ?? 0,
  checked: r.checked ?? 0,
  updatedAt: r.updated_at,
});
