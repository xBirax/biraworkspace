// Assinatura VMP (CastLabs EVS) do pacote já montado.
//
// O binário da CastLabs vem assinado de fábrica, mas o electron-builder renomeia
// electron.exe -> adr-workspace.exe e a assinatura deixa de casar. Sem re-assinar,
// o CDM do Widevine carrega e mesmo assim o servidor de licença recusa — que é
// exatamente o sintoma de "toca no Chrome, não toca aqui".
//
// ORDEM IMPORTA: roda em afterSign, não em afterPack. Depois do afterPack o
// electron-builder ainda grava o hash de integridade do asar DENTRO do .exe
// ("updating asar integrity executable resource"), o que invalidaria uma
// assinatura feita antes. Se este log aparecer antes daquele, está errado.
//
// CommonJS de propósito: o electron-builder faz require() deste arquivo, e o
// pacote é "type": "module".
const { execFileSync } = require("node:child_process");

exports.default = async function vmpSign(context) {
  // afterSign entrega o diretório em context.appOutDir; algumas versões passam
  // packager/outDir. Normaliza para não assinar caminho errado em silêncio.
  const appOutDir = context.appOutDir || context.packager?.info?.appOutDir;
  const platform = context.electronPlatformName || context.packager?.platform?.buildConfigurationKey;
  // Só Windows e macOS têm VMP; no Linux o sign-pkg não se aplica.
  if (platform !== "win32" && platform !== "darwin") return;
  if (!appOutDir) throw new Error("VMP signing: appOutDir ausente no contexto do hook");
  if (process.env.ADR_SKIP_VMP === "1") {
    console.log("  • VMP signing pulado (ADR_SKIP_VMP=1)");
    return;
  }
  console.log(`  • assinando VMP  path=${appOutDir}`);
  try {
    execFileSync("python", ["-m", "castlabs_evs.vmp", "sign-pkg", appOutDir], {
      stdio: "inherit",
    });
  } catch (error) {
    // Falha aqui gera instalador que carrega o CDM e não toca conteúdo
    // protegido. Melhor quebrar o build do que entregar isso como "pronto".
    throw new Error(
      `VMP signing falhou. Rode "python -m castlabs_evs.account reauth" e tente de novo. (${error.message})`,
    );
  }
};
