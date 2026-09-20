import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // node:sqlite solo existe con el prefijo `node:`; por defecto tsup lo quita y el import se rompe.
  removeNodeProtocol: false,
  // El paquete compartido es TypeScript sin compilar: se incluye en el bundle.
  noExternal: ["@compra/shared"],
});
