import { randomUUID } from "node:crypto";
import { normalize, stem } from "@compra/shared";
import { run, type DB } from "./db";

export const DEFAULT_CATEGORIES = [
  ["frutas-verduras", "Frutas y verduras"],
  ["carniceria", "Carnicería y charcutería"],
  ["pescaderia", "Pescadería"],
  ["panaderia", "Panadería y bollería"],
  ["lacteos", "Lácteos y huevos"],
  ["despensa", "Despensa"],
  ["congelados", "Congelados"],
  ["bebidas", "Bebidas"],
  ["limpieza", "Limpieza"],
  ["higiene", "Higiene y cuidado"],
  ["mascotas", "Mascotas"],
  ["otros", "Otros"],
] as const;

/** categoría -> productos de uso común (nombre[:unidad por defecto]). */
const CATALOG: Record<string, string> = {
  "frutas-verduras":
    "Manzanas, Plátanos, Naranjas, Mandarinas, Limones, Peras, Uvas, Fresas, Melón, Sandía, Melocotones, Nectarinas, Kiwis, Piña, Aguacates, Cerezas, Ciruelas, Arándanos, Tomates, Lechuga, Cebollas, Ajos, Patatas, Zanahorias, Pimientos, Pepinos, Calabacines, Berenjenas, Champiñones, Espinacas, Brócoli, Coliflor, Judías verdes, Puerros, Calabaza, Boniato, Maíz, Rúcula, Canónigos, Perejil, Cebolleta, Apio, Remolacha, Jengibre, Setas",
  carniceria:
    "Pollo, Pechuga de pollo, Muslos de pollo, Pavo, Ternera, Carne picada, Filetes de ternera, Cerdo, Lomo, Chuletas, Costillas, Salchichas, Chorizo, Jamón serrano, Jamón York, Fiambre de pavo, Bacon, Salchichón, Longaniza, Hamburguesas, Albóndigas, Cordero, Conejo, Morcilla, Pavo en lonchas, Mortadela",
  pescaderia:
    "Merluza, Salmón, Atún, Bacalao, Lubina, Dorada, Gambas, Langostinos, Mejillones, Calamares, Sepia, Pulpo, Sardinas, Boquerones, Rape, Almejas, Lenguado, Surimi, Anchoas, Caballa",
  panaderia:
    "Pan, Pan de molde, Barra de pan, Pan integral, Baguette, Tostadas, Croissants, Magdalenas, Donuts, Bollos, Pan rallado, Tortillas de trigo, Pan de hamburguesa, Palmeras, Napolitanas, Bizcocho, Empanada",
  lacteos:
    "Leche, Leche sin lactosa, Leche desnatada, Huevos, Yogures, Yogur griego, Mantequilla, Queso, Queso rallado, Queso fresco, Queso en lonchas, Nata, Nata para cocinar, Natillas, Flan, Requesón, Mozzarella, Queso de untar, Kéfir, Leche de avena, Leche de almendras, Margarina, Batidos",
  despensa:
    "Arroz, Pasta, Espaguetis, Macarrones, Fideos, Lentejas, Garbanzos, Alubias, Aceite de oliva, Aceite de girasol, Vinagre, Sal, Azúcar, Harina, Tomate frito, Tomate triturado, Atún en lata, Sardinas en lata, Mayonesa, Ketchup, Mostaza, Cereales, Galletas, Café, Té, Cacao en polvo, Mermelada, Miel, Chocolate, Frutos secos, Almendras, Nueces, Aceitunas, Patatas fritas, Palomitas, Legumbres cocidas, Caldo, Sopa, Especias, Pimienta, Orégano, Pimentón, Levadura, Salsa de soja, Cuscús, Quinoa, Avena, Turrón, Crema de cacao, Barritas de cereales, Pan tostado, Puré de patata, Maíz en lata, Pimientos del piquillo, Pepinillos, Conservas",
  congelados:
    "Guisantes congelados, Verduras congeladas, Pizza, Croquetas, Nuggets, Helado, Patatas congeladas, Lasaña, Empanadillas, Pescado congelado, Gambas congeladas, Hielo, Varitas de merluza, Espinacas congeladas, San Jacobos, Fruta congelada",
  bebidas:
    "Agua, Agua con gas, Refresco de cola, Refresco de naranja, Limonada, Zumo de naranja, Zumo de piña, Cerveza, Cerveza sin alcohol, Vino tinto, Vino blanco, Cava, Tónica, Bebida isotónica, Té frío, Sidra, Vermut, Ginebra, Ron, Whisky, Gaseosa",
  limpieza:
    "Detergente, Suavizante, Lavavajillas, Pastillas lavavajillas, Lejía, Fregasuelos, Limpiacristales, Papel de cocina, Bayetas, Estropajos, Bolsas de basura, Papel de aluminio, Film transparente, Papel de horno, Ambientador, Limpiador de baño, Quitagrasas, Escoba, Fregona, Guantes, Sal lavavajillas, Antical, Servilletas, Pilas, Bombillas",
  higiene:
    "Papel higiénico, Pasta de dientes, Cepillo de dientes, Champú, Acondicionador, Gel de ducha, Jabón de manos, Desodorante, Compresas, Pañuelos de papel, Discos de algodón, Cuchillas de afeitar, Espuma de afeitar, Crema hidratante, Protector solar, Hilo dental, Enjuague bucal, Bastoncillos, Toallitas, Pañales, Tiritas, Paracetamol, Ibuprofeno, Colonia",
  mascotas:
    "Pienso para perro, Pienso para gato, Comida húmeda gato, Arena para gatos, Snacks para perro, Bolsas de excrementos, Antiparasitarios",
  otros: "Velas, Cerillas, Regalo, Flores, Cinta adhesiva, Pegamento, Sobres, Folios",
};

const DEFAULT_UNIT: Record<string, string> = {
  Leche: "l", "Leche sin lactosa": "l", "Leche desnatada": "l", "Aceite de oliva": "l", "Aceite de girasol": "l",
  Agua: "l", Arroz: "kg", Patatas: "kg", Harina: "kg", Azúcar: "kg", Tomates: "kg", Manzanas: "kg", Plátanos: "kg",
  Naranjas: "kg", Zanahorias: "kg", Cebollas: "kg", "Carne picada": "g", Pollo: "kg", Huevos: "ud", Yogures: "pack",
};

export function seedHousehold(db: DB, householdId: string) {
  const catIds = new Map<string, string>();
  DEFAULT_CATEGORIES.forEach(([key, name], i) => {
    const id = randomUUID();
    catIds.set(key, id);
    run(db, "INSERT INTO categories (id, household_id, key, name, position) VALUES (?,?,?,?,?)", id, householdId, key, name, i);
  });
  const insert = db.prepare(
    "INSERT OR IGNORE INTO products (id, household_id, name, name_norm, stem, category_id, default_unit) VALUES (?,?,?,?,?,?,?)",
  );
  for (const [key, csv] of Object.entries(CATALOG)) {
    for (const name of csv.split(",").map((s) => s.trim()).filter(Boolean)) {
      insert.run(randomUUID(), householdId, name, normalize(name), stem(name), catIds.get(key)!, DEFAULT_UNIT[name] ?? null);
    }
  }
}

export const CATALOG_SIZE = Object.values(CATALOG).reduce((n, csv) => n + csv.split(",").length, 0);
