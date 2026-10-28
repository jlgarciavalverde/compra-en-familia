// Genera, compila y firma el APK de Android (TWA) de Compra en Familia.
//
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools node build.mjs [versión]
//
// Requisitos: JDK 21 + SDK de Android (platform 35, build-tools 35) y el keystore de ~/.android-keystores.
// La app no lleva código propio: abre https://compra.redgarverde.com a pantalla completa con Chrome (TWA), así que
// las actualizaciones de la web llegan solas y solo hay que regenerar el APK si cambia la firma, el icono o el nombre.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ConsoleLog, TwaGenerator, TwaManifest } from "@bubblewrap/core";

const HOST = "compra.redgarverde.com";
const PACKAGE_ID = "com.redgarverde.compra";
const version = process.argv[2] ?? "1.0.0";
const versionCode = version.split(".").reduce((n, p) => n * 100 + Number(p), 0); // 1.2.3 -> 10203

const JAVA_HOME = process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk@21";
const ANDROID_HOME = process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools";
const BUILD_TOOLS = join(ANDROID_HOME, "build-tools", "35.0.0");

const keyDir = join(homedir(), ".android-keystores");
const props = Object.fromEntries(readFileSync(join(keyDir, "compra-en-familia.properties"), "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const keystore = props.storeFile;
if (!existsSync(keystore)) throw new Error(`No existe el keystore ${keystore}`);

const out = resolve("build");
const project = join(out, "project");
rmSync(project, { recursive: true, force: true });
mkdirSync(project, { recursive: true });

const site = `https://${HOST}`;
const manifest = new TwaManifest({
  packageId: PACKAGE_ID,
  host: HOST,
  name: "Compra en Familia",
  launcherName: "Compra",
  display: "standalone",
  orientation: "portrait",
  themeColor: "#FBF6EE",
  themeColorDark: "#1F1A17",
  navigationColor: "#FBF6EE",
  navigationColorDark: "#1F1A17",
  navigationDividerColor: "#E8DCCB",
  navigationDividerColorDark: "#3D332D",
  backgroundColor: "#FBF6EE",
  enableNotifications: true, // los avisos push los muestra Chrome en nombre de la app
  startUrl: "/",
  iconUrl: `${site}/icon-512.png`,
  maskableIconUrl: `${site}/icon-maskable-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: keystore, alias: props.alias },
  appVersion: version,
  appVersionCode: versionCode,
  webManifestUrl: `${site}/manifest.webmanifest`,
  fallbackType: "customtabs",
  enableSiteSettingsShortcut: false,
  minSdkVersion: 23,
  generatorApp: "compra-en-familia",
});
const problem = manifest.validate();
if (problem) throw new Error(`Manifiesto TWA no válido: ${problem}`);
writeFileSync(join(out, "twa-manifest.json"), JSON.stringify(manifest.toJson(), null, 2));

console.log("→ Generando el proyecto Android…");
await new TwaGenerator().createTwaProject(project, manifest, new ConsoleLog("twa"));

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
writeFileSync(join(project, "local.properties"), `sdk.dir=${ANDROID_HOME}\n`);

console.log("→ Compilando con Gradle (la primera vez descarga Gradle y las librerías)…");
execFileSync("./gradlew", ["--no-daemon", "assembleRelease"], { cwd: project, env, stdio: "inherit" });

const unsigned = join(project, "app/build/outputs/apk/release/app-release-unsigned.apk");
if (!existsSync(unsigned)) throw new Error(`Gradle no generó ${unsigned}`);
const aligned = join(out, "aligned.apk");
const apk = join(out, "compra-en-familia.apk");
rmSync(aligned, { force: true });
rmSync(apk, { force: true });

console.log("→ Alineando y firmando…");
execFileSync(join(BUILD_TOOLS, "zipalign"), ["-p", "4", unsigned, aligned], { stdio: "inherit" });
execFileSync(join(BUILD_TOOLS, "apksigner"), [
  "sign", "--ks", keystore, "--ks-key-alias", props.alias,
  "--ks-pass", "env:KS_PASS", "--key-pass", "env:KS_KEY_PASS", "--out", apk, aligned,
], { stdio: "inherit", env: { ...env, KS_PASS: props.storePassword, KS_KEY_PASS: props.keyPassword } });
rmSync(aligned, { force: true });
execFileSync(join(BUILD_TOOLS, "apksigner"), ["verify", "--verbose", "--print-certs", apk], { stdio: "inherit" });

const bytes = readFileSync(apk);
const info = {
  version, versionCode, packageId: PACKAGE_ID, size: statSync(apk).size,
  sha256: createHash("sha256").update(bytes).digest("hex"), builtAt: new Date().toISOString(),
};
writeFileSync(join(out, "version.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`\n✓ ${apk}\n${JSON.stringify(info, null, 2)}`);
