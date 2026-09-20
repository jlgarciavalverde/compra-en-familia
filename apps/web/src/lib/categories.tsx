import { BeerBottle, Basket, Bread, Carrot, Cow, Drop, Egg, Fish, Package, PawPrint, Snowflake, SprayBottle, type Icon } from "@phosphor-icons/react";

export const CATEGORY_ICONS: Record<string, Icon> = {
  "frutas-verduras": Carrot,
  carniceria: Cow,
  pescaderia: Fish,
  panaderia: Bread,
  lacteos: Egg,
  despensa: Package,
  congelados: Snowflake,
  bebidas: BeerBottle,
  limpieza: SprayBottle,
  higiene: Drop,
  mascotas: PawPrint,
  otros: Basket,
};

export const categoryIcon = (key: string): Icon => CATEGORY_ICONS[key] ?? Basket;
