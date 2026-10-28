import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push";

describe("urlBase64ToUint8Array", () => {
  it("convierte base64url (con - y _, sin relleno) en bytes", () => {
    // "Hi??>" en base64url = SGk_Pz4
    expect([...urlBase64ToUint8Array("SGk_Pz4")]).toEqual([72, 105, 63, 63, 62]);
  });
  it("una clave VAPID real ocupa 65 bytes y empieza por 0x04 (punto sin comprimir)", () => {
    const key = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });
});
